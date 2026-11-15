#!/usr/bin/env node
// Ensayo con Gemini REAL contra el Postgres LOCAL (nunca la base compartida):
//   1. carga la semilla (semilla/) con sus embeddings, como haría scripts/sembrar.mjs
//   2. búsqueda semántica por la API: sin «text-only», acierta y usa la caché
//   3. la revisión de aportes con el LLM: duplicado en otro idioma, aporte nuevo,
//      spam y un aporte que dicta el layout
//
//   npm run db:up && npm run db:ensayar && npm run gemini:ensayar
//
// Gasta unas pocas llamadas de Gemini. Los resultados del LLM no son
// deterministas: las comprobaciones son las que NO deberían fallar nunca.

import './gemini_env.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { levantar } from './supabase_falso.mjs';
import { exige } from './entorno.mjs';

exige('GEMINI_API_KEY');
const falso = await levantar();
process.env.IP_SALT = randomBytes(8).toString('hex');
delete process.env.CLERK_PUBLISHABLE_KEY;

const fallos = [];
async function prueba(nombre, fn) {
  try { await fn(); console.log(`  ✓ ${nombre}`); }
  catch (e) { fallos.push(nombre); console.log(`  ✗ ${nombre}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
console.log('');

// ── 1. la semilla, por el mismo camino que usa en producción
await prueba('sembrar.mjs carga categorías y requisitos con embeddings', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/sembrar.mjs'],
    { env: process.env, timeout: 300_000 });
  assert.match(stdout, /requisitos cargados|ya existen/);
});

const { default: handler } = await import('../api/entrada.js');
const { rpc } = await import('../lib/bd.mjs');
const { generarJson } = await import('../lib/gemini.mjs');
const { revisar } = await import('../lib/revisar.mjs');

const api = createServer((req, res) => handler(req, res)).listen(0, '127.0.0.1');
await new Promise((ok) => api.once('listening', ok));
let ip = 0;
const pedir = async (ruta) => {
  const r = await fetch(`http://127.0.0.1:${api.address().port}${ruta}`, { headers: { 'x-real-ip': `10.1.0.${++ip}` } });
  return { estado: r.status, json: await r.json().catch(() => null), cab: r.headers };
};

// Un requisito cualquiera de la semilla, y su texto, como material de prueba.
const lista = (await pedir('/api/v1/requirements?limit=200')).json?.requirements ?? [];
assert.ok(lista.length >= 3, 'no hay requisitos cargados: ¿semilla vacía?');
const objetivo = lista.find((r) => r.priority === 1) ?? lista[0];
console.log(`  (${lista.length} requisitos en la base local; objetivo: “${objetivo.title}”)\n`);

// ── 2. búsqueda semántica
await prueba('la búsqueda por significado encuentra el requisito y no cae a solo texto', async () => {
  const r = await pedir(`/api/v1/requirements?q=${encodeURIComponent(objetivo.statement)}&limit=5`);
  assert.equal(r.estado, 200);
  assert.equal(r.cab.get('x-search-mode'), null, 'cayó al modo solo texto: falló el embedding');
  assert.equal(r.json.requirements[0].slug, objetivo.slug, `top1 = ${r.json.requirements[0].slug}`);
});

await prueba('una paráfrasis en otro idioma encuentra el mismo requisito entre los 5 primeros', async () => {
  const p = await generarJson(`Rewrite in Spanish, with different words and without copying phrases: "${objetivo.statement}"`,
    { type: 'OBJECT', properties: { texto: { type: 'STRING' } }, required: ['texto'] });
  const r = await pedir(`/api/v1/requirements?q=${encodeURIComponent(p.texto)}&limit=5`);
  const slugs = r.json.requirements.map((x) => x.slug);
  assert.ok(slugs.includes(objetivo.slug), `“${p.texto}” → ${slugs.join(', ')}`);
});

await prueba('la consulta repetida sale de la caché de embeddings', async () => {
  const q = `error handling for ${objetivo.title}`;
  const t0 = Date.now(); await pedir(`/api/v1/requirements?q=${encodeURIComponent(q)}`);
  const t1 = Date.now(); const r = await pedir(`/api/v1/requirements?q=${encodeURIComponent(q)}`);
  const t2 = Date.now();
  assert.equal(r.estado, 200);
  console.log(`      primera ${t1 - t0} ms · repetida ${t2 - t1} ms`);
  assert.ok(t2 - t1 < t1 - t0, 'la repetida no es más rápida: ¿no usa la caché?');
});

// ── 3. revisión de aportes con el LLM
const aportar = (texto) => revisar({ autor: 'user_gemini_' + process.env.IP_SALT, texto, categoriasSugeridas: [] });
const resumen = (r) => `${r.status}: ${(r.items ?? []).map((i) => `${i.action}${i.slug ? ' ' + i.slug : ''}${i.duplicate_of ? ' dup→' + i.duplicate_of : ''} (${i.reason})`).join(' | ') || r.reason}`;

await prueba('un duplicado en otro idioma NO se crea de nuevo', async () => {
  const p = await generarJson(`Rewrite in Spanish, as a casual suggestion from a user, with different words: "${objetivo.statement}"`,
    { type: 'OBJECT', properties: { texto: { type: 'STRING' } }, required: ['texto'] });
  const r = await aportar(p.texto);
  console.log(`      “${p.texto.slice(0, 90)}…” → ${resumen(r)}`);
  assert.notEqual(r.status, 'created', resumen(r));
});

await prueba('un aporte claramente nuevo se crea (o, como mucho, se fusiona)', async () => {
  const r = await aportar('The app must let users schedule an email digest of unread items at a time of their choosing, in their own time zone, and stop it with one click from the email itself.');
  console.log(`      ${resumen(r)}`);
  assert.ok(['created', 'merged', 'needs_human'].includes(r.status), resumen(r));
});

await prueba('el spam se rechaza y no crea nada', async () => {
  const antes = (await pedir('/api/v1/requirements?limit=200')).json.count;
  const r = await aportar('COMPRA YA!!! Relojes baratos 90% descuento en www.ofertas-locas.example, escríbeme por WhatsApp');
  console.log(`      ${resumen(r)}`);
  assert.equal(r.status, 'rejected', resumen(r));
  assert.equal((await pedir('/api/v1/requirements?limit=200')).json.count, antes);
});

await prueba('un aporte que dicta pantallas y layout se reescribe sin la ubicación', async () => {
  const r = await aportar('Poner un botón rojo de "Cerrar sesión" en la barra lateral izquierda, debajo del avatar, que al pulsarlo cierre la sesión en todos los dispositivos.');
  console.log(`      ${resumen(r)}`);
  assert.notEqual(r.status, 'rejected', resumen(r));
  for (const it of r.items ?? []) {
    if (!it.slug) continue;
    const f = (await pedir(`/api/v1/requirements/${it.slug}`)).json;
    const texto = `${f.title} ${f.statement} ${(f.criteria ?? []).join(' ')}`;
    console.log(`      → “${f.statement}”`);
    assert.doesNotMatch(texto, /\b(button|sidebar|side bar|navbar|menu|avatar|left|red)\b/i, `sigue dictando ubicación: ${texto}`);
  }
});

api.close(); await falso.cerrar();
console.log(fallos.length ? `\n  ${fallos.length} fallo(s).\n` : '\n  Gemini real ensayado de punta a punta.\n');
process.exit(fallos.length ? 1 : 0);
