import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFiltros } from '../lib/filtros.mjs';

test('valores por defecto', () => {
  const f = parseFiltros({});
  assert.ok(f.ok);
  assert.deepEqual([f.categorias, f.clases, f.prioridadMax, f.q, f.formato, f.limite],
    [[], [], 5, '', 'json', 50]);
});

test('lista separada por comas y repetida', () => {
  assert.deepEqual(parseFiltros({ category: 'Messaging, security' }).categorias, ['messaging', 'security']);
  assert.deepEqual(parseFiltros({ category: ['a1', 'b2,c3'] }).categorias, ['a1', 'b2', 'c3']);
});

test('rechaza lo inválido', () => {
  const malos = [{ max_priority: '0' }, { max_priority: '6' }, { max_priority: 'x' }, { limit: '500' },
    { format: 'xml' }, { kind: 'magic' }, { category: 'bad slug!' }, { q: 'x'.repeat(301) }];
  for (const q of malos) assert.ok(parseFiltros(q).error, JSON.stringify(q));
});

test('acepta prioridad, formato y límite válidos', () => {
  const f = parseFiltros({ max_priority: '2', format: 'MD', limit: '10', kind: 'security,privacy', q: ' chat ' });
  assert.deepEqual([f.prioridadMax, f.formato, f.limite, f.clases, f.q],
    [2, 'md', 10, ['security', 'privacy'], 'chat']);
});

import { parseFiltrosTests, parseFiltrosAceleradores } from '../lib/filtros.mjs';

test('requisitos: include, hide, project y tests_max_priority', () => {
  const f = parseFiltros({ include: 'tests,accelerators', hide: 'done,skipped', project: '12', tests_max_priority: '2' });
  assert.ok(f.ok);
  assert.deepEqual([f.incluirTests, f.incluirAceleradores, f.ocultar, f.proyecto, f.testsMax], [true, true, ['done', 'skipped'], 12, 2]);
  for (const q of [{ include: 'magia' }, { hide: 'hecho' }, { project: '0' }, { project: 'x' }, { tests_max_priority: '9' }])
    assert.ok(parseFiltros(q).error, JSON.stringify(q));
});

test('filtros de tests y aceleradores', () => {
  assert.deepEqual(parseFiltrosTests({ type: 'e2e,unit', max_priority: '2' }).tipos, ['e2e', 'unit']);
  assert.ok(parseFiltrosTests({ type: 'magia' }).error);
  const a = parseFiltrosAceleradores({ model: 'open_source,saas', platform: 'JavaScript,any' });
  assert.deepEqual([a.modelos, a.plataformas], [['open_source', 'saas'], ['javascript', 'any']]);
  assert.ok(parseFiltrosAceleradores({ model: 'gratis' }).error);
  assert.ok(parseFiltrosAceleradores({ platform: 'a b!' }).error);
});
