#!/usr/bin/env node
// Ensaya las migraciones en un Postgres LOCAL y comprueba el contrato de la
// base compartida (AGENTS.md § La base de datos). Lo corre también el CI.
//
//   npm run db:up        levanta el Postgres local (docker compose)
//   npm run db:ensayar   aplica supabase/migraciones/*.sql y comprueba
//
// Qué comprueba, además de que las migraciones apliquen:
//   · ninguna tabla en public
//   · RLS activo en todas las tablas del esquema
//   · anon y authenticated no pueden tocar ninguna tabla ni usar el esquema
//   · toda función public.db_public_requirements_* es security definer, fija search_path y
//     NO se puede ejecutar por PUBLIC (el agujero por defecto de Postgres)
//   · supabase/ensayo.sql, si existe: tus pruebas, dentro de una transacción
//     que se deshace al final
//
// Nunca contra la base compartida: se planta si la cadena huele a Supabase.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import pg from 'pg';

const ESQUEMA = 'db_public_requirements';
const CADENA = process.env.DATABASE_URL
  ?? 'postgres://db_public_requirements:db_public_requirements@127.0.0.1:5433/db_public_requirements';

if (/supabase\.(co|com)/.test(CADENA)) {
  console.error('\n  Eso es la base compartida. El ensayo es solo para un Postgres local.\n');
  process.exit(1);
}

const db = new pg.Client({ connectionString: CADENA });
await db.connect();
const fallos = [];
const mal = (msg) => { fallos.push(msg); console.log(`  ✗ ${msg}`); };
const bien = (msg) => console.log(`  ✓ ${msg}`);
console.log('');

try {
  // Un Supabase de verdad tiene auth.users. Si está, no es nuestro Postgres.
  const { rows: [real] } = await db.query(
    `select to_regclass('auth.users') is not null as hay`);
  if (real.hay) throw new Error('Esta base tiene auth.users: parece un Supabase de verdad. No sigo.');

  // ── 1. lo que Supabase da por hecho: roles y auth.jwt()
  for (const rol of ['anon', 'authenticated', 'service_role'])
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${rol}') then
        create role ${rol} nologin;
      end if; end $$`);
  await db.query(`create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated`);

  // ── 2. limpio: el esquema y las funciones públicas de un ensayo anterior
  await db.query(`drop schema if exists ${ESQUEMA} cascade`);
  await db.query(`do $l$ declare f record; begin
    for f in select p.oid::regprocedure as firma from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and starts_with(p.proname, '${ESQUEMA}_')
    loop execute 'drop function ' || f.firma; end loop; end $l$`);

  // ── 3. las migraciones, cada una en su transacción
  const dir = new URL('../supabase/migraciones/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.query('begin');
    try {
      await db.query(readFileSync(new URL(f, dir), 'utf8'));
      await db.query('commit');
      bien(`aplicada ${f}`);
    } catch (e) {
      await db.query('rollback');
      throw new Error(`${f} no aplica: ${e.message}`);
    }
  }

  // ── 4. el contrato
  const { rows: enPublic } = await db.query(
    `select tablename from pg_tables where schemaname = 'public'`);
  enPublic.length ? mal(`tablas en public: ${enPublic.map((t) => t.tablename).join(', ')}`)
                  : bien('ninguna tabla en public');

  const { rows: tablas } = await db.query(
    `select c.relname as tabla, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p')`, [ESQUEMA]);
  const sinRls = tablas.filter((t) => !t.rls).map((t) => t.tabla);
  sinRls.length ? mal(`tablas sin RLS: ${sinRls.join(', ')}`)
                : bien(`RLS activo en las ${tablas.length} tablas`);

  const { rows: accesos } = await db.query(
    `select r.rol, c.relname as tabla, p.priv
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join (values ('anon'), ('authenticated')) r(rol)
       cross join (values ('select'), ('insert'), ('update'), ('delete')) p(priv)
      where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege(r.rol, c.oid, p.priv)`, [ESQUEMA]);
  accesos.length
    ? mal(`acceso directo a tablas: ${accesos.map((a) => `${a.rol} ${a.priv} ${a.tabla}`).join('; ')}`)
    : bien('anon y authenticated no tocan ninguna tabla');

  const { rows: [usoEsquema] } = await db.query(
    `select has_schema_privilege('anon', $1, 'usage')
         or has_schema_privilege('authenticated', $1, 'usage') as puede`, [ESQUEMA]);
  usoEsquema.puede ? mal(`anon o authenticated pueden usar el esquema ${ESQUEMA}`)
                   : bien('el esquema está cerrado a anon y authenticated');

  const { rows: funciones } = await db.query(
    `select p.oid::regprocedure::text as firma, p.prosecdef as definer,
            coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as ruta,
            p.proacl is null
              or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publica
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and starts_with(p.proname, $1)`, [`${ESQUEMA}_`]);
  if (!funciones.length) mal(`no hay ninguna función public.${ESQUEMA}_*`);
  for (const f of funciones) {
    if (!f.definer) mal(`${f.firma} no es security definer`);
    if (!f.ruta) mal(`${f.firma} no fija search_path`);
    if (f.publica) mal(`${f.firma} la puede ejecutar PUBLIC: falta «revoke all … from public»`);
  }
  if (funciones.length && funciones.every((f) => f.definer && f.ruta && !f.publica))
    bien(`${funciones.length} funciones públicas, todas con la forma correcta`);

  // ── 5. las pruebas del proyecto, sin dejar rastro
  const ensayo = new URL('../supabase/ensayo.sql', import.meta.url);
  if (existsSync(ensayo)) {
    await db.query('begin');
    try {
      await db.query(readFileSync(ensayo, 'utf8'));
      bien('supabase/ensayo.sql pasa');
    } catch (e) {
      mal(`supabase/ensayo.sql: ${e.message}`);
    } finally {
      await db.query('rollback');
    }
  }
} catch (e) {
  mal(e.message);
} finally {
  await db.end();
}

console.log(fallos.length ? `\n  ${fallos.length} fallo(s). No se aplica nada a la base compartida.\n`
                          : '\n  Ensayo limpio.\n');
process.exitCode = fallos.length ? 1 : 0;
