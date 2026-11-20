#!/usr/bin/env node
// Reorganiza la taxonomía tras las migraciones 0004 y 0005, preguntando a Gemini lo que las
// reglas fijas (lib/reorganizar.mjs) no deciden:
//
//   a) clase de los requisitos antiguos de seguridad, privacidad, accesibilidad, UX y legal
//      → functional | technical
//   b) en qué flujos de acceso (registro, inicio de sesión, recuperación) cae cada requisito
//      de la antigua pantalla «screen-auth»
//   c) de qué arquetipos de app hereda cada categoría de software de Capterra
//   d) los transversales que faltan (p. ej. un requisito de clase «security» que no está en
//      la categoría Security)
//
//   node scripts/reorganizar.mjs                 genera semilla/reorganizacion.json (para REVISAR)
//   node scripts/reorganizar.mjs --solo=clases   solo una parte: clases | acceso | herencia
//   node scripts/reorganizar.mjs --aplicar       lee semilla/reorganizacion.json y lo aplica en la base
//                                                (srv_reorganizar; necesita SUPABASE_URL y SUPABASE_SECRET_KEY)
//
// El JSON está en semilla/ (ignorado por git): el repositorio público no lleva contenido.

import './gemini_env.mjs';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { generarJson } from '../lib/gemini.mjs';
import { claseFija, slugDe, flujosValidos, arquetiposValidos, transversalesQueFaltan, validaClase,
  ARQUETIPOS, ARQUETIPOS_NUEVOS, FLUJOS_ACCESO } from '../lib/reorganizar.mjs';

const raiz = new URL('../semilla/', import.meta.url);
const SALIDA = new URL('reorganizacion.json', raiz);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const solo = arg('solo');

if (process.argv.includes('--aplicar')) {
  const { exige } = await import('./entorno.mjs');
  exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  const { rpc } = await import('../lib/bd.mjs');
  const datos = JSON.parse(readFileSync(SALIDA, 'utf8'));
  const r = await rpc('reorganizar', { p_datos: {
    clases: Object.fromEntries(Object.entries(datos.clases).map(([s, c]) => [s, c.a])),
    acceso: datos.acceso, transversales: datos.transversales, herencia: datos.herencia } });
  console.log('  ✓ aplicado:', JSON.stringify(r));
  process.exit(0);
}

// ── lectura de la semilla
const requisitos = [];
for (const f of readdirSync(new URL('requisitos/', raiz)).filter((x) => x.endsWith('.json'))) {
  for (const r of JSON.parse(readFileSync(new URL(`requisitos/${f}`, raiz), 'utf8'))) {
    requisitos.push({ slug: slugDe(r.title), title: r.title, statement: r.statement, kind: r.kind, categories: r.categories });
  }
}
console.log(`  ${requisitos.length} requisitos en la semilla`);
const previo = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, 'utf8')) : {};
// Se puede repetir: lo que ya contestó Gemini en una pasada anterior no se vuelve a pedir.
const salida = { clases: {}, acceso: {}, transversales: [], herencia: {}, herencia_ia: {}, ...previo };

// ── lotes con 3 trabajadores y 2 intentos, como importar_capterra.mjs
async function enLotes(items, tam, etiqueta, hacer) {
  const lotes = Array.from({ length: Math.ceil(items.length / tam) }, (_, i) => items.slice(i * tam, i * tam + tam));
  const cola = [...lotes.entries()];
  const trabajador = async () => {
    for (let t; (t = cola.shift());) {
      const [n, lote] = t;
      for (let intento = 0; intento < 3; intento++) {
        try { await hacer(lote); console.log(`  ✓ ${etiqueta} ${n + 1}/${lotes.length}`); break; }
        catch (e) { if (intento) console.log(`  ✗ ${etiqueta} ${n + 1}: ${e.message}`); }
      }
    }
  };
  await Promise.all([trabajador(), trabajador()]);
}

// ── a) clases
if (!solo || solo === 'clases') {
  for (const r of requisitos) {
    const fija = claseFija(r.kind);
    if (fija) salida.clases[r.slug] = { de: r.kind, a: fija, ia: false };
  }
  const dudosos = requisitos.filter((r) => !claseFija(r.kind) && !salida.clases[r.slug]?.ia);
  const ESQ = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    id: { type: 'NUMBER' }, kind: { type: 'STRING', enum: ['functional', 'technical'] } }, required: ['id', 'kind'] } } }, required: ['items'] };
  await enLotes(dudosos, Number(arg('lote')) || 40, 'clases', async (lote) => {
    const r = await generarJson(`Classify each software requirement as "functional" or "technical".

- functional: something a user (or another system through its public interface) can do or sees happen: features, rules, flows, messages, permissions as experienced, data a person controls (e.g. "Users can export their data", "Locked accounts show a generic message", "Captions are available for video").
- technical: how the system is built or operated, mostly invisible to the user: encryption at rest, hashing, rate limiting internals, logging, headers, backups, retries, caching, dependency scanning, monitoring (e.g. "Passwords are hashed with a slow salted algorithm", "Secrets are never stored in the client bundle").

The theme (security, privacy, accessibility…) does not matter: only whether a person would notice the behaviour (functional) or an engineer would configure it (technical). When in doubt, choose functional.

Requirements (id | title | statement):
${lote.map((x, i) => `${i} | ${x.title} | ${x.statement}`).join('\n')}`, ESQ, { maxTokens: 8000 });
    for (const it of r.items ?? []) {
      const q = lote[Number(it.id)];
      const c = validaClase(it.kind);
      if (q && c) salida.clases[q.slug] = { de: q.kind, a: c, ia: true };
    }
  });
  // lo que Gemini no contestó se queda en el valor por defecto de la migración (functional)
  for (const r of requisitos) salida.clases[r.slug] ??= { de: r.kind, a: 'functional', ia: false };
}

