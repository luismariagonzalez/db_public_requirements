import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaises, esVerdadero, expandirPaises, aplica, anotarJurisdicciones } from '../lib/paises.mjs';
import { parseFiltros } from '../lib/filtros.mjs';
import { renderMarkdown } from '../lib/markdown.mjs';
import { paramsDe, hayFiltro, chipsActivos, quitarFiltro, limpiarFiltros } from '../web/consulta.js';

const JUR = [
  { code: 'EU', type: 'supranational', name: 'European Union', parent: null },
  { code: 'ES', type: 'country', name: 'Spain', parent: 'EU' },
  { code: 'ES-CT', type: 'region', name: 'Catalonia', parent: 'ES' },
  { code: 'US', type: 'country', name: 'United States', parent: null },
];

test('parsePaises: mayúsculas, lista separada por comas, sin repetidos y valida el formato', () => {
  assert.deepEqual(parsePaises('es, pt,ES').paises, ['ES', 'PT']);
  assert.deepEqual(parsePaises(['es-ct', 'eu']).paises, ['ES-CT', 'EU']);
  assert.deepEqual(parsePaises(undefined).paises, []);
  assert.ok(parsePaises('spain').error);
  assert.ok(parsePaises('ES;DROP').error);
  assert.ok(parsePaises('AA,BB,CC,DD,EE,FF,GG,HH,II').error);
});

test('country_only solo vale con 1, true o yes', () => {
  assert.ok(esVerdadero('1') && esVerdadero('true') && esVerdadero('YES'));
  assert.ok(!esVerdadero('0') && !esVerdadero(undefined) && !esVerdadero('no'));
});

test('parseFiltros: sin country todo igual que antes; con country lo recoge', () => {
  const sin = parseFiltros({});
  assert.deepEqual(sin.paises, []);
  assert.equal(sin.soloPais, false);
  const con = parseFiltros({ country: 'es', country_only: '1' });
  assert.deepEqual(con.paises, ['ES']);
  assert.equal(con.soloPais, true);
  assert.ok(parseFiltros({ country: 'xx!' }).error);
});

test('expandirPaises: una región incluye su país y la UE; un país fuera de la UE no', () => {
  assert.deepEqual(expandirPaises(['ES'], JUR).codigos.sort(), ['ES', 'EU']);
  assert.deepEqual(expandirPaises(['ES-CT'], JUR).codigos.sort(), ['ES', 'ES-CT', 'EU']);
  assert.deepEqual(expandirPaises(['US'], JUR).codigos, ['US']);
  assert.deepEqual(expandirPaises(['ES', 'ES-CT'], JUR).codigos.sort(), ['ES', 'ES-CT', 'EU']);
  assert.deepEqual(expandirPaises(['ZZ'], JUR).desconocidos, ['ZZ']);
});

test('aplica: los genéricos aplican salvo country_only; los específicos solo si hay coincidencia', () => {
  assert.equal(aplica({ all: [], matches: [] }), true);
  assert.equal(aplica({ all: [], matches: [] }, { soloPais: true }), false);
  assert.equal(aplica({ all: ['ES'], matches: [{ code: 'ES' }] }), true);
  assert.equal(aplica({ all: ['ES'], matches: [] }), false);
  assert.equal(aplica(undefined), true);
});

const items = [
  { slug: 'generico', title: 'Generic one', statement: 'S.', criteria: [], priority: 2, categories: [{ slug: 'x', priority: 2 }] },
  { slug: 'solo-es', title: 'Spain only', statement: 'S.', criteria: [], priority: 1, categories: [{ slug: 'x', priority: 1 }] },
  { slug: 'es-y-ue', title: 'Spain and EU', statement: 'S.', criteria: [], priority: 1, categories: [{ slug: 'x', priority: 1 }] },
];
const mapa = {
  generico: { all: [], matches: [] },
  'solo-es': { all: ['ES'], matches: [{ code: 'ES', name: 'Spain', note: 'Spanish threshold is EUR 600.', source: { norm: 'RD 1614/2011 art. 36', url: 'https://www.boe.es/x', date: '2026-06-25' }, status: 'in_force' }] },
  'es-y-ue': { all: ['EU', 'ES'], matches: [
    { code: 'EU', name: 'European Union', note: 'EU rule.', source: { norm: 'GDPR', url: 'https://eur-lex.europa.eu/x', date: '2016-04-27' }, status: 'in_force' },
    { code: 'ES', name: 'Spain', note: 'Spanish detail.', source: { norm: 'LOPDGDD', url: 'https://www.boe.es/y', date: '2018-12-06' }, status: 'in_force' }] },
};

