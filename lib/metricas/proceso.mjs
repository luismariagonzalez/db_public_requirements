// El proceso de refresco: toma un lote de aceleradores pendientes, consulta sus fuentes y
// guarda el resultado. Reanudable: la base marca el último intento de cada acelerador
// (metricas_intentado_en) y siempre sirve primero los más atrasados, así que cada pasada
// continúa donde se quedó la anterior. Lo usan la ruta /api/cron/metricas y
// scripts/actualizar_metricas.mjs. Dependencias inyectables (pruebas sin red ni base).

import { rpc as rpcReal } from '../bd.mjs';
import { crearContexto, consultarAcelerador } from './cliente.mjs';

export const DIAS_REFRESCO = 14;

// opciones:
//   limite          cuántos aceleradores como máximo (por defecto 25)
//   presupuestoMs   tiempo máximo del lote (por defecto 22 s: la función de Vercel tiene 30)
//   antesDe         Date: solo los no intentados desde entonces (por defecto: hace 14 días)
//   forzar          ignora la antigüedad: todos los que tengan origen (se para al recorrerlos una vez)
// → { processed, saved, with_error, skipped_rate_limited, pending_after, stopped_by, rate_limited_sources }
export async function refrescarLote({ limite = 25, presupuestoMs = 22_000, antesDe = null, forzar = false,
  deps = {} } = {}) {
  const rpc = deps.rpc ?? rpcReal;
  const ctx = deps.ctx ?? crearContexto();
  const ahora = deps.ahora ?? Date.now;
  const inicio = ahora();
  const umbral = (forzar ? new Date(inicio) : (antesDe ?? new Date(inicio - DIAS_REFRESCO * 86_400_000))).toISOString();

  const pendientes = await rpc('metricas_pendientes', { p_limite: limite, p_antes_de: umbral });
  const frenados = new Set();
  const r = { processed: 0, saved: 0, with_error: 0, skipped_rate_limited: 0, pending_after: 0, stopped_by: null, rate_limited_sources: [] };

  for (const a of pendientes) {
    if (ahora() - inicio > presupuestoMs) { r.stopped_by = 'time'; break; }
    let res;
    try { res = await consultarAcelerador(ctx, a, { frenados }); }
    catch (e) { res = { datos: { error: `unexpected: ${String(e.message).slice(0, 120)}` }, limitado: false }; }
    r.processed++;
    if (res.limitado) { r.skipped_rate_limited++; continue; }   // sin marcar: se repite en la próxima pasada
    try {
      await rpc('guardar_metricas', { p_slug: a.slug, p_datos: res.datos });
      r.saved++;
      if (res.datos.error) r.with_error++;
    } catch (e) {
      r.with_error++;   // un fallo al guardar un acelerador no tira el lote
    }
  }
  if (r.skipped_rate_limited && !r.stopped_by) r.stopped_by = 'rate_limit';
  r.rate_limited_sources = [...frenados];

  try { r.pending_after = (await rpc('metricas_resumen', { p_antes_de: umbral })).pending; }
  catch { r.pending_after = null; }
  return r;
}
