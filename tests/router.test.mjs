import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilar, resolver, queryDe } from '../lib/router.mjs';

const h1 = () => 1, h2 = () => 2, h3 = () => 3;
const rutas = compilar([
  ['GET', '/api/v1/projects', h1],
  ['POST', '/api/v1/projects', h2],
  ['GET', '/api/v1/projects/:id', h3],
  ['PUT', '/api/v1/projects/:id/items', h1],
]);

test('resuelve método y ruta, y extrae parámetros', () => {
  assert.equal(resolver(rutas, 'GET', '/api/v1/projects').handler, h1);
  assert.equal(resolver(rutas, 'POST', '/api/v1/projects').handler, h2);
  const r = resolver(rutas, 'GET', '/api/v1/projects/42');
  assert.equal(r.handler, h3);
  assert.deepEqual(r.params, { id: '42' });
  assert.equal(resolver(rutas, 'PUT', '/api/v1/projects/7/items').params.id, '7');
});

test('barra final admitida; 404 y 405 con los métodos permitidos', () => {
  assert.equal(resolver(rutas, 'GET', '/api/v1/projects/').estado, 200);
  assert.equal(resolver(rutas, 'GET', '/api/v1/otra').estado, 404);
  const m = resolver(rutas, 'DELETE', '/api/v1/projects');
  assert.equal(m.estado, 405);
  assert.deepEqual(m.permitidos.sort(), ['GET', 'POST']);
});

test('un parámetro no cruza barras y se decodifica', () => {
  assert.equal(resolver(rutas, 'GET', '/api/v1/projects/a/b').estado, 404);
  assert.equal(resolver(rutas, 'GET', '/api/v1/projects/a%20b').params.id, 'a b');
  assert.equal(resolver(rutas, 'GET', '/api/v1/projects/%E0%A4%A').estado, 400);
});

test('queryDe: claves repetidas pasan a array', () => {
  assert.deepEqual(queryDe(new URL('http://x/?a=1&b=2&b=3')), { a: '1', b: ['2', '3'] });
});
