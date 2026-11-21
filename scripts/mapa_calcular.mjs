#!/usr/bin/env node
// Calcula las coordenadas 2D del mapa de requisitos (lib/mapa_tsne.mjs: t-SNE determinista sobre la
// similitud de los embeddings) y las guarda en la base. Es mantenimiento, no una petición:
// GET /api/v1/map solo las lee.
//
//   node scripts/mapa_calcular.mjs            recalcula todo el mapa y lo escribe (con ~2.000 requisitos, unos 30 s)
//   node scripts/mapa_calcular.mjs --dry      calcula y cuenta, no escribe
//
// Repítelo tras cargar requisitos nuevos o tras reembeber.mjs. Hacen falta al menos 3 requisitos con embedding.

import { pathToFileURL } from 'node:url';
import { rpc as rpcReal } from '../lib/bd.mjs';
import { parsearVector } from '../lib/proyeccion.mjs';
import { disponer, VERSION_TSNE } from '../lib/mapa_tsne.mjs';

const MIN_PUNTOS = 3;
const TANDA = 100;      // vectores por llamada (768 números ≈ 15 KB cada uno)
const GUARDAR = 200;    // puntos por llamada de escritura (la función admite 500)

async function leerVectores(rpc, soloNuevos) {
  const ids = [], vecs = [];
  let cursor = 0;
  for (;;) {
    const r = await rpc('mapa_para_calcular', { p_despues: cursor, p_limite: TANDA, p_solo_nuevos: soloNuevos });
    for (const it of r.items) {
      const v = parsearVector(it.vec);
      if (v) { ids.push(it.id); vecs.push(v); }
    }
    if (r.items.length < TANDA) break;
    cursor = r.items[r.items.length - 1].id;
  }
  return { ids, vecs };
}

async function escribir(rpc, ids, coords, modelo) {
  const tandas = Math.max(1, Math.ceil(ids.length / GUARDAR));
  for (let t = 0; t < tandas; t++) {
    const i = t * GUARDAR;
    await rpc('guardar_mapa', {
      p_puntos: ids.slice(i, i + GUARDAR).map((id, k) => ({ id, x: coords[i + k][0], y: coords[i + k][1] })),
      p_modelo: t === tandas - 1 ? (modelo ?? null) : null,   // el modelo va con la última tanda: así nunca queda uno nuevo con puntos viejos
    });
  }
}

export async function calcularMapa({ rpc = rpcReal, dry = false, log = console.log } = {}) {
  // t-SNE no tiene «modelo» con el que proyectar un punto suelto sin mover a los demás: cada cálculo
  // recoloca todo el mapa. Es determinista (inicio PCA, sin azar): los mismos vectores, el mismo mapa.
  const { ids, vecs } = await leerVectores(rpc, false);
  log(`  ${ids.length} requisitos con embedding`);
  if (ids.length < MIN_PUNTOS) { log(`  ✗ hacen falta al menos ${MIN_PUNTOS}: nada que hacer\n`); return { escritos: 0, modo: 'nada' }; }
  const t0 = Date.now();
  const coords = disponer(vecs);
  log(`  t-SNE calculado en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const modelo = { version: VERSION_TSNE, metodo: 'tsne', dims: vecs[0].length, n: ids.length };
  if (!dry) await escribir(rpc, ids, coords, modelo);
  log(dry ? '  (dry-run: no se ha escrito nada)\n' : `  ✓ ${ids.length} puntos escritos\n`);
  return { escritos: dry ? 0 : ids.length, modo: 'completo', modelo, ids, coords };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./gemini_env.mjs');
  const { exige } = await import('./entorno.mjs');
  exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  console.log(`\n  Base: ${new URL(process.env.SUPABASE_URL).host}`);
  try { await calcularMapa({ dry: process.argv.includes('--dry') }); }
  catch (e) { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); }
}
