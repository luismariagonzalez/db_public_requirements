#!/usr/bin/env node
// Recalcula los embeddings de los requisitos YA existentes con el texto nuevo (título + enunciado +
// criterios + clase + todas sus etiquetas: lib/texto_embedding.mjs). Hay que ejecutarlo UNA vez tras
// desplegar la migración 0006 y el código que la acompaña; después, el mapa se recalcula con
// `node scripts/mapa_calcular.mjs --refit` (los vectores cambian y los ejes también).
//
//   node scripts/reembeber.mjs --dry          cuántos faltan y un ejemplo del texto; no escribe ni gasta Gemini
//   node scripts/reembeber.mjs                reembebe por lotes (50 por llamada a Gemini)
//   node scripts/reembeber.mjs --lote=100 --limite=500
//
// Reanudable: cada requisito guarda en `embedding_v` con qué versión del texto se calculó; solo se
// procesan los de versión anterior, así que si se corta (cupo de Gemini, red…) basta con repetirlo.
// Necesita SUPABASE_URL, SUPABASE_SECRET_KEY y GEMINI_API_KEY (como sembrar.mjs).

import { pathToFileURL } from 'node:url';
import { rpc as rpcReal } from '../lib/bd.mjs';
import { embedLote as embedLoteReal, aLiteral } from '../lib/gemini.mjs';
import { textoParaEmbedding, indexarCategorias, VERSION_TEXTO } from '../lib/texto_embedding.mjs';

// deps inyectables: los ensayos usan una base local y vectores simulados.
export async function reembeber({ rpc = rpcReal, embedLote = embedLoteReal, dry = false, lote = 50, limite = Infinity,
  version = VERSION_TEXTO, log = console.log } = {}) {
  const idx = indexarCategorias(await rpc('categorias'));
  let cursor = 0, hechos = 0, pendientes = null;

  for (;;) {
    const pedir = Math.max(1, Math.min(lote, limite - hechos));
    const r = await rpc('requisitos_para_embeber', { p_version: version, p_despues: cursor, p_limite: pedir });
    if (pendientes === null) {
      pendientes = r.pending;
      log(`  ${pendientes} requisitos con el texto antiguo (embedding_v < ${version})`);
      if (dry) {
        const muestra = r.items[0];
        if (muestra) log(`\n  Ejemplo (${muestra.slug}):\n${textoParaEmbedding(muestra, idx).split('\n').map((l) => `    ${l}`).join('\n')}\n`);
        log(`  (dry-run: no se ha escrito nada ni se ha llamado a Gemini; haría unas ${Math.ceil(pendientes / lote)} llamadas por lotes de ${lote})\n`);
        return { pendientes, hechos: 0 };
      }
    }
    if (!r.items.length || hechos >= limite) break;

    const vecs = await embedLote(r.items.map((it) => textoParaEmbedding(it, idx)));
    for (let i = 0; i < r.items.length; i++)
      await rpc('guardar_embedding', { p_id: r.items[i].id, p_vec: aLiteral(vecs[i]), p_version: version });
    hechos += r.items.length;
    cursor = r.items[r.items.length - 1].id;
    log(`  … ${hechos}/${Math.min(pendientes, limite)}`);
    if (r.items.length < pedir) break;
  }
  log(`  ✓ ${hechos} embeddings recalculados${pendientes > hechos ? ` (quedan ${pendientes - hechos}: repite el comando)` : ''}\n`);
  return { pendientes, hechos };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./gemini_env.mjs');
  const { exige } = await import('./entorno.mjs');
  const arg = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
  const dry = process.argv.includes('--dry');
  exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  if (!dry) exige('GEMINI_API_KEY');
  console.log(`\n  Base: ${new URL(process.env.SUPABASE_URL).host}`);
  try { await reembeber({ dry, lote: arg('lote', 50), limite: arg('limite', Infinity) }); }
  catch (e) { console.error(`\n  ✗ ${e.message}\n  Repite el comando: sigue por donde se quedó.\n`); process.exit(1); }
}
