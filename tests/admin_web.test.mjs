import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import en from '../web/textos-admin-en.js';
import es from '../web/textos-admin-es.js';
import { maxRedondo, barras, apiladas, ticksX, resumenGrafica, formatoBytes, diaCorto, total } from '../web/admin_graficas.js';

const leer = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('textos de admin: mismas claves y variables en inglés y español, sin vacíos', () => {
  assert.deepEqual(Object.keys(en).filter((k) => !(k in es)), []);
  assert.deepEqual(Object.keys(es).filter((k) => !(k in en)), []);
  for (const k of Object.keys(en)) {
    assert.equal(vars(es[k]), vars(en[k]), `variables distintas en «${k}»`);
    assert.ok(en[k].trim() && es[k].trim(), `texto vacío en «${k}»`);
  }
  const iguales = Object.keys(en).filter((k) => en[k] === es[k] && /[a-z]{4,}/i.test(en[k]));
  assert.ok(iguales.length <= 8, `parecen sin traducir: ${iguales.join(', ')}`);
});

test('toda clave T(...) de admin.js existe, y las dinámicas también', () => {
  const js = leer('admin.js');
  const claves = new Set([...js.matchAll(/\bT\('([^']+)'/g)].map((m) => m[1]));
  for (const k of claves) assert.ok(k in en, `la clave «${k}» no está en textos-admin-en.js`);
  assert.ok(claves.size > 60);
  const dinamicas = {
    'ap.': ['created', 'merged', 'rejected', 'needs_human', 'pending'], 'act.': ['created', 'merged', 'rejected', 'needs_human'],
    'sug.': ['new', 'accepted', 'dismissed'], 's.set.': ['new', 'accepted', 'dismissed'], 'kind.': ['new_item', 'improvement', 'report'],
    'target.': ['requirement', 'test', 'accelerator', 'general'], 'level.': ['high', 'medium', 'low'],
    'why.': ['long_statement', 'many_criteria', 'many_verbs', 'many_categories', 'many_tests'],
    'd.status.': ['pending', 'accepted', 'dismissed'], 'h.status.': ['published', 'archived'], 'c.admin.': ['approved', 'rejected'],
    'aud.': ['contribution_approved', 'contribution_rejected', 'suggestion_status', 'split_proposed', 'split_accepted', 'split_dismissed'],
    'nav.': ['overview', 'contributions', 'suggestions', 'split', 'panels', 'history', 'audit'],
    'm.': ['read', 'search', 'list', 'copy', 'export', 'api_total', 'error_5xx', 'rate_limited', 'suggestions', 'keys_created', 'projects_created', 'requirements_created'],
  };
  for (const [pre, lista] of Object.entries(dinamicas)) for (const v of lista) assert.ok(`${pre}${v}` in en, `falta ${pre}${v}`);
});

test('admin.js: nada de innerHTML ni de scripts en línea; admin.html sin on*= ni <script> en línea', () => {
  assert.doesNotMatch(leer('admin.js'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  const html = leer('admin.html');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.match(html, /noindex/);
  assert.doesNotMatch(leer('index.html'), /admin\.html/, 'la home no debe enlazar al cuadro de control');
});

test('maxRedondo: 1-2-5-10…', () => {
  assert.equal(maxRedondo(0), 1); assert.equal(maxRedondo(1), 1); assert.equal(maxRedondo(3), 5); assert.equal(maxRedondo(7), 10);
  assert.equal(maxRedondo(12), 20); assert.equal(maxRedondo(430), 500); assert.equal(maxRedondo(0.4), 0.5);
});

test('barras: geometría dentro del viewBox y proporcional', () => {
  const g = barras([0, 5, 10], { ancho: 300, alto: 80, arriba: 12, abajo: 14, hueco: 1 });
  assert.equal(g.max, 10); assert.equal(g.barras.length, 3);
  assert.equal(g.barras[0].h, 0);
  assert.equal(g.barras[2].h, 54); assert.equal(g.barras[1].h, 27);
  for (const b of g.barras) { assert.ok(b.x >= 0 && b.x + b.w <= 300 + 0.01); assert.ok(b.y >= 0 && b.y + b.h <= 80 - 14 + 0.01); }
  assert.equal(barras([0, 0]).max, 1);
  assert.ok(barras([1, 100]).barras[0].h >= 1, 'un valor pequeño sigue viéndose');
  assert.deepEqual(barras([]).barras, []);
});

test('apiladas: los trozos suman el total y se apilan sin solaparse', () => {
  const filas = [{ created: 2, rejected: 1 }, {}, { needs_human: 3 }];
  const g = apiladas(filas, ['created', 'merged', 'rejected', 'needs_human', 'pending']);
  assert.equal(g.max, 5);
  assert.deepEqual(g.barras.map((b) => b.v), [3, 0, 3]);
  assert.deepEqual(g.barras[0].trozos.map((t) => t.k), ['created', 'rejected']);
  const [a, b] = g.barras[0].trozos;
  assert.ok(b.y + b.h <= a.y + 0.01, 'el segundo trozo está encima del primero');
  assert.deepEqual(g.barras[1].trozos, []);
});

test('ticksX, resumenGrafica, formatoBytes, diaCorto', () => {
  const dias = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const t = ticksX(dias, 4);
  assert.equal(t[0].i, 0); assert.equal(t.at(-1).i, 29); assert.ok(t.length <= 4);
  assert.deepEqual(ticksX(['2026-01-01'], 4), [{ i: 0, dia: '2026-01-01' }]); assert.deepEqual(ticksX([], 4), []);
  assert.deepEqual(resumenGrafica(['a', 'b', 'c'], [1, 5, 2]), { total: 8, max: 5, diaMax: 'b' });
  assert.deepEqual(resumenGrafica(['a'], [0]), { total: 0, max: 0, diaMax: null });
  assert.equal(formatoBytes(500), '500 B'); assert.equal(formatoBytes(2048), '2.0 KB'); assert.equal(formatoBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatoBytes(undefined), '0 B');
  assert.equal(diaCorto('2026-11-03'), '03/11'); assert.equal(total([1, 2, 3]), 6);
});
