#!/usr/bin/env node
// Genera con Gemini tests y aceleradores para los requisitos de semilla/requisitos/
// y los deja en semilla/tests/ y semilla/aceleradores/ para REVISARLOS antes de
// cargarlos (scripts/sembrar.mjs). Nada de aquí toca la base.
//
//   node scripts/generar_tests_aceleradores.mjs                 los dos
//   node scripts/generar_tests_aceleradores.mjs --solo=tests
//   node scripts/generar_tests_aceleradores.mjs --solo=aceleradores
//
// ⚠ Los aceleradores salen de la memoria del modelo: REVISA cada URL y que la
//   herramienta exista y siga viva antes de cargar. Es lo que más se inventa.

import './gemini_env.mjs';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { generarJson } from '../lib/gemini.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const solo = arg('solo');
const raiz = new URL('../semilla/', import.meta.url);

const dirReq = new URL('requisitos/', raiz);
if (!existsSync(dirReq)) throw new Error('primero genera y revisa semilla/requisitos/ (npm run semilla:generar)');
const requisitos = readdirSync(dirReq).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(new URL(f, dirReq), 'utf8')));
const porSlug = new Map(requisitos.map((r) => [r.slug, r]));
console.log(`\n  ${requisitos.length} requisitos de partida`);

const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110);
const TIPOS = ['unit', 'integration', 'e2e', 'security', 'performance', 'accessibility', 'manual'];
const limpia = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const trozos = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ── tests
const ESQ_TESTS = { type: 'OBJECT', properties: { tests: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  title: { type: 'STRING' }, scenario: { type: 'STRING' }, type: { type: 'STRING', enum: TIPOS },
  priority: { type: 'NUMBER' }, requirements: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['title', 'scenario', 'type', 'priority', 'requirements'] } } }, required: ['tests'] };

async function generarTests() {
  const salida = new Map();   // slug → test
  const lotes = trozos(requisitos, 12);
  let n = 0;
  for (const lote of lotes) {
    const lista = lote.map((r) => `- ${r.slug} (P${r.categories[0].priority}): ${r.title}. ${r.statement}`).join('\n');
    try {
      const r = await generarJson(`You write acceptance tests for software requirements, for a public database that vibe coders hand to their AI coding agent.

For EACH requirement below write 1 to 3 concrete tests that prove it holds: what to do and what must be observed. Rules:
- Describe behaviour to verify (Given/When/Then in one or two sentences), never screens, buttons or layout.
- title 5-120 chars; scenario 10-500 chars; English.
- type: ${TIPOS.join(', ')}. priority 1-5 (1 = a test you must never skip; follow the requirement's own priority, lower it a little for edge cases).
- "requirements": the slug(s) from the list this test verifies (use ONLY slugs from the list).

Requirements:
${lista}`, ESQ_TESTS, { maxTokens: 16000 });
      for (const t of r.tests ?? []) {
        const reqs = [...new Set((t.requirements ?? []).filter((s) => porSlug.has(s)))].slice(0, 8);
        const titulo = limpia(t.title), esc = limpia(t.scenario);
        const prio = Number.isInteger(Number(t.priority)) ? Math.min(5, Math.max(1, Number(t.priority))) : 3;
        if (titulo.length < 5 || titulo.length > 120 || esc.length < 10 || esc.length > 800 || !reqs.length) continue;
        const slug = slugify(titulo);
        if (!slug || salida.has(slug)) continue;
        salida.set(slug, { slug, title: titulo, scenario: esc, type: TIPOS.includes(t.type) ? t.type : 'integration', priority: prio, requirements: reqs });
      }
      console.log(`  ✓ tests: lote ${++n}/${lotes.length} (${salida.size} hasta ahora)`);
    } catch (e) { console.log(`  ✗ tests: lote ${++n}: ${e.message}`); }
  }
  const dir = new URL('tests/', raiz);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) rmSync(new URL(f, dir));
  const porPrincipal = new Map();
  for (const t of salida.values()) {
    const cat = porSlug.get(t.requirements[0]).categories[0].slug;
    if (!porPrincipal.has(cat)) porPrincipal.set(cat, []);
    porPrincipal.get(cat).push(t);
  }
  for (const [cat, lista] of porPrincipal) writeFileSync(new URL(`${cat}.json`, dir), JSON.stringify(lista, null, 2) + '\n');
  console.log(`  ✓ ${salida.size} tests en semilla/tests/`);
}

// ── aceleradores
async function comprobarUrl(url, intento = 0) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; RequirementsDB-linkcheck)' } });
    if (r.status < 400 || [401, 403, 429].includes(r.status)) return { ok: true };
    return { ok: false, motivo: `HTTP ${r.status}`, red: false };
  } catch (e) {
    // Un fallo de red suele ser transitorio (DNS, conexión cortada): se reintenta con espera.
    if (intento < 2) { await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1))); return comprobarUrl(url, intento + 1); }
    return { ok: false, motivo: String(e.cause?.code ?? e.name ?? e.message), red: true };
  }
}

