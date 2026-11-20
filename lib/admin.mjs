// Quién es admin y la puerta común de /api/admin/*.
//
// Es admin SOLO quien llega con una sesión de Clerk válida cuyo `sub` está en la variable de entorno
// ADMIN_SUBS (lista separada por comas). Una API key NUNCA vale, ni se consulta la base para ella.
// Todo fallo es un 403 igual (no se dice si fue la sesión, la clave o la lista) y ninguna respuesta
// de admin lleva cabeceras de caché públicas (cache-control: no-store). Cupo propio, aparte del
// público. No se expone ningún dato personal: los sub ajenos solo salen como hash corto con sal.

import { identificar } from './auth.mjs';
import { aplicarCupo } from './entrada.mjs';
import { error, sha256, ipDe } from './http.mjs';

export const LIMITE_ADMIN = { min: 120, dia: 5_000 };
export const LIMITE_INTENTOS = { min: 15, dia: 100 };
export const LIMITE_GEMINI_DIA = 40;

export const adminSubs = (env = process.env) =>
  new Set(String(env.ADMIN_SUBS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
export const esAdmin = (sub, env = process.env) => typeof sub === 'string' && sub !== '' && adminSubs(env).has(sub);

// Hash corto y con sal de un sub (o de cualquier identificador): lo único que el cuadro enseña de otras personas.
export const hashCorto = (sub, sal = process.env.IP_SALT ?? '') => (sub == null ? null : sha256(String(sal) + String(sub)).slice(0, 10));

export const CABECERAS_PRIVADAS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

// Devuelve { sub, hash } si la petición es de un admin; si no, ya ha respondido (403/429/503) y devuelve null.
// `deps` es inyectable para los tests.
export async function entrarAdmin(req, res, deps = {}) {
  const { identificar: ident = identificar, cupo = aplicarCupo, env = process.env } = deps;
  for (const [k, v] of Object.entries(CABECERAS_PRIVADAS)) res.setHeader(k, v);

  const prohibido = async () => {
    // Los intentos fallidos también gastan cupo (por IP con hash): no se puede sondear sin límite.
    const sal = env.IP_SALT ?? '';
    const ok = await cupo(res, 'adminfail|' + sha256(sal + ipDe(req)).slice(0, 16), LIMITE_INTENTOS.min, LIMITE_INTENTOS.dia, { silencioso: true });
    if (!ok) error(res, 429, 'too many attempts', { 'retry-after': '60' });
    else error(res, 403, 'forbidden');
    return null;
  };

  const cab = String(req.headers?.authorization ?? '');
  if (!/^Bearer\s+\S+$/i.test(cab)) return prohibido();           // sin sesión
  if (/^Bearer\s+rq_/i.test(cab)) return prohibido();              // una API key nunca vale (y no se consulta la base)
  if (!adminSubs(env).size) return prohibido();                    // sin ADMIN_SUBS no hay admins

  let id;
  try { id = await ident(req); }
  catch { error(res, 503, 'authentication unavailable'); return null; }
  if (!id || id.error || id.tipo !== 'user' || !esAdmin(id.id, env)) return prohibido();

  const hash = hashCorto(id.id, env.IP_SALT ?? '');
  if (!(await cupo(res, `admin|${hash}`, LIMITE_ADMIN.min, LIMITE_ADMIN.dia))) return null;
  return { sub: id.id, hash };
}
