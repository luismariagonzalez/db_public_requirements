// La puerta común de los endpoints: identidad y cupo. El método y el CORS los
// resuelve api/entrada.js. Devuelve la identidad si la petición puede seguir,
// o null si ya se ha respondido (error, 429…).

import { rpc } from './bd.mjs';
import { identificar } from './auth.mjs';
import { enviar, error } from './http.mjs';

// Cupos de lectura por tipo de llamante (por minuto / por día).
export const LIMITES = {
  anon: { min: 20, dia: 300 },
  key: { min: 120, dia: 10_000 },
  user: { min: 60, dia: 3_000 },
};

// silencioso: devuelve false sin responder (para cupos internos, como el de Gemini).
export async function aplicarCupo(res, clave, min, dia, { silencioso = false } = {}) {
  let c;
  try {
    c = await rpc('cupo', { p_clave: clave, p_limite_min: min, p_limite_dia: dia });
  } catch {
    // Sin cupo no hay protección: mejor cerrar que dejar pasar sin límite.
    if (silencioso) return false;
    error(res, 503, 'rate limiter unavailable, try again shortly', { 'retry-after': '5' });
    return false;
  }
  if (!c.allowed) {
    if (silencioso) return false;
    error(res, 429, `rate limit exceeded (${c.scope}). Sign in and create an API key for higher limits.`,
      { 'retry-after': String(c.retry_after) });
    return false;
  }
  if (!silencioso) {
    res.setHeader('x-ratelimit-remaining-minute', String(c.remaining_minute));
    res.setHeader('x-ratelimit-remaining-day', String(c.remaining_day));
  }
  return true;
}

// Opciones:
//   soloUsuario  hace falta sesión de Clerk (una API key no vale): aportar, gestionar keys, borrar datos
//   cuenta       vale sesión O API key (el agente trabaja con la key): proyectos y sugerencias
// Sin ninguna, cualquiera: anónimo, key o sesión.
export async function entrar(req, res, { soloUsuario = false, cuenta = false } = {}) {
  let ident;
  try { ident = await identificar(req); }
  catch { error(res, 503, 'authentication unavailable'); return null; }

  if (ident.error) { error(res, 401, ident.error, { 'www-authenticate': 'Bearer' }); return null; }
  if (soloUsuario && ident.tipo !== 'user') {
    error(res, 401, 'sign in required (a session token, not an API key)', { 'www-authenticate': 'Bearer' });
    return null;
  }
  if (cuenta && ident.tipo === 'anon') {
    error(res, 401, 'an account is required: send a session token or an API key (Authorization: Bearer …)',
      { 'www-authenticate': 'Bearer' });
    return null;
  }

  const lim = LIMITES[ident.tipo];
  if (!(await aplicarCupo(res, ident.id, lim.min, lim.dia))) return null;
  return ident;
}

// Traduce los errores de la base (mensajes de las funciones srv_*) a respuestas.
// mapa: [[/regex/, estado, 'mensaje']]; lo que no esté en el mapa es un 502.
export function errorBd(res, e, mapa = []) {
  for (const [re, estado, msg] of mapa)
    if (re.test(e.message)) return error(res, estado, msg);
  return error(res, 502, 'database unavailable');
}

export { enviar, error };
