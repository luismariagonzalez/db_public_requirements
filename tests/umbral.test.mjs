import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirPorSimilitud, validarItem, conflictoPrioridad, categoriasNuevas, estadoFinal } from '../lib/umbral.mjs';

const slugs = new Set(['messaging', 'security']);

test('decidirPorSimilitud respeta los umbrales', () => {
  assert.equal(decidirPorSimilitud(0.95), 'duplicate');
  assert.equal(decidirPorSimilitud(0.93), 'duplicate');
  assert.equal(decidirPorSimilitud(0.85), 'ask');
  assert.equal(decidirPorSimilitud(0.80), 'ask');
  assert.equal(decidirPorSimilitud(0.79), 'new');
});

test('validarItem limpia y descarta categorías desconocidas', () => {
  const r = validarItem({
    title: '  Password   reset ', statement: 'Users can reset a forgotten password by email.',
    criteria: ['The link expires', 'x', 'Single use link'], kind: 'security',
    categories: [{ slug: 'security', priority: 1 }, { slug: 'nope', priority: 2 }, { slug: 'security', priority: 4 },
                 { slug: 'messaging', priority: 'abc' }],
  }, slugs);
  assert.ok(r.ok);
  assert.equal(r.item.title, 'Password reset');
  assert.deepEqual(r.item.criteria, ['The link expires', 'Single use link']);   // 'x' es demasiado corto
  assert.deepEqual(r.item.categories, [{ slug: 'security', priority: 1 }, { slug: 'messaging', priority: 3 }]);
});

test('validarItem rechaza lo mal formado', () => {
  const cat = [{ slug: 'security', priority: 1 }];
  assert.equal(validarItem({ title: 'abc', statement: 'Users can do a thing here.', categories: cat }, slugs).ok, false);
  assert.equal(validarItem({ title: 'Valid title', statement: 'short', categories: cat }, slugs).ok, false);
  assert.equal(validarItem({ title: 'Valid title', statement: 'A perfectly fine statement.',
    categories: [{ slug: 'nope', priority: 1 }] }, slugs).ok, false);
});

test('clase desconocida cae a functional y la prioridad fuera de rango a 3', () => {
  const r = validarItem({ title: 'Valid title', statement: 'A perfectly fine statement.', kind: 'weird',
    categories: [{ slug: 'security', priority: 9 }] }, slugs);
  assert.equal(r.item.kind, 'functional');
  assert.equal(r.item.categories[0].priority, 3);
});

test('conflictoPrioridad solo salta si se discute un P1', () => {
  const ex = [{ slug: 'messaging', priority: 1 }, { slug: 'security', priority: 3 }];
  assert.equal(conflictoPrioridad(ex, [{ slug: 'messaging', priority: 3 }]), true);
  assert.equal(conflictoPrioridad(ex, [{ slug: 'messaging', priority: 1 }]), false);
  assert.equal(conflictoPrioridad(ex, [{ slug: 'security', priority: 5 }]), false);
});

test('categoriasNuevas', () => {
  assert.deepEqual(
    categoriasNuevas([{ slug: 'a', priority: 1 }], [{ slug: 'a', priority: 2 }, { slug: 'b', priority: 2 }]),
    [{ slug: 'b', priority: 2 }]);
});

test('estadoFinal: humano > creado > fusionado > rechazado', () => {
  assert.equal(estadoFinal(['rejected', 'merged']), 'merged');
  assert.equal(estadoFinal(['merged', 'created']), 'created');
  assert.equal(estadoFinal(['created', 'needs_human']), 'needs_human');
  assert.equal(estadoFinal([]), 'rejected');
});
