#!/usr/bin/env node
// Reajusta las prioridades de semilla/requisitos/*.json con Gemini. La generación
// inicial sale muy cargada hacia P1/P2; esto la reparte con una rúbrica estricta
// y una distribución objetivo POR CATEGORÍA (la prioridad es por categoría).
//
//   node scripts/recalibrar_prioridades.mjs            reajusta y guarda
//   node scripts/recalibrar_prioridades.mjs --dry      solo enseña cómo quedaría
//
// Guarda una copia de lo anterior en semilla/antes_de_recalibrar/ (ignorada por git).

import './gemini_env.mjs';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { generarJson } from '../lib/gemini.mjs';

const DRY = process.argv.includes('--dry');
const raiz = new URL('../semilla/', import.meta.url);
const dir = new URL('requisitos/', raiz);
const categorias = JSON.parse(readFileSync(new URL('categorias.json', raiz), 'utf8'));

const ficheros = readdirSync(dir).filter((f) => f.endsWith('.json'));
const datos = new Map(ficheros.map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]));
const todos = [...datos.values()].flat();

const distribucion = (items, slug) => {
  const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const it of items) { const c = it.categories.find((x) => x.slug === slug); if (c) d[c.priority]++; }
  return d;
};

const ESQ = { type: 'OBJECT', properties: { priorities: { type: 'ARRAY', items: { type: 'OBJECT',
  properties: { slug: { type: 'STRING' }, priority: { type: 'NUMBER' } }, required: ['slug', 'priority'] } } },
  required: ['priorities'] };

const TAM = 70;
async function recalibrar(cat) {
  const en = todos.filter((r) => r.categories.some((c) => c.slug === cat.slug));
  if (!en.length) return null;
  const antes = distribucion(todos, cat.slug);
  const nuevas = new Map();
  for (let i = 0; i < en.length; i += TAM) {
    const lote = en.slice(i, i + TAM);
    const lista = lote.map((r) => `- ${r.slug}: ${r.title}. ${r.statement}`).join('\n');
    const r = await generarJson(`You assign priorities to software requirements, PER CATEGORY, for a public database that vibe coders use to decide what to build.

Category: ${cat.nombre} [${cat.tipo}] — ${cat.descripcion}

Rubric (be strict, most requirements are NOT P1):
- P1 essential: without it the app is broken, unsafe, unlawful or unusable for this category. Only the true non-negotiables.
- P2 expected: users or auditors clearly notice it is missing, but the app still works.
- P3 recommended: good practice that most mature products have.
- P4 nice to have: improves quality or convenience.
- P5 differentiator: advanced or uncommon extra that sets a product apart.

Target distribution for the WHOLE category (${en.length} requirements${en.length > TAM ? `; this call has ${lote.length} of them, keep the same proportions` : ''}): about 15% P1, 30% P2, 30% P3, 18% P4, 7% P5. Rank the requirements against each other and spread them accordingly.

Return one entry per requirement below, using exactly the given slug.

Requirements:
${lista}`, ESQ, { maxTokens: 12000 });
    for (const p of r.priorities ?? []) {
      const n = Number(p.priority);
      if (Number.isInteger(n) && n >= 1 && n <= 5 && lote.some((x) => x.slug === p.slug)) nuevas.set(p.slug, n);
    }
  }
  // Solo se aplica si cubrió casi todo; si no, se deja como estaba.
  if (nuevas.size < en.length * 0.9) return { cat: cat.slug, antes, despues: antes, aplicado: false, motivo: `solo ${nuevas.size}/${en.length}` };
  for (const it of en) {
    const c = it.categories.find((x) => x.slug === cat.slug);
    if (nuevas.has(it.slug)) c.priority = nuevas.get(it.slug);
  }
  return { cat: cat.slug, antes, despues: distribucion(todos, cat.slug), aplicado: true };
}

const cola = [...categorias];
const informe = [];
const trabajador = async () => {
  for (let c; (c = cola.shift());) {
    try { const r = await recalibrar(c); if (r) { informe.push(r); console.log(`  ${r.aplicado ? '✓' : '✗'} ${c.slug}: ${JSON.stringify(r.antes)} → ${JSON.stringify(r.despues)}${r.motivo ? ' (' + r.motivo + ')' : ''}`); } }
    catch (e) { console.log(`  ✗ ${c.slug}: ${e.message}`); }
  }
};
await Promise.all([trabajador(), trabajador(), trabajador()]);

const total = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const it of todos) for (const c of it.categories) total[c.priority]++;
console.log(`\n  Reparto global (par requisito-categoría): ${JSON.stringify(total)}`);

if (DRY) { console.log('  (dry-run: no se ha escrito nada)\n'); process.exit(0); }
const copia = new URL('antes_de_recalibrar/', raiz);
mkdirSync(copia, { recursive: true });
for (const f of ficheros) copyFileSync(new URL(f, dir), new URL(f, copia));
for (const [f, items] of datos) {
  for (const it of items) it.categories.sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug));
  writeFileSync(new URL(f, dir), JSON.stringify(items, null, 2) + '\n');
}
console.log('  ✓ guardado (copia anterior en semilla/antes_de_recalibrar/)\n');
