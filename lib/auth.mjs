// Quién llama. Tres posibilidades, por este orden:
//   · Authorization: Bearer rq_…        API key  → { tipo: 'key',  id, owner }
//   · Authorization: Bearer <jwt Clerk> sesión   → { tipo: 'user', id: sub }
//   · nada                                      → { tipo: 'anon',  id: 'ip:<hash>' }
// Un Bearer que no vale es un 401, no se trata como anónimo en silencio.
//
// El JWT de Clerk se verifica con las claves públicas (JWKS) de su Frontend API;
// el dominio sale de la clave publicable, no hace falta la secreta.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { rpc } from './bd.mjs';
import { sha256, ipDe } from './http.mjs';

let verificador;
function clerk() {
  if (verificador) return verificador;
  // CLERK_PUBLISHABLE_KEY admite VARIAS claves separadas por comas: el navegador usa la de
  // producción (pk_live_…) en el dominio propio y la de desarrollo (pk_test_…) en vercel.app,
  // previews y local, y el servidor debe aceptar los tokens de las dos instancias.
  const emisores = (process.env.CLERK_PUBLISHABLE_KEY ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((pk) => Buffer.from(pk.split('_')[2] ?? '', 'base64').toString().replace(/\$$/, ''))
    .filter((d) => d.includes('.'))
    .map((dominio) => ({ dominio, jwks: createRemoteJWKSet(new URL(`https://${dominio}/.well-known/jwks.json`)) }));
  if (!emisores.length) throw new Error('CLERK_PUBLISHABLE_KEY ausente o inválida');
  const origenes = (process.env.CLERK_ORIGENES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  verificador = async (token) => {
    let ultimo;
    for (const { dominio, jwks } of emisores) {
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: `https://${dominio}`, clockTolerance: 10 });
        if (payload.azp && origenes.length && !origenes.includes(payload.azp)) throw new Error('origen no permitido');
        if (!payload.sub) throw new Error('token sin sub');
        return payload.sub;
      } catch (e) { ultimo = e; }
    }
    throw ultimo;
  };
  return verificador;
}

export const hashKey = (key) => sha256(key);

export async function identificar(req) {
  const cab = String(req.headers?.authorization ?? '');
  if (!cab) {
    const sal = process.env.IP_SALT ?? '';
    return { tipo: 'anon', id: 'ip:' + sha256(sal + ipDe(req)).slice(0, 16) };
  }
  const m = /^Bearer\s+(\S+)$/i.exec(cab);
  if (!m) return { error: 'Authorization header malformed' };
  const token = m[1];

  if (token.startsWith('rq_')) {
    const k = await rpc('key_por_hash', { p_hash: hashKey(token) });
    return k ? { tipo: 'key', id: 'key:' + k.id, owner: k.owner } : { error: 'invalid or revoked API key' };
  }
  try {
    const sub = await clerk()(token);
    return { tipo: 'user', id: sub, owner: sub };
  } catch {
    return { error: 'invalid session token' };
  }
}
