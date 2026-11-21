#!/usr/bin/env node
// Carga la semilla regulatoria de un país (semilla/regulacion-<país>/*.json) en la base de la
// que apunten SUPABASE_URL / SUPABASE_SECRET_KEY, con sus jurisdicciones, matices y fuentes.
// Idempotente por slug: lo que ya existe no se vuelve a crear ni a embeber; la asociación a la
// jurisdicción (matiz y fuente) sí se reaplica, así que corregir un matiz en la semilla y
// volver a lanzar lo actualiza.
//
//   node scripts/sembrar_regulacion.mjs --dry            valida y cuenta, sin escribir ni gastar Gemini
//   node scripts/sembrar_regulacion.mjs                  carga España con embeddings de Gemini
//   node scripts/sembrar_regulacion.mjs --simulado       embeddings simulados (solo para ensayar en LOCAL)
//   node scripts/sembrar_regulacion.mjs --pais=es        carpeta semilla/regulacion-es (por defecto)
//
// Necesita la migración 0011 aplicada. NO la cargues en la base compartida sin revisar el contenido:
// es información orientativa, no asesoramiento jurídico, y cada fuente debe revisarse contra el BOE.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validarLote } from '../lib/regulacion.mjs';

const DIMS = 768;

// Vector determinista a partir del texto (para ensayar en local sin Gemini): mismo texto, mismo vector.
export function vectorSimulado(texto) {
  const v = [];
  for (let i = 0; v.length < DIMS; i++) {
    const h = createHash('sha256').update(`${i}|${texto}`).digest();
    for (let k = 0; k + 1 < h.length && v.length < DIMS; k += 2) v.push(h.readUInt16BE(k) / 65535 - 0.5);
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function leerSemilla(carpeta) {
  if (!existsSync(carpeta)) throw new Error(`no existe ${carpeta}`);
  return readdirSync(carpeta).filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => JSON.parse(readFileSync(new URL(f, carpeta), 'utf8')));
}

// deps: { rpc, embedLote, aLiteral, log }
export async function sembrar({ requisitos, dry = false, soloValidar = false, deps }) {
  const { rpc, embedLote, aLiteral, log = console.log } = deps;
  const informe = { requisitos: requisitos.length, tests: requisitos.reduce((s, r) => s + (r.tests?.length ?? 0), 0),
    nuevos: 0, existentes: 0, asociaciones: 0, testsNuevos: 0 };

  // 1. validar contra lo que hay en la base (si se puede)
  let jurisdiccionesValidas = null, categoriasValidas = null, dominios = null;
  if (!soloValidar) {
    try {
      jurisdiccionesValidas = new Set((await rpc('jurisdicciones')).map((j) => j.code));
      const cats = await rpc('categorias');
      categoriasValidas = new Set(cats.map((c) => c.slug));
      dominios = new Set(cats.filter((c) => ['app_type', 'software_category'].includes(c.type ?? c.tipo)).map((c) => c.slug));
    } catch (e) {
      if (!dry) throw e;
      // dry-run contra una base sin la migración 0011: se valida solo el formato
      log(`  ! no se pudo consultar la base (${e.message.slice(0, 80)}): solo se valida el formato`);
      soloValidar = true;
    }
  }
  const errores = validarLote(requisitos, { jurisdiccionesValidas, categoriasValidas });
  // Lo regulatorio siempre pertenece a un tipo de app o categoría de software: sin él, la búsqueda lo
  // trata como genérico y aparece en proyectos que nada tienen que ver (pasó con 44 de Colombia).
  if (dominios?.size) for (const r of requisitos)
    if (!(r.categories ?? []).some((c) => dominios.has(c.slug)))
      errores.push(`${r.slug}: necesita un tipo de app o categoría de software (p. ej. online-gambling), no solo transversales`);
  if (errores.length) {
    errores.slice(0, 40).forEach((m) => log(`  ✗ ${m}`));
    throw new Error(`${errores.length} error(es) de validación en la semilla`);
  }
  log(`  ✓ ${informe.requisitos} requisitos y ${informe.tests} tests válidos`);
  if (soloValidar) return informe;

  // 2. qué falta
  const nuevos = [];
  for (const r of requisitos) (await rpc('requisito', { p_slug: r.slug }) ? informe.existentes++ : nuevos.push(r));
  informe.nuevos = nuevos.length;
  const testsPorCargar = [];
  for (const r of requisitos) for (const t of r.tests ?? []) if (!(await rpc('test', { p_slug: t.slug }))) testsPorCargar.push({ ...t, requisito: r.slug });
  informe.testsNuevos = testsPorCargar.length;
  informe.asociaciones = requisitos.reduce((s, r) => s + r.jurisdictions.length, 0);
  log(`  por cargar: ${nuevos.length} requisitos nuevos (${informe.existentes} ya estaban) · ${testsPorCargar.length} tests · ${informe.asociaciones} asociaciones a jurisdicciones`);
  if (dry) { log('  (dry-run: no se ha escrito nada)'); return informe; }

  // 3. requisitos nuevos (con embeddings), luego asociaciones de TODOS (idempotentes), luego tests
  if (nuevos.length) {
    const vecs = await embedLote(nuevos.map((r) => `${r.title}. ${r.statement}`));
    for (let i = 0; i < nuevos.length; i++) {
      const r = nuevos[i];
      await rpc('crear_requisito', { p_titulo: r.title, p_enunciado: r.statement, p_criterios: r.criteria, p_clase: r.kind,
        p_categorias: r.categories, p_vec: aLiteral(vecs[i]), p_autor: null, p_aporte_id: null, p_slug: r.slug });
    }
    log(`  ✓ ${nuevos.length} requisitos creados`);
  }
  for (const r of requisitos) for (const j of r.jurisdictions)
    await rpc('asociar_jurisdiccion', { p_slug: r.slug, p_jurisdiccion: j.code, p_matiz: j.note, p_fuente_norma: j.source.norm,
      p_fuente_url: j.source.url, p_fuente_fecha: j.source.date, p_en_vigor_desde: j.source.in_force_from ?? null });
  log(`  ✓ ${informe.asociaciones} asociaciones a jurisdicciones al día`);
  if (testsPorCargar.length) {
    const vecs = await embedLote(testsPorCargar.map((t) => `${t.title}. ${t.scenario}`));
    for (let i = 0; i < testsPorCargar.length; i++) {
      const t = testsPorCargar[i];
      await rpc('crear_test', { p_titulo: t.title, p_escenario: t.scenario, p_tipo: t.type, p_prioridad: t.priority,
        p_requisitos: [t.requisito], p_vec: aLiteral(vecs[i]), p_autor: null, p_slug: t.slug });
    }
    log(`  ✓ ${testsPorCargar.length} tests creados`);
  }
  return informe;
}

// ── línea de órdenes
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry'), SIMULADO = args.includes('--simulado');
  const pais = (args.find((a) => a.startsWith('--pais='))?.split('=')[1] ?? 'es').toLowerCase();
  if (!/^[a-z]{2}$/.test(pais)) { console.error('--pais=<código de 2 letras>'); process.exit(2); }

  await import('./gemini_env.mjs');
  const { exige } = await import('./entorno.mjs');
  const { rpc } = await import('../lib/bd.mjs');
  const gem = await import('../lib/gemini.mjs');
  const tieneBd = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY;
  if (!DRY || tieneBd) exige('SUPABASE_URL', 'SUPABASE_SECRET_KEY');
  if (!DRY && !SIMULADO) exige('GEMINI_API_KEY');
  if (SIMULADO && /supabase\.(co|com)/.test(process.env.SUPABASE_URL ?? '')) {
    console.error('\n  --simulado es solo para un Postgres local: con embeddings falsos se rompe la búsqueda por significado.\n');
    process.exit(1);
  }

  const carpeta = new URL(`../semilla/regulacion-${pais}/`, import.meta.url);
  console.log(`\n  semilla/regulacion-${pais}/`);
  const requisitos = leerSemilla(carpeta);
  const embedLote = SIMULADO ? async (ts) => ts.map(vectorSimulado) : gem.embedLote;
  try {
    await sembrar({ requisitos, dry: DRY, soloValidar: DRY && !tieneBd, deps: { rpc, embedLote, aLiteral: gem.aLiteral } });
  } catch (e) { console.error(`\n  ${e.message}\n`); process.exit(1); }
  console.log('');
}
