// Pruebas del build: lo que sale a internet. Se corren con `npm test`
// (node:test, sin dependencias). Pon junto a este fichero las de tu lógica:
// un <algo>.test.mjs por módulo de web/ que tenga reglas (cálculos, filtros,
// validaciones). La interfaz se prueba aparte, con Playwright, si la hay.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const construir = (env = {}) => execFileSync(process.execPath, ['scripts/construir.mjs'], {
  cwd: raiz,
  // Sin los secretos compartidos del disco: el build debe salir sin ellos.
  env: { ...process.env, SECRETOS_HOME: '/no/existe', ...env },
  stdio: 'pipe',
});

test('el sitio se construye sin credenciales', () => {
  construir();
  assert.ok(readdirSync(new URL('publico/', raiz)).includes('index.html'));
});

test('en publico/ solo sale lo de la lista blanca', () => {
  construir();
  for (const f of readdirSync(new URL('publico/', raiz)))
    assert.match(f, /\.(html|js|mjs|css|svg|png|jpe?g|webp|woff2?|ico|json)$/, `no debería publicarse: ${f}`);
});

test('ningún HTML lleva scripts en línea (la CSP no los dejaría correr)', () => {
  construir();
  for (const f of readdirSync(new URL('publico/', raiz)).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(new URL(`publico/${f}`, raiz), 'utf8');
    const enLinea = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs, cuerpo]) => !/\bsrc=/.test(attrs) && !/application\/(ld\+)?json/.test(attrs) && cuerpo.trim());
    assert.equal(enLinea.length, 0, `${f} tiene <script> en línea; muévelo a un .js`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${f} tiene un manejador onclick=… en línea`);
  }
});

test('terms.html sale de LICENSE-DATA.md, escapado y con la restricción visible', () => {
  construir();
  const html = readFileSync(new URL('publico/terms.html', raiz), 'utf8');
  assert.match(html, /<h1>Requirements DB: Content Terms<\/h1>/);
  assert.match(html, /Bulk extraction/);
  assert.match(html, /<div class="es">[\s\S]*prevalece la versión en inglés/);   // traducción de cortesía
  for (const [etiqueta] of html.matchAll(/<script\b[^>]*>/gi)) assert.match(etiqueta, /\ssrc=/, 'solo scripts en fichero');
});

test('legal y CLI llevan un bloque por idioma, el conmutador y el script de idioma', () => {
  construir();
  for (const f of ['legal.html', 'cli.html', 'terms.html']) {
    const html = readFileSync(new URL(`publico/${f}`, raiz), 'utf8');
    assert.match(html, /<div class="en">/, f);
    assert.match(html, /<div class="es">/, f);
    assert.match(html, /data-lang="es"/, f);
    assert.match(html, /<script type="module" src="\.\/pagina\.js">/, f);
  }
});

test('el CLI se publica como /reqdb.mjs y es el mismo fichero', () => {
  construir();
  assert.equal(readFileSync(new URL('publico/reqdb.mjs', raiz), 'utf8'), readFileSync(new URL('cli/reqdb.mjs', raiz), 'utf8'));
});
