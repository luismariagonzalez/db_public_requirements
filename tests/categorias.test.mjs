import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandir, expandirCombinado, conAlias, NINGUNA } from '../lib/categorias.mjs';

const cats = [
  { slug: 'b2b', type: 'audience' }, { slug: 'b2c', type: 'audience' },
  { slug: 'finance', type: 'domain' }, { slug: 'health', type: 'domain' },
  { slug: 'accounting', type: 'software_category', domain: 'finance', audiences: ['b2b'] },
  { slug: 'payroll', type: 'software_category', domain: 'finance', audiences: ['b2b', 'b2c'] },
  { slug: 'emr', type: 'software_category', domain: 'health', audiences: ['b2b'] },
  { slug: 'fitness', type: 'app_type', domain: 'health', audiences: ['b2c'] },
  { slug: 'security', type: 'cross_cutting', audiences: [] },
];
const orden = (r) => [...r.slugs].sort();

test('una audiencia se expande a las categorías que la sirven', () => {
  assert.deepEqual(orden(expandir(['b2b'], cats)), ['accounting', 'emr', 'payroll']);
  assert.deepEqual(orden(expandir(['b2c'], cats)), ['fitness', 'payroll']);
});

test('un dominio se expande a sus categorías', () => {
  assert.deepEqual(orden(expandir(['finance'], cats)), ['accounting', 'payroll']);
});

test('una categoría hoja se queda como está y se mezcla con las demás', () => {
  assert.deepEqual(orden(expandir(['security', 'finance'], cats)), ['accounting', 'payroll', 'security']);
});

test('varias audiencias son un O; audiencia + dominio es un Y', () => {
  assert.deepEqual(orden(expandirCombinado(['b2b', 'b2c'], cats)), ['accounting', 'emr', 'fitness', 'payroll']);
  assert.deepEqual(orden(expandirCombinado(['b2b', 'finance'], cats)), ['accounting', 'payroll']);
  assert.deepEqual(orden(expandirCombinado(['b2c', 'health'], cats)), ['fitness']);
  // el Y se suma a las hojas pedidas aparte
  assert.deepEqual(orden(expandirCombinado(['b2b', 'finance', 'security'], cats)), ['accounting', 'payroll', 'security']);
});

test('un conjunto vacío nunca significa «sin filtro»', () => {
  assert.deepEqual(expandirCombinado(['b2c', 'finance'], cats.filter((c) => c.slug !== 'payroll')).slugs, [NINGUNA]);
  assert.deepEqual(expand0(), [NINGUNA]);
});
function expand0() { return expandir(['health'], cats.filter((c) => !['emr', 'fitness'].includes(c.slug))).slugs; }

test('slugs desconocidos se devuelven para poder dar un 400', () => {
  const r = expandir(['b2b', 'nope'], cats);
  assert.deepEqual(r.desconocidas, ['nope']);
  assert.deepEqual(orden(r), ['accounting', 'emr', 'payroll']);
});

const conHerencia = [
  ...cats,
  { slug: 'crm-sales', type: 'app_type', audiences: ['b2b'] },
  { slug: 'helpdesk-support', type: 'app_type', audiences: ['b2b'] },
  { slug: 'crm-tools', type: 'software_category', domain: 'finance', audiences: ['b2b'], archetypes: ['crm-sales', 'helpdesk-support'] },
];

test('una categoría de software hereda de sus arquetipos, pedida sola o por dominio o audiencia', () => {
  assert.deepEqual(orden(expandir(['crm-tools'], conHerencia)), ['crm-sales', 'crm-tools', 'helpdesk-support']);
  assert.deepEqual(orden(expandir(['finance'], conHerencia)), ['accounting', 'crm-sales', 'crm-tools', 'helpdesk-support', 'payroll']);
  assert.ok(expandir(['b2b'], conHerencia).slugs.includes('crm-sales'));
});

test('screen-auth sigue valiendo: se expande a los tres flujos de acceso', () => {
  assert.deepEqual(conAlias(['screen-auth', 'security']), ['flow-sign-up', 'flow-sign-in', 'flow-recovery', 'security']);
  const flujos = ['flow-sign-up', 'flow-sign-in', 'flow-recovery'].map((slug) => ({ slug, type: 'screen_type' }));
  const r = expandir(['screen-auth'], [...cats, ...flujos]);
  assert.deepEqual(orden(r), ['flow-recovery', 'flow-sign-in', 'flow-sign-up']);
  assert.deepEqual(r.desconocidas, []);
});
