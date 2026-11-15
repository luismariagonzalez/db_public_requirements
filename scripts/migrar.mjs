#!/usr/bin/env node
// Aplica supabase/migraciones/*.sql a la base compartida de la home.
//
//   npm run db:migrar          dice qué falta, no escribe
//   npm run db:migrar:aplicar  las aplica, cada una en su transacción
//
// Es una base con otros proyectos dentro: cada migración toca SU esquema y
// nada más. El registro vive en db_public_requirements.migracion_aplicada y guarda la huella
// del fichero, así que editar una migración ya aplicada se nota.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import './entorno.mjs';
import { exige } from './entorno.mjs';

const ESQUEMA = 'db_public_requirements';
const aplicar = process.argv.includes('--aplicar');

exige('SUPABASE_DB_URL');

const dir = new URL('../supabase/migraciones/', import.meta.url);
const ficheros = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  // El pooler presenta una cadena que no está en el almacén del sistema. Con
  // SUPABASE_CA se verifica de verdad; sin él va cifrado pero sin autenticar el
  // servidor, que vale desde tu máquina y no vale para nada desatendido.
  ssl: process.env.SUPABASE_CA
    ? { ca: readFileSync(process.env.SUPABASE_CA, 'utf8') }
    : { rejectUnauthorized: false },
});
await db.connect();
console.log('');

try {
  await db.query(`create schema if not exists ${ESQUEMA};
    create table if not exists ${ESQUEMA}.migracion_aplicada (
      fichero text primary key,
      huella  text not null,
      aplicada_en timestamptz not null default now()
    );
    alter table ${ESQUEMA}.migracion_aplicada enable row level security`);

  const { rows } = await db.query(`select fichero, huella from ${ESQUEMA}.migracion_aplicada`);
  const ya = new Map(rows.map((r) => [r.fichero, r.huella]));

  for (const f of ficheros) {
    const sql = readFileSync(new URL(f, dir), 'utf8');
    const huella = createHash('sha256').update(sql).digest('hex').slice(0, 12);

    if (ya.has(f)) {
      const igual = ya.get(f) === huella;
      console.log(`  ${igual ? '·' : '!'} ${f} ya aplicada${igual ? '' : ' — PERO EL FICHERO HA CAMBIADO desde entonces'}`);
      continue;
    }
    if (!aplicar) { console.log(`  → ${f} pendiente`); continue; }

    await db.query('begin');
    try {
      await db.query(sql);
      await db.query(
        `insert into ${ESQUEMA}.migracion_aplicada (fichero, huella) values ($1,$2)`,
        [f, huella]);
      await db.query('commit');
      console.log(`  ✓ ${f} aplicada`);
    } catch (e) {
      await db.query('rollback');
      console.error(`  ✗ ${f} falló y se ha deshecho entera:\n    ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!aplicar) console.log('\n  (nada escrito: añade --aplicar)');
  console.log('');
} finally {
  await db.end();
}