test('anotarJurisdicciones con país: deja los que aplican, una sola vez, con el matiz de ese país', () => {
  const r = anotarJurisdicciones(items, mapa, { pedidos: ['ES'] });
  assert.deepEqual(r.items.map((i) => i.slug), ['generico', 'solo-es', 'es-y-ue']);
  assert.equal(r.items.find((i) => i.slug === 'solo-es').jurisdictions[0].note, 'Spanish threshold is EUR 600.');
  assert.equal(r.items[0].jurisdictions, undefined, 'el genérico no cambia de forma');
});

test('anotarJurisdicciones con otro país: excluye lo específico de España y mantiene el genérico', () => {
  const m2 = { ...mapa, 'solo-es': { all: ['ES'], matches: [] }, 'es-y-ue': { all: ['EU', 'ES'], matches: [] } };
  const r = anotarJurisdicciones(items, m2, { pedidos: ['US'] });
  assert.deepEqual(r.items.map((i) => i.slug), ['generico']);
  assert.deepEqual(r.excluidos, ['solo-es', 'es-y-ue']);
  assert.deepEqual(anotarJurisdicciones(items, m2, { pedidos: ['US'], soloPais: true }).items, []);
});

test('anotarJurisdicciones sin país: solo códigos y nombres, nunca matices', () => {
  const r = anotarJurisdicciones(items, { ...mapa, 'solo-es': { all: ['ES'], matches: [] } }, { nombres: { ES: 'Spain' } });
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.find((i) => i.slug === 'solo-es').jurisdictions, [{ code: 'ES', name: 'Spain' }]);
  assert.ok(!JSON.stringify(r.items).includes('threshold'));
});

test('Markdown con país: el matiz de ese país y su fuente, el aviso legal y sin duplicar requisitos', () => {
  const { items: anotados } = anotarJurisdicciones(items, mapa, { pedidos: ['ES'] });
  const md = renderMarkdown(anotados, { categorias: ['x'], nombres: { x: 'X' }, paises: ['ES'], paisesNombres: { ES: 'Spain' } });
  assert.match(md, /Jurisdiction: ES \(Spain\)/);
  assert.match(md, /not legal advice/);
  assert.match(md, /\*\*ES \(Spain\):\*\* Spanish threshold is EUR 600\. _Source: RD 1614\/2011 art\. 36; https:\/\/www\.boe\.es\/x; text as of 2026-06-25\._/);
  assert.equal((md.match(/Spain only/g) ?? []).length, 1);
  assert.equal((md.match(/Spain and EU/g) ?? []).length, 1);
  assert.ok(md.indexOf('Spanish detail') > md.indexOf('EU rule'));
});

test('Markdown pidiendo otro país no lleva el matiz de España', () => {
  const m2 = { ...mapa, 'solo-es': { all: ['ES'], matches: [] }, 'es-y-ue': { all: ['EU', 'ES'], matches: [mapa['es-y-ue'].matches[0]] } };
  const { items: anotados } = anotarJurisdicciones(items, m2, { pedidos: ['DE'] });
  const md = renderMarkdown(anotados, { categorias: ['x'], paises: ['DE'] });
  assert.doesNotMatch(md, /Spanish/);
  assert.match(md, /EU rule/);
  assert.doesNotMatch(md, /Spain only/);
});

test('Markdown sin país: sin matices y con la pista de dónde aplica; un genérico no cambia', () => {
  const { items: anotados } = anotarJurisdicciones(items, mapa, { nombres: { ES: 'Spain', EU: 'EU' } });
  const sinPais = anotados.map((i) => (i.jurisdictions ? { ...i, jurisdictions: i.jurisdictions.map((j) => ({ code: j.code, name: j.name })) } : i));
  const md = renderMarkdown(sinPais, { categorias: ['x'] });
  assert.doesNotMatch(md, /Spanish/);
  assert.match(md, /_Jurisdictions: ES\. Ask for a country/);
  assert.equal(renderMarkdown([items[0]], { categorias: ['x'] }).includes('Jurisdiction'), false);
});

test('consulta.js: country en la URL, chips y limpiar', () => {
  assert.equal(paramsDe({ paises: ['ES'], soloPais: true }).toString(), 'country=ES&country_only=1');
  assert.equal(paramsDe({ paises: [], soloPais: true }).has('country_only'), false);
  assert.equal(hayFiltro({ paises: ['ES'] }), true);
  const e = { paises: ['ES'], soloPais: true, cats: [], audiencias: [], dominios: [], kinds: [], prio: 5, q: '' };
  const chip = chipsActivos(e).find((c) => c.tipo === 'pais');
  assert.equal(chip.texto, 'ES');
  quitarFiltro(e, chip);
  assert.deepEqual(e.paises, []);
  assert.equal(e.soloPais, false);
  e.paises = ['ES']; limpiarFiltros(e);
  assert.deepEqual(e.paises, []);
});