const ESQ_ACEL = { type: 'OBJECT', properties: { accelerators: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  name: { type: 'STRING' }, description: { type: 'STRING' }, model: { type: 'STRING', enum: ['open_source', 'proprietary', 'saas'] },
  cost: { type: 'STRING', enum: ['free', 'freemium', 'paid'] }, url: { type: 'STRING' },
  platforms: { type: 'ARRAY', items: { type: 'STRING' } },
  requirements: { type: 'ARRAY', items: { type: 'OBJECT', properties: { slug: { type: 'STRING' }, coverage: { type: 'STRING', enum: ['full', 'partial'] } }, required: ['slug', 'coverage'] } } },
  required: ['name', 'description', 'model', 'cost', 'url', 'platforms', 'requirements'] } } }, required: ['accelerators'] };

async function generarAceleradores() {
  const salida = new Map();
  // Un lote por categoría principal: el modelo ve requisitos de un mismo tema.
  const porCategoria = new Map();
  for (const r of requisitos) {
    const c = r.categories[0].slug;
    if (!porCategoria.has(c)) porCategoria.set(c, []);
    porCategoria.get(c).push(r);
  }
  let n = 0;
  for (const [cat, rs] of porCategoria) {
    for (const lote of trozos(rs, 30)) {
      const lista = lote.map((r) => `- ${r.slug}: ${r.title}`).join('\n');
      try {
        const r = await generarJson(`You curate "accelerators" for a public database of software requirements: real, well-known open source libraries, proprietary products or SaaS services that let a developer implement requirements faster.

For the requirements below, recommend up to 12 accelerators. STRICT rules:
- Only include tools you are CERTAIN exist and are widely used. If unsure, leave it out. Never invent names or URLs.
- "url": the official https homepage or repository.
- model: open_source | proprietary | saas. cost: free | freemium | paid. platforms: languages/frameworks, e.g. javascript, typescript, python, flutter, ios, android, or "any" for language-agnostic services.
- description 10-300 chars, factual.
- "requirements": which of the slugs below it helps with (ONLY slugs from the list), with coverage full (does most of it) or partial.

Requirements (category ${cat}):
${lista}`, ESQ_ACEL, { maxTokens: 12000 });
        for (const a of r.accelerators ?? []) {
          const reqs = (a.requirements ?? []).filter((x) => porSlug.has(x.slug)).map((x) => ({ slug: x.slug, coverage: x.coverage === 'full' ? 'full' : 'partial' }));
          const nombre = limpia(a.name), desc = limpia(a.description), url = limpia(a.url);
          if (nombre.length < 2 || nombre.length > 80 || desc.length < 10 || desc.length > 600 || !/^https:\/\/\S+$/.test(url) || url.length > 300 || !reqs.length) continue;
          const slug = slugify(nombre);
          if (!slug) continue;
          const previo = salida.get(slug);
          if (previo) {   // el mismo producto en otra categoría: se unen sus requisitos
            for (const q of reqs) if (!previo.requirements.some((x) => x.slug === q.slug)) previo.requirements.push(q);
            previo.requirements = previo.requirements.slice(0, 20);
            continue;
          }
          salida.set(slug, { slug, name: nombre, description: desc, model: a.model, cost: a.cost, url,
            platforms: (a.platforms ?? []).map((p) => limpia(p).toLowerCase()).filter((p) => /^[a-z0-9._+#-]{1,30}$/.test(p)).slice(0, 12),
            requirements: reqs.slice(0, 20) });
        }
        console.log(`  ✓ aceleradores: ${cat} (${++n}) → ${salida.size} hasta ahora`);
      } catch (e) { console.log(`  ✗ aceleradores: ${cat}: ${e.message}`); }
    }
  }
  // Los modelos inventan URLs: se comprueba que cada una responde. Un 401/403/429 suele ser
  // protección anti-bots de un sitio real (se conserva); 404/410, DNS o timeout → fuera.
  const aceptadas = [], descartadas = [];
  const cola = [...salida.values()];
  const verificador = async () => {
    for (let a; (a = cola.shift());) {
      const r = await comprobarUrl(a.url);
      if (r.ok) aceptadas.push(a); else descartadas.push({ ...a, motivo: r.motivo, red: r.red });
    }
  };
  await Promise.all([verificador(), verificador(), verificador()]);
  // Segunda pasada, de una en una: lo que falló por RED (no por un 404) se vuelve a probar con calma.
  for (const d of [...descartadas.filter((x) => x.red)]) {
    const r = await comprobarUrl(d.url);
    if (r.ok) { descartadas.splice(descartadas.indexOf(d), 1); const { motivo, red, ...a } = d; aceptadas.push(a); }
  }
  const dir = new URL('aceleradores/', raiz);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) rmSync(new URL(f, dir));
  writeFileSync(new URL('aceleradores.json', dir), JSON.stringify(aceptadas.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n');
  writeFileSync(new URL('descartados.txt', dir), descartadas.map((d) => `${d.name}\t${d.url}\t${d.motivo}`).join('\n') + '\n');
  writeFileSync(new URL('descartados.json', dir), JSON.stringify(descartadas, null, 2) + '\n');   // objeto completo, por si se quiere rescatar alguno
  console.log(`  ✓ ${aceptadas.length} aceleradores con URL viva en semilla/aceleradores/; ${descartadas.length} descartados (descartados.txt)`);
  console.log('  ⚠ Que la URL responda no prueba que el producto sea el que dice la descripción: échales un ojo.');
}

if (!solo || solo === 'tests') await generarTests();
if (!solo || solo === 'aceleradores') await generarAceleradores();
console.log('\n  Revisa semilla/tests/ y semilla/aceleradores/ y luego: node scripts/sembrar.mjs\n');
