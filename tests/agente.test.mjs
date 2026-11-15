import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajeAgente } from '../lib/mensaje_agente.mjs';
import { renderMarkdown } from '../lib/markdown.mjs';
import { enriquecer, anotar, ocultarPorEstado } from '../lib/enriquecer.mjs';

test('el mensaje explica los estados y cómo marcar el proyecto', () => {
  const m = mensajeAgente({ base: 'https://r.example', proyecto: { id: 7, name: 'Mi app' } });
  assert.match(m, /PUT https:\/\/r\.example\/api\/v1\/projects\/7\/items/);
  for (const e of ['done', 'in_progress', 'planned', 'skipped']) assert.match(m, new RegExp('`' + e + '`'));
  assert.match(m, /project "Mi app" \(id 7\)/);
  assert.match(m, /before ending the session/i);
  assert.doesNotMatch(m, /<project_id>/);
});

test('sin proyecto, el mensaje enseña a crearlo', () => {
  const m = mensajeAgente({ base: 'https://r.example' });
  assert.match(m, /projects\/<project_id>\/items/);
  assert.match(m, /POST https:\/\/r\.example\/api\/v1\/projects/);
});

const items = [{
  slug: 'reset', title: 'Password reset', statement: 'Users can reset it.', criteria: ['Link expires'], priority: 1,
  categories: [{ slug: 'security', priority: 1 }], project_status: 'done',
  tests: [{ slug: 't1', title: 'Link is single use', scenario: 'Use it twice.', type: 'integration', priority: 1, project_status: 'planned' }],
  accelerators: [{ slug: 'lucia', name: 'Lucia', model: 'open_source', cost: 'free', url: 'https://x.example' }],
}];

test('el Markdown incluye estado de proyecto, tests, aceleradores y el mensaje', () => {
  const md = renderMarkdown(items, { nombres: { security: 'Security' }, proyecto: { id: 3, name: 'P' }, base: 'https://r.example' });
  assert.match(md, /- \[x\] \*\*\(P1\) Password reset\*\*: Users can reset it\.  `reset`/);
  assert.match(md, /- \[ \] \*\*Test \(P1 · integration\):\*\* Link is single use: Use it twice\. _\(project: planned\)_  `t1`/);
  assert.match(md, /## Accelerators/);
  assert.match(md, /\*\*Lucia\*\* \(open source · free\) https:\/\/x\.example/);
  assert.match(md, /helps with: Password reset/);
  assert.match(md, /projects\/3\/items/);
});

test('sinMensaje omite las instrucciones al agente', () => {
  assert.doesNotMatch(renderMarkdown(items, { sinMensaje: true }), /Instructions for the agent/);
});

test('anotar y ocultar por estado', () => {
  const estados = { 'requirement:a': 'done', 'requirement:b': 'planned' };
  const r = anotar([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }], 'requirement', estados);
  assert.deepEqual(r.map((x) => x.project_status), ['done', 'planned', undefined]);
  assert.deepEqual(ocultarPorEstado(r, ['done']).map((x) => x.slug), ['b', 'c']);
  assert.equal(ocultarPorEstado(r, []).length, 3);
});

test('enriquecer añade tests y aceleradores ocultando lo ya hecho', async () => {
  let pedido;
  const deps = { rpc: async (v, a) => { pedido = [v, a]; return { a: {
    tests: [{ slug: 't1', priority: 1 }, { slug: 't2', priority: 2 }],
    accelerators: [{ slug: 'x1' }] } }; } };
  const r = await enriquecer([{ slug: 'a' }, { slug: 'b' }],
    { estados: { 'requirement:b': 'done', 'test:t1': 'done' }, ocultar: ['done'], incluirTests: true, incluirAceleradores: true, testsMax: 2 }, deps);
  assert.deepEqual(r.map((x) => x.slug), ['a']);              // b está hecho: se oculta
  assert.deepEqual(r[0].tests.map((t) => t.slug), ['t2']);      // t1 hecho: se oculta
  assert.equal(r[0].accelerators.length, 1);
  assert.deepEqual(pedido[1], { p_slugs: ['a'], p_tests: true, p_tests_max: 2, p_aceleradores: true });
});

test('enriquecer sin include no llama a la base', async () => {
  const deps = { rpc: async () => { throw new Error('no debería llamarse'); } };
  assert.deepEqual(await enriquecer([{ slug: 'a' }], {}, deps), [{ slug: 'a' }]);
});
