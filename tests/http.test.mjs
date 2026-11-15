import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { baseUrl } from '../lib/http.mjs';
import { mensajeAgente } from '../lib/mensaje_agente.mjs';

const req = (headers) => ({ headers });
afterEach(() => { delete process.env.PUBLIC_BASE_URL; });

test('sin PUBLIC_BASE_URL, la base sale del host de la petición', () => {
  assert.equal(baseUrl(req({ host: 'db-public-requirements.vercel.app' })), 'https://db-public-requirements.vercel.app');
  assert.equal(baseUrl(req({ 'x-forwarded-host': 'a.example.com, b.example.com' })), 'https://a.example.com');
  assert.equal(baseUrl(req({ host: '127.0.0.1:3000' })), 'http://127.0.0.1:3000');
  assert.equal(baseUrl(req({ host: 'mal host!' })), 'https://<this-site>');
});

test('con PUBLIC_BASE_URL, siempre esa (aunque entren por otro dominio) y sin barra final', () => {
  process.env.PUBLIC_BASE_URL = 'https://joderestatodocogido.com/proyectos/requirements-db/app';
  assert.equal(baseUrl(req({ host: 'db-public-requirements.vercel.app' })), 'https://joderestatodocogido.com/proyectos/requirements-db/app');
  assert.equal(baseUrl(req({})), 'https://joderestatodocogido.com/proyectos/requirements-db/app');
});

test('una PUBLIC_BASE_URL rara se ignora (solo https, sin query ni caracteres extraños)', () => {
  for (const mala of ['http://x.example.com', 'https://x.example.com/?a=1', 'https://x.example.com/a b', 'javascript:alert(1)', 'https://x.example.com/']) {
    process.env.PUBLIC_BASE_URL = mala;
    assert.equal(baseUrl(req({ host: 'ok.example.com' })), 'https://ok.example.com', mala);
  }
});

test('el mensaje al agente cuelga de la base pública: la API está en {base}/api', () => {
  const base = 'https://joderestatodocogido.com/proyectos/requirements-db/app';
  const m = mensajeAgente({ base, proyecto: { id: 4, name: 'Mi app' } });
  assert.match(m, new RegExp(`PUT ${base.replaceAll('/', '\\/')}\\/api\\/v1\\/projects\\/4\\/items`));
});
