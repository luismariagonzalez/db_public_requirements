#!/usr/bin/env node
// Ensayo de la interfaz «¿Quieres colaborar?» con un navegador de verdad (Playwright),
// contra el Postgres LOCAL: web/ servida con la CSP de vercel.json + la API real
// (api/entrada.js) con el Supabase falso delante. Sin Gemini ni Clerk.
//
//   npm run db:up && npm run db:ensayar
//   PLAYWRIGHT_DIR=/ruta/a/node_modules node scripts/ensayar_ui_colaborar.mjs
//
// Playwright NO es dependencia del repositorio: PLAYWRIGHT_DIR apunta a una carpeta
// node_modules que lo tenga (npm i playwright en cualquier sitio).

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { levantar } from './supabase_falso.mjs';

const dirPw = process.env.PLAYWRIGHT_DIR;
if (!dirPw) { console.error('\n  Define PLAYWRIGHT_DIR (una carpeta node_modules con playwright).\n'); process.exit(2); }
const { chromium } = await import(pathToFileURL(join(dirPw, 'playwright', 'index.mjs')).href);

const falso = await levantar();
process.env.IP_SALT = randomBytes(8).toString('hex');
delete process.env.GEMINI_API_KEY; delete process.env.CLERK_PUBLISHABLE_KEY;
const { default: handler } = await import('../api/entrada.js');
const { rpc } = await import('../lib/bd.mjs');

// El catálogo de verdad (si existe) o el de ejemplo.
const raiz = fileURLToPath(new URL('../', import.meta.url));
const semilla = existsSync(join(raiz, 'semilla/herramientas.json')) ? 'semilla/herramientas.json' : 'semilla/herramientas.ejemplo.json';
const herr = JSON.parse(readFileSync(join(raiz, semilla), 'utf8'));
for (const h of herr)
  await rpc('upsert_herramienta', { p_slug: h.slug, p_nombre: h.nombre, p_categoria: h.categoria, p_descripcion: h.descripcion ?? '',
    p_url_codigo: h.url_codigo ?? null, p_url_docs: h.url_docs ?? null, p_plataformas: h.plataformas ?? [], p_estado: 'active', p_orden: h.orden ?? 100 });

const catalogo = await rpc('herramientas');   // lo que de verdad hay en la base (puede traer restos de otros ensayos)
const csp = JSON.parse(readFileSync(join(raiz, 'vercel.json'), 'utf8')).headers[0].headers.find((x) => x.key === 'Content-Security-Policy').value
  .replace('upgrade-insecure-requests', '');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const web = createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  const ruta = req.url.split('?')[0];
  const f = join(raiz, 'web', ruta === '/' ? 'index.html' : ruta.replace(/\.\./g, ''));
  if (!existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', TIPOS[extname(f)] ?? 'text/plain'); res.setHeader('content-security-policy', csp);
  res.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((ok) => web.once('listening', ok));
const URL_WEB = `http://127.0.0.1:${web.address().port}`;

let fallos = 0;
const prueba = async (nombre, fn) => { try { await fn(); console.log(`  ✓ ${nombre}`); } catch (e) { fallos++; console.log(`  ✗ ${nombre}\n    ${e.message}`); } };

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });   // CHROMIUM_PATH: un chrome ya instalado
const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-GB' });
const pag = await ctx.newPage();
const errores = [];
pag.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(NAME|INTERNET|CONNECTION|BLOCKED)|net::|Failed to load resource/.test(m.text())) errores.push(m.text()); });
pag.on('pageerror', (e) => errores.push(e.message));

console.log('');
await pag.goto(URL_WEB + '/?lang=en');

await prueba('el botón «Want to help?» está en la cabecera y lleva a la caja', async () => {
  const b = pag.locator('#btnColaborar');
  assert.equal((await b.innerText()).trim(), 'Want to help?');
  assert.ok(await b.isVisible());
  await b.click();
  await pag.waitForFunction(() => document.querySelector('#colaborar').getBoundingClientRect().top < innerHeight - 100);
  assert.ok(await pag.locator('#colaborar').isVisible());
  assert.equal(await pag.locator('.col-pasos li').count(), 3);
});

