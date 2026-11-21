#!/usr/bin/env node
// Refresca a mano las métricas de popularidad de los aceleradores (lo mismo que hace
// GET /api/cron/metricas, pero sin el tope de 30 s: encadena lotes hasta acabar).
//
//   node scripts/actualizar_metricas.mjs                  lo pendiente (más de 14 días sin intentar), por lotes
//   node scripts/actualizar_metricas.mjs --dry            solo lista qué tocaría
//   node scripts/actualizar_metricas.mjs --todos          todos los que tengan origen, aunque sean recientes
//   node scripts/actualizar_metricas.mjs --limite=10      tamaño de lote (por defecto 25)
//   node scripts/actualizar_metricas.mjs --lotes=3        como mucho 3 lotes
//
// Necesita SUPABASE_URL y SUPABASE_SECRET_KEY (o supabase_admin_secret_key en ~/.secretos/home.env).
// GITHUB_TOKEN es opcional pero conviene: sin él GitHub deja 60 peticiones por hora y el proceso
// se para solo (queda reanudable: vuelve a lanzarlo más tarde). METRICAS_USER_AGENT: contacto opcional.

import './gemini_env.mjs';
import { refrescarLote, DIAS_REFRESCO } from '../lib/metricas/proceso.mjs';
import { rpc } from '../lib/bd.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const tiene = (n) => process.argv.includes(`--${n}`);
const limite = Math.min(Math.max(Number(arg('limite') ?? 25) || 25, 1), 100);
const maxLotes = Number(arg('lotes') ?? Infinity) || Infinity;
const inicio = new Date();
const antesDe = tiene('todos') ? inicio : new Date(inicio.getTime() - DIAS_REFRESCO * 86_400_000);

if (!process.env.GITHUB_TOKEN) console.log('  (sin GITHUB_TOKEN: GitHub permite 60 peticiones/hora)');

if (tiene('dry')) {
  const resumen = await rpc('metricas_resumen', { p_antes_de: antesDe.toISOString() });
  const lote = await rpc('metricas_pendientes', { p_limite: 100, p_antes_de: antesDe.toISOString() });
  console.log(`  ${resumen.with_source} aceleradores con origen · ${resumen.pending} pendientes · ${resumen.with_error} con error`);
  for (const a of lote) console.log(`    ${a.slug}  ${a.repo_url ?? ''}  ${a.registry ? `${a.registry}:${a.package}` : ''}`);
  process.exit(0);
}

let total = { processed: 0, saved: 0, with_error: 0 };
for (let n = 1; n <= maxLotes; n++) {
  const r = await refrescarLote({ limite, presupuestoMs: 10 * 60_000, antesDe });
  total = { processed: total.processed + r.processed, saved: total.saved + r.saved, with_error: total.with_error + r.with_error };
  console.log(`  lote ${n}: ${r.processed} procesados, ${r.saved} guardados, ${r.with_error} con error, ${r.pending_after} pendientes`
    + (r.stopped_by ? ` · parado por ${r.stopped_by}${r.rate_limited_sources.length ? ` (${r.rate_limited_sources.join(', ')})` : ''}` : ''));
  if (r.stopped_by === 'rate_limit') { console.log('  Una fuente nos ha frenado: vuelve a lanzarlo más tarde (reanuda donde se quedó).'); break; }
  if (!r.processed || !r.pending_after) break;
}
console.log(`  Total: ${total.processed} procesados, ${total.saved} guardados, ${total.with_error} con error.`);
