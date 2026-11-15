import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/entrada.js';

// res mínimo: recoge estado, cabeceras y cuerpo.
function res() {
  const r = { statusCode: 0, cab: {}, cuerpo: '', headersSent: false,
    setHeader(k, v) { this.cab[k.toLowerCase()] = v; },
    end(c = '') { this.cuerpo = String(c); this.headersSent = true; } };
  return r;
}
const peticion = (metodo, url) => ({ method: metodo, url, headers: {} });

test('la ruta original llega por ?__ruta (rewrite de vercel.json) y se resuelve igual', async () => {
  const r = res();
  await handler(peticion('GET', '/api/entrada?__ruta=v1/no-existe&x=1'), r);
  assert.equal(r.statusCode, 404);
  assert.equal(JSON.parse(r.cuerpo).error, 'not found');
});

test('el preflight CORS de /api/v1 contesta 204 también por el rewrite', async () => {
  const r = res();
  await handler(peticion('OPTIONS', '/api/entrada?__ruta=v1/requirements'), r);
  assert.equal(r.statusCode, 204);
  assert.equal(r.cab['access-control-allow-origin'], '*');
});

test('/api/me no lleva CORS abierto y el método equivocado da 405 con Allow', async () => {
  const r = res();
  await handler(peticion('PUT', '/api/entrada?__ruta=v1/projects'), r);
  assert.equal(r.statusCode, 405);
  assert.match(r.cab.allow, /GET/);
  const m = res();
  await handler(peticion('GET', '/api/entrada?__ruta=me/nada'), m);
  assert.equal(m.cab['access-control-allow-origin'], undefined);
});

test('una ruta mal codificada nunca revienta (acaba en un error HTTP)', async () => {
  const r = res();
  await handler(peticion('GET', '/api/entrada?__ruta=v1/requirements/%E0%A4%A'), r);
  assert.ok(r.statusCode >= 400 && r.statusCode < 600, `estado ${r.statusCode}`);   // sin base en el test: el limitador da 503
});

test('sin __ruta (ensayos locales) usa la ruta tal cual', async () => {
  const r = res();
  await handler(peticion('GET', '/api/v1/no-existe'), r);
  assert.equal(r.statusCode, 404);
});
