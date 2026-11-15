// «Supabase falso» para los ensayos: un servidor HTTP que atiende
// /rest/v1/rpc/<función> y reenvía a un Postgres LOCAL como service_role, igual
// que haría PostgREST. Así se prueba la API real y los scripts sin tocar la base
// compartida. Nunca apunta a un Supabase de verdad.

import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import pg from 'pg';

export const CADENA = process.env.DATABASE_URL
  ?? 'postgres://db_public_requirements:db_public_requirements@127.0.0.1:5433/db_public_requirements';

export async function levantar() {
  if (/supabase\.(co|com)/.test(CADENA)) throw new Error('Solo contra un Postgres local.');
  const db = new pg.Client({ connectionString: CADENA });
  await db.connect();
  await db.query('set role service_role');

  const cache = new Map();
  async function firma(fn) {
    if (!cache.has(fn)) {
      const { rows } = await db.query(
        `select a.n as nombre, t::regtype::text as tipo
           from pg_proc p
           join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
           cross join lateral unnest(p.proargnames) with ordinality a(n, i)
           cross join lateral unnest(p.proargtypes::oid[]) with ordinality b(t, j)
          where p.proname = $1 and a.i = b.j order by a.i`, [fn]);
      const { rows: [r] } = await db.query(
        `select p.prorettype::regtype::text as ret from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
          where ns.nspname = 'public' and p.proname = $1`, [fn]);
      cache.set(fn, { args: rows, ret: r?.ret });
    }
    return cache.get(fn);
  }

  const servidor = createServer(async (req, res) => {
    const fn = req.url.split('/rpc/')[1];
    let cuerpo = '';
    for await (const t of req) cuerpo += t;
    try {
      assert.match(fn ?? '', /^db_public_requirements_srv_[a-z_]+$/);
      const args = JSON.parse(cuerpo || '{}');
      const f = await firma(fn);
      const usados = f.args.filter((a) => a.nombre in args);
      const params = usados.map((a) => (/json/.test(a.tipo) ? JSON.stringify(args[a.nombre]) : args[a.nombre]));
      const llamada = `public.${fn}(${usados.map((a, i) => `${a.nombre} => $${i + 1}::${a.tipo}`).join(', ')})`;
      if (f.ret === 'void') { await db.query(`select ${llamada}`, params); res.writeHead(204).end(); return; }
      const { rows: [fila] } = await db.query(`select to_jsonb(${llamada}) as r`, params);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fila.r));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ message: e.message }));
    }
  }).listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));

  process.env.SUPABASE_URL = `http://127.0.0.1:${servidor.address().port}`;
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_falsa_de_ensayo';
  return { db, cerrar: async () => { servidor.close(); await db.end(); } };
}
