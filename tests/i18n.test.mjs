import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import en from '../web/textos-en.js';
import es from '../web/textos-es.js';
import { t, tn, fijar, idiomaInicial } from '../web/i18n.js';

const leer = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('inglés y español tienen exactamente las mismas claves', () => {
  const soloEn = Object.keys(en).filter((k) => !(k in es)), soloEs = Object.keys(es).filter((k) => !(k in en));
  assert.deepEqual(soloEn, [], `faltan en español: ${soloEn.join(', ')}`);
  assert.deepEqual(soloEs, [], `sobran en español: ${soloEs.join(', ')}`);
});

test('cada clave usa las mismas {variables} en los dos idiomas y no hay textos vacíos', () => {
  for (const k of Object.keys(en)) {
    assert.equal(vars(es[k]), vars(en[k]), `variables distintas en «${k}»`);
    assert.ok(en[k].trim() && es[k].trim(), `texto vacío en «${k}»`);
  }
});

test('el español está de verdad traducido (casi ningún texto igual al inglés)', () => {
  const iguales = Object.keys(en).filter((k) => en[k] === es[k] && /[a-z]{4,}/i.test(en[k]));
  // Se permiten términos técnicos que no se traducen (Tests, API, CLI, Markdown…).
  assert.ok(iguales.length <= 12, `parecen sin traducir: ${iguales.join(', ')}`);
});

test('todas las claves del HTML y del JS existen en el diccionario', () => {
  const claves = new Set();
  for (const f of ['index.html', 'mapa.html']) {
    for (const m of leer(f).matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) claves.add(m[1]);
    for (const m of leer(f).matchAll(/data-i18n-attr="([^"]+)"/g)) for (const par of m[1].split(';')) claves.add(par.split(':')[1].trim());
  }
  for (const js of ['app.js', 'mapa.js']) {
    for (const m of leer(js).matchAll(/\bT\('([^']+)'/g)) claves.add(m[1]);
    for (const m of leer(js).matchAll(/\bTN\('([^']+)'/g)) { claves.add(`${m[1]}.one`); claves.add(`${m[1]}.other`); }
  }
  for (const k of claves) assert.ok(k in en, `la clave «${k}» no está en textos-en.js`);
  assert.ok(claves.size > 80, `solo ${claves.size} claves encontradas: ¿ha cambiado el formato?`);
});

test('las claves dinámicas (p1…p5, estados, grupos) existen', () => {
  for (let p = 1; p <= 5; p++) for (const s of ['n', 'd']) assert.ok(`p${p}.${s}` in en);
  for (const e of ['planned', 'in_progress', 'done', 'skipped']) for (const pre of ['est', 'estl']) assert.ok(`${pre}.${e}` in en);
  for (const g of ['audience', 'domain', 'software_category', 'app_type', 'screen_type', 'cross_cutting']) assert.ok(`g.${g}` in en);
  for (const s of ['created', 'merged', 'rejected', 'needs_human', 'pending']) assert.ok(`ap.${s}` in en);
  for (const s of ['new', 'accepted', 'dismissed']) assert.ok(`sug.estado.${s}` in en);
  for (const k of ['functional', 'technical']) assert.ok(`mapa.kind.${k}` in en);   // mapa.js: T(`mapa.kind.${…}`)
});

test('t(): variables, caída al inglés, clave desconocida visible y plurales', () => {
  fijar('es');
  assert.equal(t('sel.cuenta', { n: 3, total: 50 }), '3/50 seleccionados');
  assert.equal(tn('n.test', 1), '1 test'); assert.equal(tn('n.req', 1), '1 requisito'); assert.equal(tn('n.req', 5), '5 requisitos');
  assert.equal(t('clave.que.no.existe'), 'clave.que.no.existe');
  fijar('en');
  assert.equal(t('sel.cuenta', { n: 3, total: 50 }), '3/50 selected');
  assert.equal(tn('n.acel', 2), '2 accelerators');
});

test('idioma inicial: ?lang gana, luego lo guardado, luego el navegador', () => {
  const almacen = (v) => { const m = new Map(Object.entries(v)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, x) => m.set(k, x) }; };
  assert.equal(idiomaInicial({ search: '?lang=es' }, almacen({}), { language: 'en-US' }), 'es');
  assert.equal(idiomaInicial({ search: '' }, almacen({ rq_lang: 'es' }), { language: 'en-US' }), 'es');
  assert.equal(idiomaInicial({ search: '' }, almacen({}), { language: 'es-ES' }), 'es');
  assert.equal(idiomaInicial({ search: '' }, almacen({}), { language: 'fr-FR' }), 'en');
  assert.equal(idiomaInicial({ search: '?lang=xx' }, almacen({ rq_lang: 'es' }), { language: 'en' }), 'es');   // un valor raro se ignora
});
