import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarHerramienta, validarLista } from '../lib/herramientas_semilla.mjs';

const ejemplo = JSON.parse(readFileSync(new URL('../semilla/herramientas.ejemplo.json', import.meta.url), 'utf8'));

test('el fichero de ejemplo es válido y cubre código solo, docs solo y ambos', () => {
  assert.deepEqual(validarLista(ejemplo), []);
  assert.ok(ejemplo.some((h) => h.url_codigo && !h.url_docs));
  assert.ok(ejemplo.some((h) => !h.url_codigo && h.url_docs));
  assert.ok(ejemplo.some((h) => h.url_codigo && h.url_docs));
});

test('reglas: slug, categoría, https, al menos una URL y descripción corta', () => {
  const ok = { slug: 'x-tool', nombre: 'X', categoria: 'other', url_docs: 'https://x.dev' };
  assert.deepEqual(validarHerramienta(ok), []);
  assert.ok(validarHerramienta({ ...ok, slug: 'X Tool' }).length);
  assert.ok(validarHerramienta({ ...ok, categoria: 'misc' }).length);
  assert.ok(validarHerramienta({ ...ok, url_docs: 'http://x.dev' }).length);
  assert.ok(validarHerramienta({ ...ok, url_docs: null }).some((p) => /url_codigo o url_docs/.test(p)));
  assert.ok(validarHerramienta({ ...ok, descripcion: 'a'.repeat(301) }).length);
});

test('slugs repetidos se detectan', () => {
  const h = { slug: 'x-tool', nombre: 'X', categoria: 'other', url_docs: 'https://x.dev' };
  assert.ok(validarLista([h, h]).some((f) => f.problemas.includes('slug repetido')));
});
