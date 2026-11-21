import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoParaEmbedding, indexarCategorias, VERSION_TEXTO } from '../lib/texto_embedding.mjs';

const CATS = [
  { slug: 'b2b', type: 'audience', name: 'B2B' },
  { slug: 'b2c', type: 'audience', name: 'B2C' },
  { slug: 'finance-accounting', type: 'domain', name: 'Finance & Accounting' },
  { slug: 'messaging', type: 'app_type', name: 'Messaging app', domain: null, audiences: ['b2c'] },
  { slug: 'helpdesk', type: 'app_type', name: 'Helpdesk', audiences: ['b2b'] },
  { slug: 'accounting-software', type: 'software_category', name: 'Accounting software', domain: 'finance-accounting', audiences: ['b2b'] },
  { slug: 'security', type: 'cross_cutting', name: 'Security' },
  { slug: 'privacy', type: 'cross_cutting', name: 'Privacy' },
  { slug: 'flow-sign-in', type: 'screen_type', name: 'Sign-in', family: 'account' },
];
const REQ = {
  title: 'Password reset by email link',
  statement: 'Users who forgot their password can reset it through a single-use link sent by email.',
  criteria: ['The link expires', 'The link works only once'],
  kind: 'technical',
  categories: [{ slug: 'security', priority: 2 }, { slug: 'messaging', priority: 1 }, { slug: 'flow-sign-in', priority: 2 },
    { slug: 'accounting-software', priority: 3 }, { slug: 'privacy', priority: 4 }],
};

test('lleva título, enunciado, criterios, clase y TODAS las categorías con su nombre legible', () => {
  const t = textoParaEmbedding(REQ, CATS);
  assert.match(t, /^Password reset by email link\. Users who forgot/);
  assert.match(t, /Acceptance criteria: The link expires; The link works only once/);
  assert.match(t, /Kind: technical/);
  assert.match(t, /App types: Messaging app$/m);
  assert.match(t, /Software categories: Accounting software$/m);
  assert.match(t, /Cross-cutting concerns: Privacy, Security$/m);
  assert.match(t, /Flows: Sign-in$/m);
  for (const c of REQ.categories) assert.ok(t.includes(CATS.find((x) => x.slug === c.slug).name), `falta ${c.slug}`);
  assert.ok(!t.includes('security,'), 'el slug no debe salir, sino el nombre');
});

test('deduce dominios y audiencias de las hojas (sin duplicados)', () => {
  const t = textoParaEmbedding(REQ, CATS);
  assert.match(t, /Domains: Finance & Accounting$/m);
  assert.match(t, /Audiences: B2B, B2C$/m);      // b2c de messaging, b2b de la categoría de software
});

test('es determinista y no depende del orden de las categorías ni de su prioridad', () => {
  const barajado = { ...REQ, categories: [...REQ.categories].reverse().map((c) => ({ ...c, priority: 5 })) };
  assert.equal(textoParaEmbedding(barajado, CATS), textoParaEmbedding(REQ, CATS));
});

test('admite las categorías de la semilla (claves en español), un objeto slug→nombre y slugs sueltos', () => {
  const semilla = [{ slug: 'messaging', tipo: 'app_type', nombre: 'Messaging app', audiencias: ['b2c'] },
    { slug: 'b2c', tipo: 'audience', nombre: 'B2C' }];
  const t = textoParaEmbedding({ ...REQ, categories: ['messaging'] }, semilla);
  assert.match(t, /App types: Messaging app/); assert.match(t, /Audiences: B2C/);
  const mapa = textoParaEmbedding({ ...REQ, categories: [{ slug: 'security' }] }, { security: 'Security' });
  assert.match(mapa, /Other tags: Security/);
  // un slug desconocido sale legible, no revienta
  assert.match(textoParaEmbedding({ ...REQ, categories: [{ slug: 'cosa-rara' }] }, []), /Other tags: cosa rara/);
});

test('un Map ya indexado se reutiliza tal cual', () => {
  const idx = indexarCategorias(CATS);
  assert.equal(indexarCategorias(idx), idx);
  assert.equal(textoParaEmbedding(REQ, idx), textoParaEmbedding(REQ, CATS));
});

test('sin criterios ni categorías el texto sigue siendo válido, y se acota la longitud', () => {
  const t = textoParaEmbedding({ title: 'A title', statement: 'A statement that is long enough.', criteria: [], kind: 'functional', categories: [] }, CATS);
  assert.equal(t, 'A title. A statement that is long enough.\nKind: functional');
  const largo = textoParaEmbedding({ ...REQ, statement: 'x'.repeat(5000) }, CATS);
  assert.ok(largo.length <= 3000);
  assert.equal(VERSION_TEXTO, 2);
});

test('añadir una categoría cambia el texto (por eso hay que recalcular el vector al fusionar)', () => {
  const mas = { ...REQ, categories: [...REQ.categories, { slug: 'helpdesk', priority: 2 }] };
  assert.notEqual(textoParaEmbedding(mas, CATS), textoParaEmbedding(REQ, CATS));
  assert.match(textoParaEmbedding(mas, CATS), /App types: Helpdesk, Messaging app/);
});
