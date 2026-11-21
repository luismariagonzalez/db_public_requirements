#!/usr/bin/env node
// Relleno inicial de «de dónde salen las métricas» de los aceleradores ya cargados:
//   · repo_url  si su url es de github.com (https://github.com/<dueño>/<repo>)
//   · registro y paquete si su url es la ficha de un registro (npmjs.com/package/…, pypi.org/project/…,
//     crates.io/crates/…, nuget.org/packages/…, rubygems.org/gems/…, packagist.org/packages/…,
//     formulae.brew.sh/formula/…, pkg.go.dev/…, central.sonatype.com/artifact/…)
// Los que no se pueden deducir se listan en el informe (hay que fijarlos a mano o con srv_fijar_origen).
//
//   node scripts/rellenar_origen_metricas.mjs --dry              no escribe nada; informe
//   node scripts/rellenar_origen_metricas.mjs                    aplica (srv_fijar_origen), sin pisar lo ya fijado
//   node scripts/rellenar_origen_metricas.mjs --sobrescribir     también pisa lo ya fijado
//   node scripts/rellenar_origen_metricas.mjs --desde=lista.json [--dry]   lee [{slug, url}] de un fichero en vez de la base
//   node scripts/rellenar_origen_metricas.mjs --informe=informe.json       guarda el informe completo
//
// Con la base (sin --desde) necesita SUPABASE_URL y SUPABASE_SECRET_KEY: aplicar contra la base
// compartida es una decisión de quien despliega, no de los ensayos.

import './gemini_env.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { planificar } from '../lib/metricas/origen.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const tiene = (n) => process.argv.includes(`--${n}`);
const dry = tiene('dry');
const sobrescribir = tiene('sobrescribir');
const desde = arg('desde');

async function cargar() {
  if (desde) return JSON.parse(readFileSync(desde, 'utf8'));
  process.env.SUPABASE_SECRET_KEY ??= process.env.supabase_admin_secret_key;
  const { rpc } = await import('../lib/bd.mjs');
  const todos = [];
  for (let despues = 0; ;) {
    const lote = await rpc('aceleradores_origen', { p_despues_de: despues, p_limite: 200 });
    if (!lote.length) break;
    todos.push(...lote);
    despues = lote.at(-1).id;
  }
  return todos;
}

{
  const lista = await cargar();
  const plan = planificar(lista, { sobrescribir });
  console.log(`\n  ${lista.length} aceleradores · ${plan.fijar.length} por fijar · ${plan.yaFijados.length} ya al día · ${plan.sinDeducir.length} sin deducir`);
  const porTipo = {};
  for (const f of plan.fijar) {
    const k = f.registro ? `registro:${f.registro}` : 'repo:github';
    porTipo[k] = (porTipo[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(porTipo)) console.log(`    ${k.padEnd(20)} ${n}`);
  for (const f of plan.fijar.slice(0, 15)) console.log(`    + ${f.slug}: ${f.repo_url ?? ''} ${f.registro ? `${f.registro}:${f.paquete}` : ''}`);
  if (plan.fijar.length > 15) console.log(`    … y ${plan.fijar.length - 15} más`);
  if (plan.sinDeducir.length) {
    console.log('\n  Sin deducir (su URL no es de GitHub ni de un registro conocido):');
    for (const s of plan.sinDeducir) console.log(`    - ${s.slug}  ${s.url}`);
  }

  if (!dry && plan.fijar.length) {
    if (desde) { console.error('\n  --desde solo sirve con --dry (no hay base a la que escribir).\n'); process.exit(2); }
    const { rpc } = await import('../lib/bd.mjs');
    let ok = 0, mal = 0;
    for (const f of plan.fijar) {
      try { await rpc('fijar_origen', { p_slug: f.slug, p_repo_url: f.repo_url, p_registro: f.registro, p_paquete: f.paquete }); ok++; }
      catch (e) { mal++; console.log(`    ✗ ${f.slug}: ${e.message}`); }
    }
    console.log(`\n  Fijados ${ok}${mal ? `, ${mal} con error` : ''}.\n`);
  } else console.log(dry ? '\n  --dry: no se ha escrito nada.\n' : '\n');
  const informe = arg('informe');
  if (informe) writeFileSync(informe, JSON.stringify(plan, null, 2));
}