await prueba('el catálogo se carga de /api/v1/tools y se puede filtrar', async () => {
  await pag.waitForFunction(() => document.querySelectorAll('#colLista li').length > 0);
  assert.equal(await pag.locator('#colLista li').count(), catalogo.length);
  await pag.fill('#colBuscar', catalogo[0].slug);
  assert.equal(await pag.locator('#colLista li').count(), 1);
  await pag.fill('#colBuscar', 'zzzz-nada');
  assert.equal(await pag.locator('#colLista li').count(), 0);
  assert.match(await pag.locator('#colEstado').innerText(), /No tool matches/);
  await pag.fill('#colBuscar', '');
  assert.equal(await pag.locator('#colLista li').count(), catalogo.length);
});

await prueba('elegir una herramienta muestra el prompt con sus URLs y la base de esta web', async () => {
  assert.ok(await pag.locator('#colCopiar').isDisabled());
  await pag.locator('#colLista button').first().click();
  const h = catalogo[0];
  const p = await pag.locator('#colPrompt').innerText();
  assert.ok(p.includes(`study "${h.name}"`));
  assert.ok(p.includes(`GET ${URL_WEB}/api/v1/requirements?q=`));
  assert.ok(p.includes(`POST ${URL_WEB}/api/contribute`));
  assert.ok(!/rq_[A-Za-z0-9]{8,}/.test(p));
  assert.ok(await pag.locator('#colCopiar').isEnabled());
  assert.equal(await pag.locator('#colLista button[aria-pressed="true"]').count(), 1);
});

await prueba('«Copy prompt» copia el prompt y avisa', async () => {
  await pag.click('#colCopiar');
  await pag.waitForFunction(() => !document.querySelector('#aviso').hidden);
  const copiado = await pag.evaluate(() => navigator.clipboard.readText());
  assert.equal(copiado.replace(/\r\n/g, '\n'), await pag.locator('#colPrompt').textContent());
  assert.equal((await pag.locator('#aviso').innerText()).trim(), 'Copied');
});

if (process.env.CAPTURA) {   // CAPTURA=carpeta: guarda capturas de la caja y de la cabecera para mirarlas a ojo
  await pag.locator('#colaborar').screenshot({ path: join(process.env.CAPTURA, 'colaborar.png') });
  await pag.screenshot({ path: join(process.env.CAPTURA, 'pagina.png') });
}

await prueba('en español la interfaz cambia y el prompt sigue en inglés', async () => {
  await pag.click('.idiomas button[data-lang="es"]');
  assert.equal((await pag.locator('#btnColaborar').innerText()).trim(), '¿Quieres colaborar?');
  assert.equal((await pag.locator('#t-colaborar').innerText()).trim(), '¿Quieres colaborar?');
  assert.equal((await pag.locator('#colCopiar').innerText()).trim(), 'Copiar prompt');
  assert.match(await pag.locator('#colChars').innerText(), /en inglés/);
  assert.match(await pag.locator('#colPrompt').innerText(), /# Task: study/);
  await pag.click('#colCopiar');
  await pag.waitForFunction(() => document.querySelector('#aviso').textContent === 'Copiado');
});

await prueba('«Sugerir algo» ya es sobre la app: sin objetivo requisito/test/acelerador', async () => {
  assert.equal(await pag.locator('#sugObjetivo, #sugObjetivoTipo').count(), 0);
  assert.deepEqual(await pag.locator('#sugTipo option').evaluateAll((o) => o.map((x) => x.value)), ['feature', 'problem']);
});

await prueba('sin errores en la consola (CSP incluida)', async () => { assert.deepEqual(errores, []); });

await nav.close(); web.close(); await falso.cerrar();
console.log(fallos ? `\n  ${fallos} fallo(s).\n` : '\n  Interfaz de colaborar ensayada.\n');
process.exit(fallos ? 1 : 0);
