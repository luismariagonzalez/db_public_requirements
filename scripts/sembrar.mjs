#!/usr/bin/env node
// Carga semilla/ en la base compartida (la de SUPABASE_URL) con sus embeddings.
// Idempotente: lo que ya existe (por slug) no se toca ni se vuelve a embeber.
//
//   node scripts/sembrar.mjs --dry      cuenta lo que haría, sin escribir ni gastar Gemini
//   node scripts/sembrar.mjs            carga de verdad
//
// Necesita la migración 0001 aplicada, SUPABASE_URL y SUPABASE_SECRET_KEY (en
// ~/.secretos/home.env o el entorno) y GEMINI_API_KEY.

import './gemini_env.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { rpc } from '../lib/bd.mjs';
import { embedLote, aLiteral } from '../lib/gemini.mjs';
import { exige } from './entorno.mjs';

const DRY = process.argv.includes('--dry');
exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
if (!DRY) exige('GEMINI_API_KEY');

const raiz = new URL('../semilla/', import.meta.url);
// categorias.json (audiencias, dominios y tipos de app/pantalla/transversales) más, si
// existe, categorias_software.json (las de Capterra, de scripts/importar_capterra.mjs).
const categorias = [
  ...JSON.parse(readFileSync(new URL('categorias.json', raiz), 'utf8')),
  ...(existsSync(new URL('categorias_software.json', raiz))
    ? JSON.parse(readFileSync(new URL('categorias_software.json', raiz), 'utf8')) : []),
];
const dirReq = new URL('requisitos/', raiz);
const requisitos = existsSync(dirReq)
  ? readdirSync(dirReq).filter((f) => f.endsWith('.json'))
      .flatMap((f) => JSON.parse(readFileSync(new URL(f, dirReq), 'utf8')))
  : [];

console.log(`\n  ${categorias.length} categorías, ${requisitos.length} requisitos en semilla/`);

if (!DRY) {
  // Orden: audiencias, dominios y luego el resto (los dominios y audiencias han de
  // existir antes de que algo cuelgue de ellos). El resto, en paralelo.
  const upsert = (c) => rpc('upsert_categoria', { p_slug: c.slug, p_tipo: c.tipo, p_nombre: c.nombre,
    p_descripcion: c.descripcion ?? '', p_orden: c.orden, p_dominio: c.dominio ?? null, p_audiencias: c.audiencias ?? null });
  for (const tipo of ['audience', 'domain']) for (const c of categorias.filter((x) => x.tipo === tipo)) await upsert(c);
  const resto = categorias.filter((x) => !['audience', 'domain'].includes(x.tipo));
  const cola = [...resto];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let c; (c = cola.shift());) await upsert(c); }));
  console.log(`  ✓ ${categorias.length} categorías al día`);
}

// Los que ya están no se embeben otra vez.
const leer = (carpeta) => {
  const dir = new URL(carpeta + '/', raiz);
  return existsSync(dir)
    // descartados.json (aceleradores con URL muerta) vive en esa carpeta pero NO se carga.
    ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'descartados.json').flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    : [];
};
const tests = leer('tests');
const aceleradores = leer('aceleradores');
console.log(`  ${tests.length} tests y ${aceleradores.length} aceleradores en semilla/`);

const pendientes = async (lista, verbo) => {
  const nuevos = [];
  for (const x of lista) if (!(await rpc(verbo, { p_slug: x.slug }))) nuevos.push(x);
  return nuevos;
};
const nuevos = await pendientes(requisitos, 'requisito');
const nuevosTests = await pendientes(tests, 'test');
const nuevosAcel = await pendientes(aceleradores, 'acelerador');
console.log(`  por cargar: ${nuevos.length} requisitos · ${nuevosTests.length} tests · ${nuevosAcel.length} aceleradores`);
if (DRY || !(nuevos.length + nuevosTests.length + nuevosAcel.length)) {
  console.log(DRY ? '  (dry-run: no se ha escrito nada)\n' : '');
  process.exit(0);
}

// Orden: requisitos primero (los tests y aceleradores se enlazan por slug).
let n = 0;
if (nuevos.length) {
  const vecs = await embedLote(nuevos.map((r) => `${r.title}. ${r.statement}`));
  for (let i = 0; i < nuevos.length; i++) {
    const r = nuevos[i];
    await rpc('crear_requisito', { p_titulo: r.title, p_enunciado: r.statement, p_criterios: r.criteria,
      p_clase: r.kind, p_categorias: r.categories, p_vec: aLiteral(vecs[i]), p_autor: null,
      p_aporte_id: null, p_slug: r.slug });
    if (++n % 50 === 0) console.log(`  … ${n}/${nuevos.length} requisitos`);
  }
  console.log(`  ✓ ${n} requisitos cargados`);
}
if (nuevosTests.length) {
  const vecs = await embedLote(nuevosTests.map((t) => `${t.title}. ${t.scenario}`));
  for (let i = 0; i < nuevosTests.length; i++) {
    const t = nuevosTests[i];
    await rpc('crear_test', { p_titulo: t.title, p_escenario: t.scenario, p_tipo: t.type, p_prioridad: t.priority,
      p_requisitos: t.requirements, p_vec: aLiteral(vecs[i]), p_autor: null, p_slug: t.slug });
  }
  console.log(`  ✓ ${nuevosTests.length} tests cargados`);
}
if (nuevosAcel.length) {
  const vecs = await embedLote(nuevosAcel.map((a) => `${a.name}. ${a.description}`));
  for (let i = 0; i < nuevosAcel.length; i++) {
    const a = nuevosAcel[i];
    await rpc('crear_acelerador', { p_nombre: a.name, p_descripcion: a.description, p_modelo: a.model, p_coste: a.cost,
      p_url: a.url, p_plataformas: a.platforms, p_requisitos: a.requirements, p_vec: aLiteral(vecs[i]), p_autor: null, p_slug: a.slug });
  }
  console.log(`  ✓ ${nuevosAcel.length} aceleradores cargados`);
}
console.log('');
