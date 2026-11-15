// Utilidades HTTP para las funciones de api/ (Vercel Node, sin framework).

import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function enviar(res, estado, cuerpo, cabeceras = {}) {
  const esTexto = typeof cuerpo === 'string';
  res.statusCode = estado;
  res.setHeader('content-type', esTexto ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(cabeceras)) res.setHeader(k, v);
  res.end(esTexto ? cuerpo : JSON.stringify(cuerpo));
}

export const error = (res, estado, mensaje, extra = {}) => enviar(res, estado, { error: mensaje }, extra);

// CORS abierto solo para la lectura pública (los agentes llaman desde cualquier
// sitio). Lo de /api/me y /api/contribute va con credenciales: sin CORS abierto.
export function corsPublico(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-max-age', '86400');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}

export async function leerJson(req, maxBytes = 16_000) {
  if (req.body && typeof req.body === 'object') return req.body;   // Vercel ya lo parseó
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > maxBytes) throw Object.assign(new Error('cuerpo demasiado grande'), { status: 413 });
    trozos.push(t);
  }
  try { return JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}

// URL base pública (para los ejemplos que se le dan al agente). Con PUBLIC_BASE_URL fijada
// —p. ej. https://joderestatodocogido.com/proyectos/requirements-db/app, donde la home sirve esta
// app— sale siempre esa, entre en la petición por el dominio que entre; la API cuelga de
// ella (`${base}/api/v1/…`). Sin ella, se deduce del host de la petición.
export function baseUrl(req) {
  const fija = process.env.PUBLIC_BASE_URL;
  if (fija && /^https:\/\/[a-z0-9.-]+(\/[a-z0-9._~-]+)*$/i.test(fija)) return fija;
  const h = req.headers ?? {};
  const host = String(h['x-forwarded-host'] ?? h.host ?? '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return 'https://<this-site>';
  const proto = /^localhost|^127\./.test(host) ? 'http' : 'https';
  return `${proto}://${host}`;
}

// IP del cliente. En Vercel, x-real-ip la pone la plataforma y no se puede
// falsear desde fuera; x-forwarded-for es el plan B.
export function ipDe(req) {
  const h = req.headers ?? {};
  return String(h['x-real-ip'] ?? String(h['x-forwarded-for'] ?? '').split(',')[0] ?? '').trim() || 'desconocida';
}
