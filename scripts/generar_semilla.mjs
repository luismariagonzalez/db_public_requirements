#!/usr/bin/env node
// Genera la semilla con Gemini y la deja en semilla/requisitos/*.json para que
// la REVISES antes de cargarla (scripts/sembrar.mjs). Nada de aquí toca la base.
//
//   node scripts/generar_semilla.mjs                 todas las categorías
//   node scripts/generar_semilla.mjs --solo=messaging,security
//   node scripts/generar_semilla.mjs --n=25          requisitos por categoría (por defecto 25)
//   node scripts/generar_semilla.mjs --fusionar      no genera: solo rehace la deduplicación
//
// Fase 1: un borrador por categoría en semilla/borrador/<slug>.json (se puede
//         borrar y regenerar una sola con --solo).
// Fase 2: se leen TODOS los borradores, se deduplican entre categorías con
//         embeddings (un requisito que sale en varias categorías se funde en uno
//         con varias categorías, y se queda la mejor prioridad de cada una) y se
//         escriben semilla/requisitos/<categoría-principal>.json.

import './gemini_env.mjs';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { generarJson, embedLote } from '../lib/gemini.mjs';
import { validarItem, CLASES } from '../lib/umbral.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const solo = arg('solo')?.split(',');
const N = Number(arg('n') ?? 25);
const SOLO_FUSIONAR = process.argv.includes('--fusionar');
const UMBRAL_DUP = Number(arg('umbral') ?? 0.90);

const raiz = new URL('../semilla/', import.meta.url);
const categorias = JSON.parse(readFileSync(new URL('categorias.json', raiz), 'utf8'));
const slugs = new Set(categorias.map((c) => c.slug));
mkdirSync(new URL('borrador/', raiz), { recursive: true });
mkdirSync(new URL('requisitos/', raiz), { recursive: true });

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    requirements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' }, statement: { type: 'STRING' },
          criteria: { type: 'ARRAY', items: { type: 'STRING' } },
          kind: { type: 'STRING', enum: CLASES },
          categories: { type: 'ARRAY', items: { type: 'OBJECT',
            properties: { slug: { type: 'STRING' }, priority: { type: 'NUMBER' } }, required: ['slug', 'priority'] } },
        },
        required: ['title', 'statement', 'criteria', 'kind', 'categories'],
      },
    },
  },
  required: ['requirements'],
};

const ENFOQUE = {
  app_type: 'Requirements that a product of this kind must satisfy: both what is specific to it and the generic essentials users of this kind of product take for granted.',
  screen_type: 'Behavioural requirements for this kind of screen or flow. Describe what must hold (validation, states, errors, recovery, safety), NOT layout or placement.',
  cross_cutting: 'Requirements for this concern that apply to most software, concrete and testable, covering the main failure modes people forget.',
};

function prompt(cat) {
  const lista = categorias.map((c) => `${c.slug} (${c.tipo})`).join(', ');
  return `You write seed content for a public database of software requirements that vibe coders paste into their AI coding agent.

Category: ${cat.nombre} [slug ${cat.slug}, type ${cat.tipo}] — ${cat.descripcion}
${ENFOQUE[cat.tipo]}

Write exactly ${N} distinct requirements. Rules:
- Each states WHAT the software must do or guarantee, one behaviour per requirement, starting like "The app must…", "Users can…" or "The system must…".
- NEVER say where or how it is shown: no screens, pages, buttons, menus, layout, placement, colours, component names.
- Title 5-120 chars; statement 10-400 chars; 2-5 testable acceptance criteria (each under 160 chars). English. No brand names unless unavoidable.
- "kind": one of ${CLASES.join(', ')}.
- "categories": MUST include "${cat.slug}" and may include other relevant slugs from this list: ${lista}. Give each a priority 1-5 (1 = essential: broken or unsafe without it; 2 = expected; 3 = recommended; 4 = nice to have; 5 = differentiator). Priority is per category. Make most requirements P1-P3; only a few P4-P5.
- Cover the breadth of the category, ordered from most to least important, with no near-duplicates.`;
}

