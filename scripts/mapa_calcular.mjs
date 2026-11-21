#!/usr/bin/env node
// Calcula las coordenadas 2D del mapa de requisitos (lib/proyeccion.mjs: PCA determinista) y las
// guarda en la base. Es mantenimiento, no una petición: GET /api/v1/map solo las lee.
//
//   node scripts/mapa_calcular.mjs            solo los requisitos SIN coordenadas, con el modelo guardado
//                                             (los demás no se mueven: añadir unos pocos no revuelve el mapa)
//   node scripts/mapa_calcular.mjs --refit    reajusta el modelo con todos los vectores y reescribe todo
//                                             (tras reembeber.mjs, o cuando haya crecido mucho la base);
//                                             alinea los ejes con los anteriores: no voltea el mapa
//   node scripts/mapa_calcular.mjs --dry      calcula y cuenta, no escribe
//
// Sin modelo guardado se hace un --refit. Hacen falta al menos 3 requisitos con embedding.
// Si se interrumpe a mitad de un --refit, repítelo con --refit.

import { pathToFileURL } from 'node:url';
import { rpc as rpcReal } from '../lib/bd.mjs';
import { ajustar, proyectar, parsearVector } from '../lib/proyeccion.mjs';

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

export async function calcularMapa({ rpc = rpcReal, refit = false, dry = false, log = console.log } = {}) {
  const modelo = await rpc('mapa_modelo');

  if (!modelo || refit) {
    const { ids, vecs } = await leerVectores(rpc, false);
    log(`  ${ids.length} requisitos con embedding${modelo ? '' : ' (no hay modelo guardado: se ajusta uno)'}`);
    if (ids.length < MIN_PUNTOS) { log(`  ✗ hacen falta al menos ${MIN_PUNTOS}: nada que hacer\n`); return { escritos: 0, modo: 'nada' }; }
    const nuevo = ajustar(vecs, { previo: modelo });
    const coords = vecs.map((v) => proyectar(nuevo, v));
    log(`  eje 1 explica el ${(nuevo.varianza[0] * 100).toFixed(1)} % de la varianza, eje 2 el ${(nuevo.varianza[1] * 100).toFixed(1)} %`);
    if (!dry) await escribir(rpc, ids, coords, nuevo);
    log(dry ? '  (dry-run: no se ha escrito nada)\n' : `  ✓ ${ids.length} puntos escritos y modelo guardado\n`);
    return { escritos: dry ? 0 : ids.length, modo: 'refit', modelo: nuevo, ids, coords };
  }

  const { ids, vecs } = await leerVectores(rpc, true);
  if (!ids.length) { log('  Nada que calcular: todos los requisitos con embedding ya tienen coordenadas.\n'); return { escritos: 0, modo: 'incremental' }; }
  const coords = vecs.map((v) => proyectar(modelo, v));
  const crecido = (modelo.n + ids.length) / modelo.n - 1;
  log(`  ${ids.length} requisitos nuevos, proyectados con el modelo guardado (ajustado con ${modelo.n})`);
  if (crecido > 0.5) log(`  ⚠ la base ha crecido un ${(crecido * 100).toFixed(0)} % desde el último ajuste: conviene repetir con --refit`);
  if (!dry) await escribir(rpc, ids, coords, null);
  log(dry ? '  (dry-run: no se ha escrito nada)\n' : `  ✓ ${ids.length} puntos escritos\n`);
  return { escritos: dry ? 0 : ids.length, modo: 'incremental', ids, coords };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./gemini_env.mjs');
  const { exige } = await import('./entorno.mjs');
  exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  console.log(`\n  Base: ${new URL(process.env.SUPABASE_URL).host}`);
  try { await calcularMapa({ refit: process.argv.includes('--refit'), dry: process.argv.includes('--dry') }); }
  catch (e) { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); }
}
