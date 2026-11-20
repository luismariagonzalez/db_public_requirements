import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutaBusqueda, hayFiltro, paramsDe, chipsActivos, quitarFiltro, limpiarFiltros, contarFiltros, flujosPorFamilia, CLASES } from '../web/consulta.js';

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

test('las clases de requisito (funcional, técnico…) viajan como kind=', () => {
  assert.equal(paramsDe({ cats: ['messaging'], kinds: ['functional', 'technical'] }).get('kind'), 'functional,technical');
  assert.equal(paramsDe({ cats: ['messaging'] }).has('kind'), false);
});

test('la clase del cliente es la misma que la del servidor (functional | technical)', () => {
  assert.deepEqual(CLASES, ['functional', 'technical']);
});

test('sort viaja solo si se ha elegido', () => {
  assert.equal(paramsDe({ cats: ['messaging'], orden: 'copies' }).get('sort'), 'copies');
  assert.equal(paramsDe({ cats: ['messaging'] }).has('sort'), false);
});

const cats = [
  { slug: 'messaging', name: 'Messaging app', type: 'app_type' },
  { slug: 'b2b', name: 'B2B', type: 'audience' },
  { slug: 'flow-sign-in', name: 'Sign-in', type: 'screen_type', family: 'account' },
  { slug: 'flow-sign-up', name: 'Sign-up', type: 'screen_type', family: 'account' },
  { slug: 'screen-checkout', name: 'Checkout', type: 'screen_type', family: 'buy' },
  { slug: 'screen-rara', name: 'Rara', type: 'screen_type', family: 'otra' },
];
const nuevo = () => ({ q: ' chat ', prio: 2, cats: ['messaging', 'flow-sign-in'], audiencias: ['b2b'], dominios: [], kinds: ['technical'],
  orden: 'copies', incluirTests: true, proyecto: 7, filtroCat: 'x' });

test('chips activos: uno por filtro, con el nombre de la categoría y sin los extras', () => {
  const t = chipsActivos(nuevo(), cats).map((c) => `${c.tipo}:${c.texto}`);
  assert.deepEqual(t, ['audiencia:B2B', 'cat:Messaging app', 'cat:Sign-in', 'clase:technical', 'prio:P1–P2', 'q:“chat”', 'orden:copies']);
  assert.equal(contarFiltros(nuevo(), cats), 7);
  assert.deepEqual(chipsActivos({ q: '', prio: 5, cats: [], audiencias: [], dominios: [], kinds: [] }, cats), []);
});

test('quitar un chip quita solo eso', () => {
  const e = nuevo();
  quitarFiltro(e, { tipo: 'cat', valor: 'messaging' });
  assert.deepEqual(e.cats, ['flow-sign-in']);
  quitarFiltro(e, { tipo: 'prio' }); quitarFiltro(e, { tipo: 'q' }); quitarFiltro(e, { tipo: 'orden' }); quitarFiltro(e, { tipo: 'clase', valor: 'technical' });
  assert.deepEqual([e.prio, e.q, e.orden, e.kinds, e.audiencias], [5, '', null, [], ['b2b']]);
});

test('«Borrar filtros» vacía los filtros y conserva tests/aceleradores y el proyecto', () => {
  const e = limpiarFiltros(nuevo());
  assert.deepEqual([e.q, e.prio, e.cats, e.audiencias, e.dominios, e.kinds, e.orden, e.filtroCat], ['', 5, [], [], [], [], null, '']);
  assert.deepEqual([e.incluirTests, e.proyecto], [true, 7]);
  assert.equal(hayFiltro(e), false);
});

test('los flujos se agrupan por familia, en orden, y una familia desconocida va al final', () => {
  const g = flujosPorFamilia(cats);
  assert.deepEqual(g.map(([f, l]) => [f, l.map((c) => c.slug)]),
    [['account', ['flow-sign-in', 'flow-sign-up']], ['buy', ['screen-checkout']], ['otra', ['screen-rara']]]);
});
