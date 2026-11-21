// GET /api/v1/map: un punto 2D por requisito publicado, para la pantalla del mapa (web/mapa.html).
// Las coordenadas NO se calculan aquí: las deja scripts/mapa_calcular.mjs (proyección PCA de los
// embeddings, lib/proyeccion.mjs). Sin enunciados largos: título, prioridad, clase, tipo de app
// principal, temas y copias. Pasa por el mismo cupo de lectura que las demás rutas.

import { rpc } from '../bd.mjs';
import { entrar, enviar, errorBd } from '../entrada.mjs';

// Cambia solo cuando alguien recalcula el mapa: la CDN lo guarda media hora y sirve el viejo mientras refresca.
const CACHE_MAPA = { 'cache-control': 'public, s-maxage=1800, stale-while-revalidate=86400' };

export async function mapa(req, res, _params, deps = { rpc }) {
  if (!(await entrar(req, res))) return;
  try {
    const m = await deps.rpc('mapa');
    const points = Array.isArray(m?.points) ? m.points : [];
    enviar(res, 200, { count: points.length, generated_at: m?.generated_at ?? null, points }, CACHE_MAPA);
  } catch (e) { errorBd(res, e); }
}
