#!/usr/bin/env node
// Carga el catálogo de herramientas (semilla/herramientas.json) en la base de SUPABASE_URL.
// Idempotente: upsert por slug. Necesita la migración 0010.
//
//   node scripts/sembrar_herramientas.mjs --dry              valida y cuenta, sin escribir
//   node scripts/sembrar_herramientas.mjs --verificar        además comprueba cada URL con una petición (HEAD, y GET si falla)
//   node scripts/sembrar_herramientas.mjs                    carga de verdad
//   node scripts/sembrar_herramientas.mjs --fichero=semilla/herramientas.ejemplo.json
//
// semilla/herramientas.json no se versiona (como el resto de lo generado en semilla/);
// semilla/herramientas.ejemplo.json es el pequeño de ejemplo para los tests.

import './gemini_env.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validarLista } from '../lib/herramientas_semilla.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const VERIFICAR = args.includes('--verificar');
const ruta = args.find((a) => a.startsWith('--fichero='))?.slice(10)
  ?? fileURLToPath(new URL('../semilla/herramientas.json', import.meta.url));

if (!existsSync(ruta)) {
  console.error(`\n  No existe ${ruta}. Usa --fichero=semilla/herramientas.ejemplo.json para el de ejemplo.\n`);
  process.exit(1);
}
const lista = JSON.parse(readFileSync(ruta, 'utf8'));
const fallos = validarLista(lista);
if (fallos.length) {
  for (const f of fallos) console.error(`  ✗ ${f.slug}: ${f.problemas.join('; ')}`);
  process.exit(1);
}
console.log(`\n  ${lista.length} herramientas válidas en ${ruta}`);

async function responde(url) {
  const cab = { 'user-agent': 'airedb-seed-check/1.0 (+link check)' };
  for (const metodo of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, { method: metodo, redirect: 'follow', headers: cab, signal: AbortSignal.timeout(20_000) });
      if (r.ok) return { ok: true, estado: r.status };
      if (metodo === 'GET') return { ok: false, estado: r.status };
    } catch (e) { if (metodo === 'GET') return { ok: false, estado: e.cause?.code ?? e.message }; }
  }
}

if (VERIFICAR) {
  let malas = 0;
  const cola = lista.flatMap((h) => [['url_codigo', h], ['url_docs', h]].filter(([c]) => h[c]).map(([c]) => ({ h, c, url: h[c] })));
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let t; (t = cola.shift());) {
      const r = await responde(t.url);
      if (!r.ok) { malas++; console.log(`  ✗ ${t.h.slug} ${t.c}: ${t.url} → ${r.estado}`); }
    }
  }));
  console.log(malas ? `\n  ${malas} URL(s) no responden.\n` : '  ✓ todas las URL responden');
  if (malas) process.exit(1);
}

if (DRY) { console.log('  (--dry: no se escribe nada)\n'); process.exit(0); }

const { exige } = await import('./entorno.mjs');
exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
const { rpc } = await import('../lib/bd.mjs');
for (const h of lista) {
  await rpc('upsert_herramienta', { p_slug: h.slug, p_nombre: h.nombre, p_categoria: h.categoria, p_descripcion: h.descripcion ?? '',
    p_url_codigo: h.url_codigo ?? null, p_url_docs: h.url_docs ?? null, p_plataformas: h.plataformas ?? [],
    p_estado: h.estado ?? 'active', p_orden: h.orden ?? 100 });
}
console.log(`  ✓ ${lista.length} herramientas al día\n`);
