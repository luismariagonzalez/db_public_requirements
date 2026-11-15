#!/usr/bin/env node
// Importa las categorías de software de Capterra y las clasifica con Gemini en la
// jerarquía  audiencia (b2b, b2c…) → dominio (marketing, finanzas…) → categoría.
//
//   curl con cabeceras de navegador a https://www.capterra.es/directory → semilla/capterra_bruto.json
//   ([{ id, slug, name }]; ver el README) y después:
//   node scripts/importar_capterra.mjs
//
// Escribe semilla/categorias_software.json (ignorado por git; lo carga sembrar.mjs).
// Los slugs se normalizan a los de la base ([a-z0-9-], ≤ 60) y los nombres se pasan a
// inglés. Las audiencias y los dominios válidos son los de semilla/categorias.json.

import './gemini_env.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { generarJson } from '../lib/gemini.mjs';

const raiz = new URL('../semilla/', import.meta.url);
const bruto = JSON.parse(readFileSync(new URL('capterra_bruto.json', raiz), 'utf8'));
const base = JSON.parse(readFileSync(new URL('categorias.json', raiz), 'utf8'));
const AUDIENCIAS = base.filter((c) => c.tipo === 'audience');
const DOMINIOS = base.filter((c) => c.tipo === 'domain' && c.slug !== 'app-archetypes');
const ocupados = new Set(base.map((c) => c.slug));

const normaliza = (slug, id) => {
  let s;
  try { s = decodeURIComponent(slug); } catch { s = slug; }
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(s)) s = `capterra-${id}`;
  if (ocupados.has(s)) s = `${s.slice(0, 50).replace(/-+$/, '')}-sw`;
  while (ocupados.has(s)) s = `${s.slice(0, 48)}-${id}`;
  ocupados.add(s);
  return s;
};

const items = bruto.map((x) => ({ id: x.id, slug: normaliza(x.slug, x.id), orig: x.slug, es: x.name }));

const ESQ = { type: 'OBJECT', properties: { categories: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  id: { type: 'NUMBER' }, name: { type: 'STRING' },
  domain: { type: 'STRING', enum: DOMINIOS.map((d) => d.slug) },
  audiences: { type: 'ARRAY', items: { type: 'STRING', enum: AUDIENCIAS.map((a) => a.slug) } } },
  required: ['id', 'name', 'domain', 'audiences'] } } }, required: ['categories'] };

const prompt = (lote) => `You are building a taxonomy of software categories (taken from Capterra's directory) for a database of software requirements.

For each category give:
- "name": a clean, short English display name (e.g. "Customer Relationship Management (CRM)", "Learning Management Systems"). Translate from the Spanish name; use the English slug as a hint.
- "domain": exactly one of the domains below, the best fit.
- "audiences": 1 to 3 of the audiences below: who typically buys or uses this software.

Audiences:
${AUDIENCIAS.map((a) => `- ${a.slug}: ${a.descripcion}`).join('\n')}

Domains:
${DOMINIOS.map((d) => `- ${d.slug}: ${d.nombre}`).join('\n')}

Rules: Capterra is mostly business software, so most categories are b2b; add b2c if consumers also buy it directly, b2b2c if businesses use it to serve consumers (booking, marketplaces, e-commerce, ticketing), internal if it is mostly a back-office or in-house tool, developer if developers are the users, b2g for public-sector-specific software. Use the given id in your answer.

Categories (id | english slug | Spanish name):
${lote.map((x) => `${x.id} | ${x.orig.replace(/%28|%29|%26/g, ' ')} | ${x.es}`).join('\n')}`;

const lotes = Array.from({ length: Math.ceil(items.length / 70) }, (_, i) => items.slice(i * 70, i * 70 + 70));
const resultados = new Map();
const cola = [...lotes.entries()];
const trabajador = async () => {
  for (let t; (t = cola.shift());) {
    const [n, lote] = t;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await generarJson(prompt(lote), ESQ, { maxTokens: 16000 });
        for (const c of r.categories ?? []) resultados.set(Number(c.id), c);
        console.log(`  ✓ lote ${n + 1}/${lotes.length}`);
        break;
      } catch (e) { if (intento) console.log(`  ✗ lote ${n + 1}: ${e.message}`); }
    }
  }
};
await Promise.all([trabajador(), trabajador(), trabajador()]);

const dominios = new Set(DOMINIOS.map((d) => d.slug));
const audiencias = new Set(AUDIENCIAS.map((a) => a.slug));
let sinClasificar = 0;
const salida = items.map((x, i) => {
  const c = resultados.get(x.id);
  if (!c) sinClasificar++;
  const aud = [...new Set((c?.audiences ?? []).filter((a) => audiencias.has(a)))].slice(0, 3);
  const nombre = String(c?.name ?? '').replace(/\s+/g, ' ').trim();
  return { slug: x.slug, tipo: 'software_category', capterra_id: x.id,
    nombre: nombre.length >= 2 && nombre.length <= 80 ? nombre : x.orig.replace(/%\w\w/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim().slice(0, 80),
    descripcion: '', orden: i + 1,
    dominio: dominios.has(c?.domain) ? c.domain : 'other', audiencias: aud.length ? aud : ['b2b'] };
}).sort((a, b) => a.nombre.localeCompare(b.nombre)).map((x, i) => ({ ...x, orden: i + 1 }));

writeFileSync(new URL('categorias_software.json', raiz), JSON.stringify(salida, null, 1) + '\n');

const porDom = {}, porAud = {};
for (const c of salida) { porDom[c.dominio] = (porDom[c.dominio] ?? 0) + 1; for (const a of c.audiencias) porAud[a] = (porAud[a] ?? 0) + 1; }
console.log(`\n  ✓ ${salida.length} categorías (${sinClasificar} sin clasificar → dominio other, b2b)`);
console.log('  audiencias:', JSON.stringify(porAud));
console.log('  dominios:', JSON.stringify(porDom));
