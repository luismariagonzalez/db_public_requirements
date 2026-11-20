// Procesos internos que dispara Vercel Cron (vercel.json → crons). No son API pública:
// se protegen con CRON_SECRET (Vercel lo envía como «Authorization: Bearer <CRON_SECRET>»).

import { timingSafeEqual } from 'node:crypto';
import { refrescarLote } from '../metricas/proceso.mjs';
import { enviar, error } from '../http.mjs';

// Sustituible en las pruebas.
export const dependencias = { refrescarLote };

function autorizado(req) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || secreto.length < 16) return null;   // sin secreto bien puesto, la ruta está cerrada
  const dado = Buffer.from(String(req.headers?.authorization ?? ''));
  const esperado = Buffer.from(`Bearer ${secreto}`);
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
}

// GET o POST /api/cron/metricas[?limit=25]
// Un lote de aceleradores (los más atrasados), con tope de tiempo. Reanudable: se puede llamar
// cuantas veces haga falta; solo toca lo que lleva más de 14 días sin intentarse.
// Vercel Hobby limita los cron a uno al día: se programa a diario y cada pasada solo avanza lo atrasado,
// de modo que cada acelerador se refresca cada ~15 días sin que el lote exceda los 30 s de la función.
export async function metricas(req, res) {
  const ok = autorizado(req);
  if (ok === null) return error(res, 503, 'cron not configured (set CRON_SECRET, 16+ characters)');
  if (!ok) return error(res, 401, 'unauthorized', { 'www-authenticate': 'Bearer' });

  const n = Number(req.query?.limit ?? 25);
  const limite = Number.isInteger(n) && n >= 1 && n <= 100 ? n : 25;
  try {
    const r = await dependencias.refrescarLote({ limite, presupuestoMs: 22_000 });
    enviar(res, 200, { ok: true, ...r }, { 'cache-control': 'no-store' });
  } catch {
    error(res, 502, 'database unavailable');
  }
}
