import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../lib/markdown.mjs';

const items = [
  { title: 'Typing indicator', statement: 'Users can see typing.', criteria: [], priority: 4,
    categories: [{ slug: 'messaging', priority: 4 }] },
  { title: 'Password reset', statement: 'Users can reset it.', criteria: ['Link expires'], priority: 1,
    categories: [{ slug: 'security', priority: 1 }, { slug: 'messaging', priority: 2 }] },
];

test('la cabecera deja claro que el dónde lo decide el agente', () => {
  const md = renderMarkdown(items, { categorias: ['messaging'] });
  assert.match(md, /Decisions about screens, layout, placement and UI are yours/);
});

test('no repite un requisito que está en varias categorías', () => {
  const md = renderMarkdown(items, { nombres: { messaging: 'Messaging app', security: 'Security' } });
  assert.equal((md.match(/Password reset/g) ?? []).length, 1);
  assert.match(md, /- \[ \] \*\*\(P1\) Password reset\*\*: Users can reset it\.\n {2}- Link expires/);
});

test('con categorías pedidas, todo cae bajo ellas', () => {
  const md = renderMarkdown(items, { categorias: ['messaging'], nombres: { messaging: 'Messaging app' } });
  assert.match(md, /## Messaging app/);
  assert.doesNotMatch(md, /## security/i);
  // La prioridad que se pinta es la que trae el ítem: la API ya la calcula con las categorías pedidas.
  assert.match(md, /\(P1\) Password reset/);
});

test('dentro de una categoría, por prioridad', () => {
  const md = renderMarkdown(items, { categorias: ['messaging'], nombres: { messaging: 'M' } });
  assert.ok(md.indexOf('Password reset') < md.indexOf('Typing indicator'));
});
