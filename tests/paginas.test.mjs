import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const enlaces = (html) => [...html.matchAll(/<a[^>]+href="([^"]+)"/g)].map((m) => m[1]);

test('la portada solo lleva cabecera, hero, las cinco cajas y las cajas hacia cada página', () => {
  const h = leer('index.html');
  assert.match(h, /class="hero"/); assert.match(h, /class="entidades"/); assert.match(h, /class="paginas"/);
  for (const id of ['filtros', 'browse', 'lista', 'cuenta-zona', 'api', 'claves'])
    assert.ok(!h.includes(`id="${id}"`), `la portada ya no lleva #${id}`);
  const caja = [...h.matchAll(/class="pag(?: principal)?" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(caja, ['./buscador.html', './mapa.html', './api.html', './colaborar.html', './terms.html']);
});

test('las cajas de la portada coinciden con el menú', () => {
  const menu = (f) => [...leer(f).matchAll(/<nav[\s\S]*?<\/nav>/g)][0][0].match(/href="([^"]+)"/g).map((x) => x.slice(6, -1));
  for (const f of ['index.html', 'buscador.html', 'api.html', 'colaborar.html', 'mapa.html'])
    assert.deepEqual(menu(f), ['./buscador.html', './mapa.html', './api.html', './colaborar.html', './terms.html'], f);
});

test('el buscador tiene filtros y lista; la API junta referencia, claves y CLI', () => {
  const b = leer('buscador.html');
  for (const id of ['filtros', 'q', 'lista', 'proyectos', 'incTests', 'incAcel']) assert.ok(b.includes(`id="${id}"`), `buscador: #${id}`);
  assert.match(b, /data-pagina="buscador"/);
  const a = leer('api.html');
  for (const id of ['api', 'cli', 'claves', 'clavesForm', 'clavesAnon', 'claveCrear', 'ejemploCurl']) assert.ok(a.includes(`id="${id}"`), `api: #${id}`);
  assert.match(a, /data-pagina="api"/);
  assert.match(a, /<main class="doc-cli" id="cli">/);   // el CLI completo, debajo de la API
  assert.ok(a.indexOf('id="api"') < a.indexOf('id="cli"'));
  for (const id of ['colaborar', 'aportar', 'sugerencias']) assert.ok(!b.includes(`id="${id}"`), `el buscador ya no lleva #${id}`);
  const c = leer('colaborar.html');
  for (const id of ['colaborar', 'aportar', 'sugerencias']) assert.ok(c.includes(`id="${id}"`), `colaborar: #${id}`);
});

test('ningún enlace interno apunta a anclas que ya no existen en su página', () => {
  for (const f of ['index.html', 'buscador.html', 'api.html', 'colaborar.html', 'mapa.html', 'cli.html', 'legal.html']) {
    const destinos = { 'api.html': leer('api.html'), 'buscador.html': leer('buscador.html'), 'colaborar.html': leer('colaborar.html') };
    for (const href of enlaces(leer(f))) {
      const m = href.match(/^\.\/(api|buscador)\.html#(\w+)$/);
      if (m) assert.ok(destinos[`${m[1]}.html`].includes(`id="${m[2]}"`), `${f}: ${href}`);
      assert.ok(!/^\.\/(index\.html)?#(api|claves)$/.test(href), `${f}: ${href} apunta a algo que ya no está en la portada`);
    }
  }
});