// ── d) transversales que faltan (por regla)
if (!solo || solo === 'clases') salida.transversales = transversalesQueFaltan(requisitos);

// ── b) acceso
if (!solo || solo === 'acceso') {
  const acceso = requisitos.filter((r) => r.categories.some((c) => c.slug === 'screen-auth') && !salida.acceso[r.slug]);
  const ESQ = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    id: { type: 'NUMBER' }, flows: { type: 'ARRAY', items: { type: 'STRING', enum: FLUJOS_ACCESO } } }, required: ['id', 'flows'] } } }, required: ['items'] };
  await enLotes(acceso, 40, 'acceso', async (lote) => {
    const r = await generarJson(`Each requirement below belonged to a single "sign-up / sign-in / recovery" group. Assign it to every flow where it applies (usually one, sometimes two or three):

- flow-sign-up: creating an account (required data, email/phone verification, terms, duplicate accounts, abuse and bot protection at registration, social sign-up).
- flow-sign-in: logging in and staying logged in (credentials, social login, sessions, device trust, throttling and lockout, multi-factor, sign-out, session expiry).
- flow-recovery: getting back in (password reset, recovery codes, locked or compromised accounts, changing email or phone, support-assisted recovery).

Requirements (id | title | statement):
${lote.map((x, i) => `${i} | ${x.title} | ${x.statement}`).join('\n')}`, ESQ, { maxTokens: 6000 });
    for (const it of r.items ?? []) {
      const q = lote[Number(it.id)];
      const f = flujosValidos(it.flows);
      if (q && f) salida.acceso[q.slug] = f;
    }
  });
  // sin respuesta: se quedan en los tres (así lo deja la migración)
}

// ── c) herencia de arquetipos
if (!solo || solo === 'herencia') {
  const categorias = JSON.parse(readFileSync(new URL('categorias_software.json', raiz), 'utf8'));
  const originales = JSON.parse(readFileSync(new URL('categorias.json', raiz), 'utf8')).filter((c) => c.tipo === 'app_type');
  const catalogo = [...originales.map((c) => `- ${c.slug}: ${c.nombre}. ${c.descripcion ?? ''}`.trim()), ...ARQUETIPOS_NUEVOS.map(([s, d]) => `- ${s}: ${d}`)];
  const ESQ = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    id: { type: 'NUMBER' }, archetypes: { type: 'ARRAY', items: { type: 'STRING', enum: ARQUETIPOS } } }, required: ['id', 'archetypes'] } } }, required: ['items'] };
  const pendientes = categorias.filter((c) => !salida.herencia_ia[c.slug]);
  await enLotes(pendientes, 70, 'herencia', async (lote) => {
    const r = await generarJson(`A database holds software requirements per "archetype" (a kind of application). Each business-software category below should INHERIT the requirements of 1 or 2 archetypes: the kinds of application someone would build to implement that category of software. Pick the closest one or two; use "other-business-software" only when none fits.

Archetypes:
${catalogo.join('\n')}

Categories (id | name | domain | audiences):
${lote.map((x, i) => `${i} | ${x.nombre} | ${x.dominio} | ${x.audiencias.join(',')}`).join('\n')}`, ESQ, { maxTokens: 12000 });
    for (const it of r.items ?? []) {
      const q = lote[Number(it.id)];
      if (q) { salida.herencia[q.slug] = arquetiposValidos(it.archetypes).slice(0, 2); salida.herencia_ia[q.slug] = true; }
    }
  });
  for (const c of categorias) salida.herencia[c.slug] ??= arquetiposValidos([]);
}

writeFileSync(SALIDA, JSON.stringify(salida, null, 1) + '\n');

// ── resumen para revisar
const cl = Object.values(salida.clases);
const cuenta = (f) => cl.filter(f).length;
console.log(`\n  ✓ escrito semilla/reorganizacion.json`);
console.log(`  clases: ${cl.length} (functional ${cuenta((c) => c.a === 'functional')}, technical ${cuenta((c) => c.a === 'technical')}; decididas por IA: ${cuenta((c) => c.ia)})`);
console.log(`  acceso: ${Object.keys(salida.acceso).length} requisitos repartidos entre ${FLUJOS_ACCESO.join(', ')}`);
console.log(`  transversales que faltan: ${salida.transversales.length}`);
const h = {}; for (const a of Object.values(salida.herencia).flat()) h[a] = (h[a] ?? 0) + 1;
console.log(`  herencia: ${Object.keys(salida.herencia).length} categorías (${Object.keys(salida.herencia_ia).length} decididas por IA) →`, JSON.stringify(h));
const sinClase = requisitos.filter((r) => !claseFija(r.kind) && !salida.clases[r.slug]?.ia).length;
const sinAcceso = requisitos.filter((r) => r.categories.some((c) => c.slug === 'screen-auth') && !salida.acceso[r.slug]).length;
const sinHerencia = Object.keys(salida.herencia).length - Object.keys(salida.herencia_ia).length;
if (sinClase || sinAcceso || sinHerencia) console.log(`  ⚠ sin contestar: ${sinClase} clases, ${sinAcceso} de acceso, ${sinHerencia} herencias. Repite el comando para completarlo.`);
