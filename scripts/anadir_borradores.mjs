#!/usr/bin/env node
// Convierte borradores nuevos (semilla/borrador/<slug>.json, de generar_semilla.mjs --solo-borrador)
// en ficheros de semilla/requisitos/ SIN tocar los que ya hay, y descartando lo repetido:
//   · entre los propios borradores nuevos (coseno ≥ umbral: se funden y se queda la mejor prioridad por categoría)
//   · contra lo que ya está en la base (el más parecido ≥ umbral: se omite)
//   · si el slug ya existe en la semilla
//
//   node scripts/anadir_borradores.mjs crm-sales hr-people …    (las categorías cuyos borradores añadir)
//   node scripts/anadir_borradores.mjs --umbral=0.90 …
//
// Después, revisar semilla/requisitos/<categoría>.json y cargar con scripts/sembrar.mjs.

import './gemini_env.mjs';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { embedLote, aLiteral } from '../lib/gemini.mjs';
import { exige } from './entorno.mjs';
import { rpc } from '../lib/bd.mjs';
import { validarItem } from '../lib/umbral.mjs';
import { textoParaEmbedding, indexarCategorias } from '../lib/texto_embedding.mjs';

exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GEMINI_API_KEY');
const umbral = Number(process.argv.find((a) => a.startsWith('--umbral='))?.split('=')[1] ?? 0.90);
const cats = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!cats.length) throw new Error('indica las categorías: node scripts/anadir_borradores.mjs crm-sales …');

const raiz = new URL('../semilla/', import.meta.url);
const slugs = new Set(JSON.parse(readFileSync(new URL('categorias.json', raiz), 'utf8')).map((c) => c.slug));
const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110);
const coseno = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const existentes = new Set(readdirSync(new URL('requisitos/', raiz)).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(new URL(`requisitos/${f}`, raiz), 'utf8')).map((r) => r.slug ?? slugify(r.title))));

const nuevos = [];
for (const c of cats) {
  const f = new URL(`borrador/${c}.json`, raiz);
  if (!existsSync(f)) { console.log(`  ✗ ${c}: no hay borrador`); continue; }
  for (const raw of JSON.parse(readFileSync(f, 'utf8'))) {
    const v = validarItem(raw, slugs);
    if (v.ok) nuevos.push({ ...v.item, _cat: c });
  }
}
console.log(`  ${nuevos.length} requisitos en los borradores de ${cats.length} categorías`);
const vecs = await embedLote(nuevos.map((i) => `${i.title}. ${i.statement}`));

// 1) entre ellos: los de mejor prioridad primero
const orden = nuevos.map((_, i) => i).sort((a, b) => Math.min(...nuevos[a].categories.map((c) => c.priority)) - Math.min(...nuevos[b].categories.map((c) => c.priority)));
const reps = []; let fundidos = 0;
for (const i of orden) {
  const it = structuredClone(nuevos[i]);
  const rep = reps.find((r) => coseno(r.vec, vecs[i]) >= umbral);
  if (!rep) { reps.push({ item: it, vec: vecs[i] }); continue; }
  fundidos++;
  for (const c of it.categories) {
    const ya = rep.item.categories.find((x) => x.slug === c.slug);
    if (!ya) rep.item.categories.push(c); else ya.priority = Math.min(ya.priority, c.priority);
  }
}

// 2) contra la base y la semilla
// En la base los vectores llevan las etiquetas (lib/texto_embedding.mjs): para compararlos se embebe cada
// candidato con su texto completo. (La fusión entre borradores, de arriba, sigue con título + enunciado:
// ahí un mismo requisito sale con etiquetas distintas y no debe separarse por ellas.)
const catsBase = await rpc('categorias').then(indexarCategorias).catch(() => indexarCategorias([]));
const vecsBase = await embedLote(reps.map((r) => textoParaEmbedding(r.item, catsBase)));
let repetidos = 0; const salida = new Map();
for (const [k, { item }] of reps.entries()) {
  const s = slugify(item.title);
  let parecido = null;
  try { parecido = (await rpc('similares', { p_vec: aLiteral(vecsBase[k]), p_limite: 1 }))?.[0]; } catch { /* sin base: se sigue */ }
  if (existentes.has(s) || (parecido && Number(parecido.similarity) >= umbral)) {
    repetidos++; console.log(`    · omitido «${item.title}» ~ ${parecido?.slug ?? s} (${parecido ? Number(parecido.similarity).toFixed(2) : 'mismo slug'})`);
    continue;
  }
  item.slug = s; existentes.add(s);
  item.categories.sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug));
  const principal = item._cat; delete item._cat;
  if (!salida.has(principal)) salida.set(principal, []);
  salida.get(principal).push(item);
}
for (const [c, items] of salida) {
  items.sort((a, b) => a.categories[0].priority - b.categories[0].priority || a.title.localeCompare(b.title));
  writeFileSync(new URL(`requisitos/${c}.json`, raiz), JSON.stringify(items, null, 2) + '\n');
  console.log(`  ✓ ${c}: ${items.length} requisitos`);
}
console.log(`\n  ${fundidos} fundidos entre sí, ${repetidos} omitidos por repetir lo que ya hay. Revisa semilla/requisitos/ y luego: node scripts/sembrar.mjs`);