async function fase1() {
  const objetivo = categorias.filter((c) => !solo || solo.includes(c.slug));
  if (solo && !objetivo.length) throw new Error('ninguna categoría coincide con --solo');
  let hechos = 0;
  const cola = [...objetivo];
  const trabajador = async () => {
    for (let c; (c = cola.shift());) {
      try {
        const r = await generarJson(prompt(c), ESQUEMA, { maxTokens: 24000 });
        const buenos = [];
        for (const raw of r.requirements ?? []) {
          const v = validarItem(raw, slugs);
          if (!v.ok) continue;
          // Aunque la IA se olvide, la categoría pedida va siempre.
          if (!v.item.categories.some((x) => x.slug === c.slug)) v.item.categories.unshift({ slug: c.slug, priority: 3 });
          buenos.push(v.item);
        }
        writeFileSync(new URL(`borrador/${c.slug}.json`, raiz), JSON.stringify(buenos, null, 2) + '\n');
        console.log(`  ✓ ${c.slug}: ${buenos.length} requisitos (${++hechos}/${objetivo.length})`);
      } catch (e) { console.log(`  ✗ ${c.slug}: ${e.message}`); }
    }
  };
  await Promise.all([trabajador(), trabajador(), trabajador()]);
}

const coseno = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };   // normalizados
const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110);

async function fase2() {
  const archivos = readdirSync(new URL('borrador/', raiz)).filter((f) => f.endsWith('.json'));
  const todos = archivos.flatMap((f) => JSON.parse(readFileSync(new URL(`borrador/${f}`, raiz), 'utf8')));
  if (!todos.length) throw new Error('no hay borradores: ejecuta sin --fusionar');
  console.log(`\n  Deduplicando ${todos.length} requisitos con embeddings…`);
  const vecs = await embedLote(todos.map((i) => `${i.title}. ${i.statement}`));

  // Greedy: primero los más importantes, para que su texto sea el que se queda.
  const orden = todos.map((_, i) => i).sort((a, b) =>
    Math.min(...todos[a].categories.map((c) => c.priority)) - Math.min(...todos[b].categories.map((c) => c.priority)));
  const reps = [];   // { item, vec }
  let fundidos = 0;
  for (const i of orden) {
    const it = structuredClone(todos[i]);
    const rep = reps.find((r) => coseno(r.vec, vecs[i]) >= UMBRAL_DUP);
    if (!rep) { reps.push({ item: it, vec: vecs[i] }); continue; }
    fundidos++;
    for (const c of it.categories) {
      const ya = rep.item.categories.find((x) => x.slug === c.slug);
      if (!ya) rep.item.categories.push(c); else ya.priority = Math.min(ya.priority, c.priority);
    }
    const vistos = new Set(rep.item.criteria.map((c) => c.toLowerCase()));
    for (const c of it.criteria) if (rep.item.criteria.length < 8 && !vistos.has(c.toLowerCase())) rep.item.criteria.push(c);
  }

  // Slugs únicos y estables, y un fichero por categoría principal (la de mejor prioridad).
  const usados = new Set();
  const porCategoria = new Map();
  for (const { item } of reps) {
    let base = slugify(item.title), s = base, n = 1;
    while (usados.has(s)) s = `${base}-${++n}`;
    usados.add(s);
    item.slug = s;
    item.categories.sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug));
    const principal = item.categories[0].slug;
    if (!porCategoria.has(principal)) porCategoria.set(principal, []);
    porCategoria.get(principal).push(item);
  }
  for (const f of readdirSync(new URL('requisitos/', raiz))) rmSync(new URL(`requisitos/${f}`, raiz));
  for (const [cat, items] of porCategoria) {
    items.sort((a, b) => a.categories[0].priority - b.categories[0].priority || a.title.localeCompare(b.title));
    writeFileSync(new URL(`requisitos/${cat}.json`, raiz), JSON.stringify(items, null, 2) + '\n');
  }
  console.log(`  ✓ ${reps.length} requisitos únicos (${fundidos} fundidos por duplicados) en ${porCategoria.size} ficheros de semilla/requisitos/`);
  console.log('\n  Revisa semilla/requisitos/ y luego: node scripts/sembrar.mjs\n');
}

if (!SOLO_FUSIONAR) await fase1();
await fase2();
