// Contadores de actividad diaria (lecturas, búsquedas, copias, errores…) para el cuadro de control.
//
// Cómo se alimenta SIN cargar cada petición: api/entrada.js clasifica la petición ya resuelta
// (`clasificar`, puro) y la anota en un buffer EN MEMORIA de la función; el buffer se vuelca a la base
// (`srv_registrar_eventos`, una sola escritura con todos los contadores) cuando lleva 25 eventos o
// cuando hace más de un minuto del último volcado. Así solo una petición de cada muchas paga la
// escritura. Es una cifra APROXIMADA: lo que quede en el buffer cuando Vercel apaga la instancia se
// pierde. Lo que importa (aportes, sugerencias, claves, proyectos) no pasa por aquí: se deriva de las
// tablas. Retención en la base: 1 año.

import { rpc } from './bd.mjs';

export const METRICAS = ['api_total', 'read', 'list', 'search', 'copy', 'export', 'error_5xx', 'rate_limited'];

// Qué cuenta una petición ya respondida. Lo de /api/admin no cuenta (es ruido del propio cuadro).
export function clasificar(metodo, ruta, estado, query = {}) {
  if (!ruta.startsWith('/api/') || ruta.startsWith('/api/admin/')) return [];
  const m = ['api_total'];
  if (estado >= 500) m.push('error_5xx');
  if (estado === 429) m.push('rate_limited');
  if (estado >= 400) return m;
  const ent = /^\/api\/v1\/(requirements|tests|accelerators)(\/[^/]+)?\/?$/.exec(ruta);
  if (metodo === 'GET' && ent) {
    if (ent[2]) m.push('read');
    else m.push(String(query.q ?? '').trim() ? 'search' : 'list');
  } else if (metodo === 'POST' && /^\/api\/v1\/copied\/?$/.test(ruta)) m.push('copy');
  else if (metodo === 'POST' && /^\/api\/v1\/export\/?$/.test(ruta)) m.push('export');
  return m;
}

// Buffer con volcado por lote. `volcar(objeto)` y `ahora()` se inyectan en los tests.
export function crearRegistro({ volcar, maxEventos = 25, maxMs = 60_000, ahora = Date.now, tope = 5_000 } = {}) {
  let buf = {}, n = 0, ultimo = 0, volcando = false;

  async function vaciar() {
    if (volcando || !n) return;
    volcando = true;
    const lote = buf; const nLote = n;
    buf = {}; n = 0; ultimo = ahora();
    try { await volcar(lote); }
    catch {
      // Si falla se devuelve al buffer (con tope, para no crecer sin fin).
      if (n + nLote <= tope) { for (const [k, v] of Object.entries(lote)) buf[k] = (buf[k] ?? 0) + v; n += nLote; }
    } finally { volcando = false; }
  }

  return {
    async anotar(metricas) {
      for (const k of metricas) { buf[k] = (buf[k] ?? 0) + 1; n++; }
      if (n >= maxEventos || ahora() - ultimo >= maxMs) await vaciar();
    },
    vaciar,
    pendiente: () => ({ ...buf }),
  };
}

export const registro = crearRegistro({ volcar: (eventos) => rpc('registrar_eventos', { p_eventos: eventos }) });
