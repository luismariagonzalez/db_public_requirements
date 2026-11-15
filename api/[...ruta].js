// La API entera en UNA función de Vercel (el plan Hobby limita cuántas caben).
// Las rutas están en lib/rutas.mjs; la lógica, en lib/handlers/.
import { rutas } from '../lib/rutas.mjs';
import { resolver, queryDe } from '../lib/router.mjs';
import { corsPublico, error } from '../lib/http.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname;
  req.query = queryDe(url);

  // CORS abierto solo en /api/v1: se autentica con la cabecera Authorization, no
  // con cookies, así que no hay nada que robar por otro origen. /api/me y
  // /api/contribute (sesión) no lo llevan.
  if (ruta.startsWith('/api/v1/') && corsPublico(req, res)) return;

  const r = resolver(rutas, req.method, ruta);
  if (r.estado === 404) return error(res, 404, 'not found');
  if (r.estado === 400) return error(res, 400, 'malformed URL');
  if (r.estado === 405) return error(res, 405, `method not allowed (use ${r.permitidos.join(', ')})`, { allow: r.permitidos.join(', ') });
  try { await r.handler(req, res, r.params); }
  catch { if (!res.headersSent) error(res, 500, 'internal error'); }
}
