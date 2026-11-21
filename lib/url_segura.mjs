// Comprobar que la URL de un acelerador existe SIN abrir la puerta a SSRF.
//
// La URL la escribe una persona: puede apuntar a http://169.254.169.254, a
// localhost o a un host que redirige a la red interna. Reglas:
//   · solo https, sin usuario:contraseña, puerto 443 (o ninguno), ≤ 300 caracteres
//   · nada de localhost, .local, .internal ni IPs literales privadas/reservadas
//   · la dirección a la que se CONECTA se valida en el propio connect (lookup de
//     https.request), así que un DNS que cambie de respuesta no cuela una IP privada
//   · las redirecciones se siguen a mano (máx. 3) y cada salto pasa las mismas reglas
//   · tiempo límite corto; solo se lee el estado, el cuerpo se descarta
// `deps` es inyectable para los tests (sin red).

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';

export const MAX_REDIRECCIONES = 3;
export const TIMEOUT_MS = 6000;
export const MAX_URL = 300;

// ¿Dirección IP privada, loopback, link-local, reservada o de multidifusión?
export function esIpPrivada(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)          // CGNAT
      || (a === 169 && b === 254)                    // link-local, metadatos de la nube
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)                      // 192.0.0.0/24 y 192.0.2.0/24
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0);
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapeada = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return esIpPrivada(mapeada[1]);
    if (/^::ffff:/.test(s) || s === '::' || s === '::1') return true;
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^(2001:0?db8|2001:0?:)/.test(s)
      || /^64:ff9b/.test(s) || /^100:/.test(s);
  }
  return true;   // lo que no sea una IP válida no se da por público
}

// Reglas sintácticas. Devuelve { ok, url } o { ok:false, motivo }.
export function validarUrlAcelerador(texto) {
  const crudo = String(texto ?? '').trim();
  if (!crudo || crudo.length > MAX_URL) return { ok: false, motivo: 'the URL is empty or longer than 300 characters' };
  let u;
  try { u = new URL(crudo); } catch { return { ok: false, motivo: 'the URL is not valid' }; }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'the URL must use https' };
  if (u.username || u.password) return { ok: false, motivo: 'the URL must not contain credentials' };
  if (u.port && u.port !== '443') return { ok: false, motivo: 'the URL must use the standard https port' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host)) {
    if (esIpPrivada(host)) return { ok: false, motivo: 'the URL points to a private or reserved address' };
  } else {
    if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)
        || /^\d+(\.\d+)*$/.test(host))
      return { ok: false, motivo: 'the URL must point to a public website' };
  }
  u.hash = '';
  return { ok: true, url: u.href };
}

// DNS con filtro: se usa como `lookup` de https.request, así la IP validada es la IP usada.
function lookupPublico(host, opts, cb) {
  dnsLookup(host, { ...opts, all: true }, (err, direcciones) => {
    if (err) return cb(err);
    const buenas = direcciones.filter((d) => !esIpPrivada(d.address));
    if (!buenas.length || buenas.length !== direcciones.length) return cb(new Error('private address'));
    if (opts?.all) return cb(null, buenas);
    cb(null, buenas[0].address, buenas[0].family);
  });
}

// Una petición HEAD/GET que solo devuelve estado y cabecera Location.
export function peticionHttps(url, metodo = 'GET') {
  return new Promise((resolver, rechazar) => {
    const req = request(url, {
      method: metodo, lookup: lookupPublico, timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; RequirementsDB-linkcheck)', accept: '*/*' },
    }, (res) => {
      res.destroy();   // el cuerpo no interesa
      resolver({ status: res.statusCode, location: res.headers.location });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', rechazar);
    req.end();
  });
}

// ¿Responde esa URL? Misma regla que la semilla: < 400, o 401/403/429 (existe pero filtra bots).
// Devuelve { ok, url? , motivo? , red? } — red:true = fallo de conexión (puede ser pasajero).
export async function comprobarUrlSegura(texto, { peticion = peticionHttps } = {}) {
  let v = validarUrlAcelerador(texto);
  if (!v.ok) return v;
  const inicial = v.url;
  let actual = inicial;
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    let r;
    try { r = await peticion(actual, 'GET'); }
    catch (e) { return { ok: false, motivo: 'the URL could not be reached', red: true, detalle: String(e?.message ?? e).slice(0, 80) }; }
    if (r.status >= 300 && r.status < 400 && r.location) {
      let siguiente;
      try { siguiente = new URL(r.location, actual).href; } catch { return { ok: false, motivo: 'the URL redirects somewhere invalid' }; }
      v = validarUrlAcelerador(siguiente);
      if (!v.ok) return { ok: false, motivo: `the URL redirects somewhere not allowed (${v.motivo})` };
      actual = v.url;
      continue;
    }
    if (r.status < 400 || [401, 403, 429].includes(r.status)) return { ok: true, url: inicial, final: actual };
    return { ok: false, motivo: `the URL answers HTTP ${r.status}` };
  }
  return { ok: false, motivo: 'the URL redirects too many times' };
}
