import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutaBusqueda, hayFiltro, paramsDe } from '../web/consulta.js';

test('sin filtros no hay nada que buscar', () => {
  assert.equal(hayFiltro({ q: '  ', cats: [] }), false);
  assert.equal(hayFiltro({ q: 'chat', cats: [] }), true);
  assert.equal(hayFiltro({ q: '', cats: ['messaging'] }), true);
});

test('la URL solo lleva lo que se ha elegido', () => {
  assert.equal(rutaBusqueda({ q: '', prio: 5, cats: [] }), '/api/v1/requirements');
  assert.equal(rutaBusqueda({ q: ' a b ', prio: 2, cats: ['messaging', 'security'], formato: 'md' }),
    '/api/v1/requirements?category=messaging%2Csecurity&max_priority=2&q=a+b&format=md');
});

test('el límite por defecto no se escribe', () => {
  assert.equal(paramsDe({ limite: 50 }).has('limit'), false);
  assert.equal(paramsDe({ limite: 10 }).get('limit'), '10');
});

import { urlSegura } from '../web/consulta.js';

test('incluir tests y aceleradores, y proyecto con ocultar lo hecho', () => {
  assert.equal(rutaBusqueda({ cats: ['messaging'], prio: 2, incluirTests: true, incluirAceleradores: true, proyecto: 7, ocultarHecho: true }),
    '/api/v1/requirements?category=messaging&max_priority=2&include=tests%2Caccelerators&tests_max_priority=2&project=7&hide=done');
  // sin proyecto no se manda hide; sin incluir tests no se manda tests_max_priority
  const p = paramsDe({ cats: ['a1'], prio: 2, ocultarHecho: true });
  assert.equal(p.has('hide'), false);
  assert.equal(p.has('tests_max_priority'), false);
});

test('solo se pintan enlaces https', () => {
  assert.equal(urlSegura('https://example.com/x'), 'https://example.com/x');
  for (const u of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', '', null, 'https://a b'])
    assert.equal(urlSegura(u), null);
});

import { categoriasEfectivas, visibles, dominiosDisponibles } from '../web/consulta.js';

const cs = [
  { slug: 'accounting', name: 'Accounting', domain: 'finance', audiences: ['b2b'] },
  { slug: 'payroll', name: 'Payroll', domain: 'finance', audiences: ['b2b', 'b2c'] },
  { slug: 'emr', name: 'EMR', domain: 'health', audiences: ['b2b'] },
  { slug: 'fitness', name: 'Fitness', domain: 'health', audiences: ['b2c'] },
];

test('audiencia y dominio solo se buscan si no hay categorías elegidas', () => {
  assert.deepEqual(categoriasEfectivas({ cats: ['emr'], audiencias: ['b2b'], dominios: ['health'] }), ['emr']);
  assert.deepEqual(categoriasEfectivas({ audiencias: ['b2b'], dominios: ['health'] }), ['b2b', 'health']);
  assert.equal(hayFiltro({ audiencias: ['b2b'] }), true);
  assert.equal(hayFiltro({}), false);
});

test('la lista se acota por audiencia (O), dominio y texto (Y)', () => {
  assert.deepEqual(visibles(cs, { audiencias: ['b2c'] }).map((c) => c.slug), ['payroll', 'fitness']);
  assert.deepEqual(visibles(cs, { audiencias: ['b2b'], dominios: ['health'] }).map((c) => c.slug), ['emr']);
  assert.deepEqual(visibles(cs, { texto: ' PAY ' }).map((c) => c.slug), ['payroll']);
  assert.equal(visibles(cs, {}).length, 4);
});

test('dominios con algo para la audiencia elegida', () => {
  assert.equal(dominiosDisponibles(cs, []), null);
  assert.deepEqual([...dominiosDisponibles(cs, ['b2c'])].sort(), ['finance', 'health']);
  assert.deepEqual([...dominiosDisponibles(cs.slice(0, 3), ['b2c'])], ['finance']);
});
