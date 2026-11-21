import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRequisito, validarLote } from '../lib/regulacion.mjs';
import { vectorSimulado } from '../scripts/sembrar_regulacion.mjs';

const bueno = () => ({
  slug: 'gambling-example-requirement', title: 'Example regulatory requirement',
  statement: 'The operator must keep a record of every deposit made by a player.',
  criteria: ['Each deposit is recorded.', 'The record cannot be edited.'], kind: 'functional',
  categories: [{ slug: 'online-gambling', priority: 1 }],
  jurisdictions: [{ code: 'ES', note: 'Spanish detail goes here.', source: { norm: 'Ley X art. 1', url: 'https://www.boe.es/x', date: '2026-01-01' } }],
  tests: [{ slug: 'gambling-example-requirement-test-1', title: 'Deposit is recorded', scenario: 'Given a player. When they deposit. Then it is recorded.', type: 'integration', priority: 1 }],
});

test('un requisito bien formado no da errores', () => assert.deepEqual(validarRequisito(bueno()), []));

test('detecta lo que rompe las reglas del proyecto', () => {
  const r = bueno();
  r.statement = 'Operators need deposit records.';
  r.criteria = ['one'];
  r.jurisdictions[0].source.url = 'http://insecure';
  r.jurisdictions[0].source.date = '01/01/2026';
  r.tests[0].scenario = 'It works';
  const e = validarRequisito(r).join(' | ');
  assert.match(e, /statement debe empezar/);
  assert.match(e, /criteria/);
  assert.match(e, /source\.url/);
  assert.match(e, /source\.date/);
  assert.match(e, /dado\/cuando\/entonces/);
});

test('un requisito dice QUÉ, nunca DÓNDE', () => {
  const r = bueno();
  r.statement = 'The operator must show a banner on the home page with the licence.';
  assert.match(validarRequisito(r).join(' '), /dónde/);
});

test('jurisdicción y categoría deben existir cuando se comprueban contra la base', () => {
  const e = validarRequisito(bueno(), { jurisdiccionesValidas: new Set(['EU']), categoriasValidas: new Set(['security']) }).join(' ');
  assert.match(e, /jurisdicción desconocida: ES/);
  assert.match(e, /categoría desconocida/);
});

test('validarLote: slugs repetidos', () => {
  assert.ok(validarLote([bueno(), bueno()]).some((m) => /repetido/.test(m)));
});

test('vectorSimulado: 768 dimensiones, normalizado y determinista', () => {
  const v = vectorSimulado('hola');
  assert.equal(v.length, 768);
  assert.ok(Math.abs(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) - 1) < 1e-9);
  assert.deepEqual(vectorSimulado('hola'), v);
  assert.notDeepEqual(vectorSimulado('adiós'), v);
});
