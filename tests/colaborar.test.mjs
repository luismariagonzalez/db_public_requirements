import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import colEn from '../web/textos-colaborar-en.js';
import colEs from '../web/textos-colaborar-es.js';
import { filtrarHerramientas } from '../lib/prompt_colaborador.mjs';
import { CATEGORIAS_HERRAMIENTA } from '../lib/herramientas_semilla.mjs';

const LISTA = [
  { slug: 'clerk', name: 'Clerk', category: 'auth', description: 'Hosted authentication', docs_url: 'https://clerk.com/docs' },
  { slug: 'stripe', name: 'Stripe', category: 'payments', description: 'Payments platform', code_url: 'https://github.com/stripe/stripe-node' },
  { slug: 'roto', name: 'Sin URL', category: 'other', description: 'no usable' },
];

test('los textos de colaborar tienen las mismas claves en EN y ES, con las mismas {variables}', () => {
  assert.deepEqual(Object.keys(colEn).sort(), Object.keys(colEs).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(colEn)) { assert.equal(vars(colEs[k]), vars(colEn[k]), k); assert.ok(colEn[k].trim() && colEs[k].trim(), k); }
});

test('hay una etiqueta por cada categoría de herramienta de la base', () => {
  for (const c of CATEGORIAS_HERRAMIENTA) assert.ok(`col.cat.${c}` in colEn, c);
});

test('el botón de la cabecera, la caja y sus claves existen en el HTML', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const id of ['btnColaborar', 'colaborar', 'colLista', 'colBuscar', 'colCopiar', 'colPrompt', 'colEstado', 'colClaves'])
    assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /href="#colaborar"/);
  assert.match(html, /colaborar\.css/);
  assert.doesNotMatch(html, /sugObjetivo/);       // «Sugerir» ya no apunta a requisitos, tests ni aceleradores
});

test('filtrarHerramientas: por texto, sin texto y descartando las inservibles', () => {
  assert.deepEqual(filtrarHerramientas(LISTA).map((h) => h.slug), ['clerk', 'stripe']);
  assert.deepEqual(filtrarHerramientas(LISTA, 'PAY').map((h) => h.slug), ['stripe']);
  assert.deepEqual(filtrarHerramientas(LISTA, 'auth').map((h) => h.slug), ['clerk']);
  assert.deepEqual(filtrarHerramientas(LISTA, 'nada'), []);
  assert.deepEqual(filtrarHerramientas(null), []);
});
