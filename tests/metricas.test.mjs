// Métricas de aceleradores: deducción del origen, clientes de cada fuente (con fetch
// simulado: JAMÁS se toca la red), proceso por lotes, ruta del cron y formato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deducirOrigen, repoGithub, paqueteValido, planificar } from '../lib/metricas/origen.mjs';
import { crearContexto, consultarGithub, consultarRegistro, consultarAcelerador, pedir, ErrorMetrica, userAgent } from '../lib/metricas/cliente.mjs';
import { refrescarLote } from '../lib/metricas/proceso.mjs';
import * as cron from '../lib/handlers/cron.mjs';
import { abreviar, textoCompacto, piezasMetricas, metricasDe } from '../web/metricas.js';
import { renderMarkdown } from '../lib/markdown.mjs';
import { parseFiltrosAceleradores } from '../lib/filtros.mjs';
import { buscarAceleradores } from '../lib/busqueda.mjs';
import { popularidad } from '../cli/reqdb.mjs';
import { resolver } from '../lib/router.mjs';
import { rutas } from '../lib/rutas.mjs';
import en from '../web/textos-en.js';
import es from '../web/textos-es.js';

// ── fetch simulado
const resp = (cuerpo, { estado = 200, cab = {} } = {}) => ({
  status: estado, ok: estado >= 200 && estado < 300,
  headers: { get: (k) => cab[k.toLowerCase()] ?? null },
  json: async () => { if (cuerpo === undefined) throw new Error('sin json'); return cuerpo; },
});
// rutas: { 'substring de la URL': respuesta | [respuestas en orden] | función(url, init) }
function fetchFalso(tabla) {
  const llamadas = [];
  const fn = async (url, init) => {
    llamadas.push({ url, init });
    const k = Object.keys(tabla).find((x) => url.includes(x));
    if (!k) throw new Error(`url inesperada en la prueba: ${url}`);
    let r = tabla[k];
    if (Array.isArray(r)) r = r.length > 1 ? r.shift() : r[0];
    if (typeof r === 'function') return r(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  fn.llamadas = llamadas;
  return fn;
}
const ctxDe = (tabla, extra = {}) => {
  const f = fetchFalso(tabla);
  const esperas = [];
  const ctx = crearContexto({ fetchFn: f, dormir: async (ms) => { esperas.push(ms); }, ahora: () => 1_000_000, env: {}, ...extra });
  return { ctx, f, esperas };
};

// ── origen
test('deducirOrigen: GitHub y registros', () => {
  assert.deepEqual(deducirOrigen('https://github.com/lucia-auth/lucia'), { repo_url: 'https://github.com/lucia-auth/lucia', registro: null, paquete: null });
  assert.equal(deducirOrigen('https://github.com/vercel/next.js/tree/canary/packages').repo_url, 'https://github.com/vercel/next.js');
  assert.equal(deducirOrigen('https://github.com/foo/bar.git').repo_url, 'https://github.com/foo/bar');
  assert.equal(deducirOrigen('https://github.com/sponsors/foo').repo_url, null);
  assert.equal(deducirOrigen('https://github.com/solo-dueño').repo_url, null);
  assert.deepEqual(deducirOrigen('https://www.npmjs.com/package/react'), { repo_url: null, registro: 'npm', paquete: 'react' });
  assert.equal(deducirOrigen('https://www.npmjs.com/package/@clerk/clerk-js').paquete, '@clerk/clerk-js');
  assert.deepEqual(deducirOrigen('https://pypi.org/project/pandas/'), { repo_url: null, registro: 'pypi', paquete: 'pandas' });
  assert.equal(deducirOrigen('https://crates.io/crates/serde').registro, 'crates');
  assert.equal(deducirOrigen('https://www.nuget.org/packages/Newtonsoft.Json/13.0.1').paquete, 'Newtonsoft.Json');
  assert.equal(deducirOrigen('https://rubygems.org/gems/rails').registro, 'rubygems');
  assert.equal(deducirOrigen('https://packagist.org/packages/laravel/framework').paquete, 'laravel/framework');
  assert.equal(deducirOrigen('https://formulae.brew.sh/formula/wget').registro, 'homebrew');
  assert.deepEqual(deducirOrigen('https://pkg.go.dev/github.com/gin-gonic/gin'), { repo_url: null, registro: 'go', paquete: 'github.com/gin-gonic/gin' });
  assert.deepEqual(deducirOrigen('https://central.sonatype.com/artifact/org.apache.commons/commons-lang3'), { repo_url: null, registro: 'maven', paquete: 'org.apache.commons:commons-lang3' });
});

test('deducirOrigen: lo que no se puede deducir y entradas hostiles', () => {
  for (const u of ['https://example.com/lucia', 'http://github.com/a/b', 'no es una url', 'https://pypi.org/project/', 'https://pypi.org/project/bad name!',
    'https://npmjs.com/package/UPPER CASE', 'https://crates.io/crates/1abc', 'javascript:alert(1)'])
    assert.deepEqual(deducirOrigen(u), { repo_url: null, registro: null, paquete: null }, u);
  assert.equal(repoGithub('https://evil.com/github.com/a/b'), null);
  assert.equal(repoGithub('https://github.com.evil.com/a/b'), null);
});

test('paqueteValido: formatos por registro', () => {
  assert.ok(paqueteValido('npm', '@scope/pkg')); assert.ok(!paqueteValido('npm', '@scope')); assert.ok(!paqueteValido('npm', 'a b'));
  assert.ok(paqueteValido('pypi', 'my-pkg_2')); assert.ok(!paqueteValido('pypi', '-bad'));
  assert.ok(paqueteValido('packagist', 'laravel/framework')); assert.ok(!paqueteValido('packagist', 'sin-barra'));
  assert.ok(paqueteValido('maven', 'g.a:art')); assert.ok(!paqueteValido('maven', 'sin-dos-puntos'));
  assert.ok(!paqueteValido('cobol', 'x')); assert.ok(!paqueteValido('npm', 5));
});

test('planificar: fija lo deducible, no pisa lo existente y lista lo demás', () => {
  const p = planificar([
    { slug: 'a', url: 'https://github.com/o/a' },
    { slug: 'b', url: 'https://www.npmjs.com/package/b', repo_url: 'https://github.com/o/b' },
    { slug: 'c', url: 'https://example.com/c' },
    { slug: 'd', url: 'https://github.com/o/d', repo_url: 'https://github.com/o/d' },
    { slug: 'e', url: 'https://github.com/o/nuevo', repo_url: 'https://github.com/o/viejo' },
  ]);
  assert.deepEqual(p.fijar.map((x) => x.slug), ['a', 'b']);
  assert.equal(p.fijar[1].repo_url, 'https://github.com/o/b');   // conserva el repo y añade el paquete
  assert.deepEqual(p.sinDeducir.map((x) => x.slug), ['c']);
  assert.deepEqual(p.yaFijados, ['d', 'e']);
  assert.equal(planificar([{ slug: 'e', url: 'https://github.com/o/nuevo', repo_url: 'https://github.com/o/viejo' }], { sobrescribir: true }).fijar[0].repo_url,
    'https://github.com/o/nuevo');
});

// ── clientes
test('User-Agent: genérico por defecto, configurable y sin saltos de línea', () => {
  assert.equal(userAgent({}), 'reqdb-metrics/1.0');
  assert.equal(userAgent({ METRICAS_USER_AGENT: 'x/1 (+https://a.b)\r\nInjected: 1' }), 'x/1 (+https://a.b)  Injected: 1');
});

test('GitHub: estrellas, forks, archivado y último push; cabeceras y token', async () => {
  const { ctx, f } = ctxDe({ 'api.github.com/repos/o/r': resp({ stargazers_count: 1234, forks_count: 56, archived: true, pushed_at: '2026-11-01T00:00:00Z' }) },
    { token: 'ghp_secreto' });
  const d = await consultarGithub(ctx, 'https://github.com/o/r');
  assert.deepEqual(d, { stars: 1234, forks: 56, archived: true, last_commit: '2026-11-01T00:00:00Z' });
  const h = f.llamadas[0].init.headers;
  assert.equal(h.authorization, 'Bearer ghp_secreto');
  assert.equal(h['user-agent'], 'reqdb-metrics/1.0');
  assert.match(h.accept, /github\+json/);
  assert.ok(h['x-github-api-version']);
});

test('GitHub: sin token no manda Authorization; 404 y respuesta rara dan error', async () => {
  const a = ctxDe({ 'api.github.com': resp({ stargazers_count: 1, forks_count: 0, archived: false, pushed_at: null }) });
  await consultarGithub(a.ctx, 'https://github.com/o/r');
  assert.equal(a.f.llamadas[0].init.headers.authorization, undefined);
  await assert.rejects(consultarGithub(ctxDe({ 'api.github.com': resp({ message: 'Not Found' }, { estado: 404 }) }).ctx, 'https://github.com/o/r'), /not found/);
  await assert.rejects(consultarGithub(ctxDe({ 'api.github.com': resp({ nada: 1 }) }).ctx, 'https://github.com/o/r'), /unexpected/);
  await assert.rejects(consultarGithub(ctxDe({}).ctx, 'https://example.com/o/r'), /not a github/);
});

test('GitHub: cupo agotado = ErrorMetrica con limite, sin reintentos', async () => {
  const { ctx, f } = ctxDe({ 'api.github.com': resp({}, { estado: 403, cab: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' } }) });
  await assert.rejects(consultarGithub(ctx, 'https://github.com/o/r'), (e) => e instanceof ErrorMetrica && e.limite && e.hastaMs === 1700000000_000);
  assert.equal(f.llamadas.length, 1);
});

test('reintentos con retroceso: 5xx y fallos de red se repiten; 404 no', async () => {
  const { ctx, f, esperas } = ctxDe({ 'registry.test': [resp({}, { estado: 503 }), new Error('ECONNRESET'), resp({ ok: 1 })] });
  const r = await pedir(ctx, 'https://registry.test/x');
  assert.equal(r.status, 200);
  assert.equal(f.llamadas.length, 3);
  assert.deepEqual(esperas, [400, 800]);   // retroceso exponencial
  const solo404 = ctxDe({ 'registry.test': resp({}, { estado: 404 }) });
  assert.equal((await pedir(solo404.ctx, 'https://registry.test/x')).status, 404);
  assert.equal(solo404.f.llamadas.length, 1);
  const siempre = ctxDe({ 'registry.test': resp({}, { estado: 500 }) }, { reintentos: 2 });
  await assert.rejects(pedir(siempre.ctx, 'https://registry.test/x'), /answered 500/);
  assert.equal(siempre.f.llamadas.length, 3);
});

test('429 con Retry-After corto se espera; largo, no', async () => {
  const corto = ctxDe({ 'r.test': [resp({}, { estado: 429, cab: { 'retry-after': '2' } }), resp({ ok: 1 })] });
  assert.equal((await pedir(corto.ctx, 'https://r.test/x')).status, 200);
  assert.deepEqual(corto.esperas, [2000]);
  const largo = ctxDe({ 'r.test': resp({}, { estado: 429, cab: { 'retry-after': '600' } }) });
  await assert.rejects(pedir(largo.ctx, 'https://r.test/x'), (e) => e.limite === true);
  assert.equal(largo.f.llamadas.length, 1);
});

test('crates.io se espacia a 1 petición por segundo', async () => {
  let t = 1_000_000;
  const esperas = [];
  const f = fetchFalso({ 'crates.io/api/v1/crates/serde/downloads': resp({ version_downloads: [], meta: { extra_downloads: [] } }),
    'crates.io/api/v1/crates/serde': resp({ crate: { downloads: 10 } }) });
  const ctx = crearContexto({ fetchFn: f, dormir: async (ms) => { esperas.push(ms); t += ms; }, ahora: () => t, env: {} });
  await consultarRegistro(ctx, 'crates', 'serde');
  assert.equal(esperas.length, 1);
  assert.ok(esperas[0] >= 1000);
});

test('registros: npm, PyPI, crates, NuGet, RubyGems, Packagist y Homebrew', async () => {
  const t = {
    'api.npmjs.org/downloads/point/last-month/@scope/pkg': resp({ downloads: 111, package: '@scope/pkg' }),
    'pypistats.org/api/packages/pandas/recent': resp({ data: { last_day: 1, last_week: 7, last_month: 712925236 }, package: 'pandas' }),
    'crates.io/api/v1/crates/serde/downloads': resp({
      version_downloads: [{ version: 1, downloads: 100, date: '2026-10-01' }, { version: 1, downloads: 10, date: '2026-11-10' }, { version: 2, downloads: 5, date: '2026-11-20' }],
      meta: { extra_downloads: [{ date: '2026-11-15', downloads: 1 }] } }),
    'crates.io/api/v1/crates/serde': resp({ crate: { downloads: 1747241422, recent_downloads: 4 } }),
    'azuresearch-usnc.nuget.org/query': resp({ data: [{ id: 'Newtonsoft.Json', totalDownloads: 9902209653 }] }),
    'rubygems.org/api/v1/gems/rails.json': resp({ name: 'rails', downloads: 819839720 }),
    'packagist.org/packages/laravel/framework.json': resp({ package: { downloads: { total: 628030483, monthly: 26747511, daily: 1 } } }),
    'formulae.brew.sh/api/formula/wget.json': resp({ analytics: { install: { '30d': { wget: 29212, 'wget --HEAD': 51 } } } }),
  };
  const { ctx } = ctxDe(t);
  assert.deepEqual(await consultarRegistro(ctx, 'npm', '@scope/pkg'), { downloads_month: 111 });
  assert.deepEqual(await consultarRegistro(ctx, 'pypi', 'Pandas'), { downloads_month: 712925236 });
  // crates: se suman los últimos 30 días respecto a la fecha más reciente (10 + 5 + 1; el de octubre queda fuera)
  assert.deepEqual(await consultarRegistro(ctx, 'crates', 'serde'), { downloads_total: 1747241422, downloads_month: 16 });
  assert.deepEqual(await consultarRegistro(ctx, 'nuget', 'newtonsoft.json'), { downloads_total: 9902209653 });
  assert.deepEqual(await consultarRegistro(ctx, 'rubygems', 'rails'), { downloads_total: 819839720 });
  assert.deepEqual(await consultarRegistro(ctx, 'packagist', 'laravel/framework'), { downloads_month: 26747511, downloads_total: 628030483 });
  assert.deepEqual(await consultarRegistro(ctx, 'homebrew', 'wget'), { downloads_month: 29212 });
});

test('registros: errores (no existe, respuesta rara, sin fuente, nombre inválido)', async () => {
  const { ctx } = ctxDe({ 'api.npmjs.org': resp({ error: 'package x not found' }, { estado: 404 }),
    'pypistats.org': resp({ data: {} }), 'azuresearch': resp({ data: [] }) });
  await assert.rejects(consultarRegistro(ctx, 'npm', 'x'), /not found/);
  await assert.rejects(consultarRegistro(ctx, 'pypi', 'x'), /unexpected/);
  await assert.rejects(consultarRegistro(ctx, 'nuget', 'x'), /not found/);
  await assert.rejects(consultarRegistro(ctx, 'maven', 'g:a'), /no public downloads source/);
  await assert.rejects(consultarRegistro(ctx, 'npm', 'a b'), /invalid package name/);
});

test('crates: si falla el mensual, se guarda el total', async () => {
  const { ctx } = ctxDe({ 'crates.io/api/v1/crates/serde/downloads': resp({}, { estado: 404 }), 'crates.io/api/v1/crates/serde': resp({ crate: { downloads: 7 } }) });
  assert.deepEqual(await consultarRegistro(ctx, 'crates', 'serde'), { downloads_total: 7 });
});

test('consultarAcelerador: GitHub y registro juntos; fallo parcial guarda lo que llegó', async () => {
  const ok = ctxDe({ 'api.github.com': resp({ stargazers_count: 5, forks_count: 1, archived: false, pushed_at: '2026-01-01T00:00:00Z' }),
    'api.npmjs.org': resp({ downloads: 99 }) });
  const r = await consultarAcelerador(ok.ctx, { repo_url: 'https://github.com/o/r', registry: 'npm', package: 'pkg' });
  assert.deepEqual(r.datos, { stars: 5, forks: 1, archived: false, last_commit: '2026-01-01T00:00:00Z', downloads_month: 99, source: 'github+npm', error: null });
  assert.equal(r.limitado, false);

  const parcial = ctxDe({ 'api.github.com': resp({ stargazers_count: 5, forks_count: 1, archived: false, pushed_at: null }),
    'api.npmjs.org': resp({}, { estado: 404 }) });
  const p = await consultarAcelerador(parcial.ctx, { repo_url: 'https://github.com/o/r', registry: 'npm', package: 'pkg' });
  assert.equal(p.datos.stars, 5);
  assert.equal(p.datos.source, 'github');
  assert.match(p.datos.error, /npm pkg: not found/);
  assert.ok(!('last_commit' in p.datos));   // null no se envía: no pisa un valor anterior
});

test('consultarAcelerador: cupo agotado = limitado (no se marca el intento) y se deja en paz a esa fuente', async () => {
  const lim = ctxDe({ 'api.github.com': resp({}, { estado: 403, cab: { 'x-ratelimit-remaining': '0' } }) });
  const frenados = new Set();
  const a = await consultarAcelerador(lim.ctx, { repo_url: 'https://github.com/o/r', registry: null, package: null }, { frenados });
  assert.equal(a.limitado, true);
  const antes = lim.f.llamadas.length;
  const b = await consultarAcelerador(lim.ctx, { repo_url: 'https://github.com/o/s', registry: null, package: null }, { frenados });
  assert.equal(b.limitado, true);
  assert.equal(lim.f.llamadas.length, antes);   // ni una petición más a GitHub
});

test('consultarAcelerador: sin nada que consultar / registro sin fuente → error anotado', async () => {
  const { ctx } = ctxDe({});
  assert.match((await consultarAcelerador(ctx, { repo_url: null, registry: 'maven', package: 'g:a' })).datos.error, /no public downloads source/);
  assert.match((await consultarAcelerador(ctx, { repo_url: null, registry: null, package: null })).datos.error, /nothing to query/);
});

// ── proceso por lotes
function baseFalsa(aceleradores) {
  const guardados = [];
  const intentados = new Map();
  const rpc = async (verbo, args) => {
    if (verbo === 'metricas_pendientes') {
      const umbral = new Date(args.p_antes_de).getTime();
      return aceleradores.filter((a) => !intentados.has(a.slug) || intentados.get(a.slug) < umbral)
        .sort((a, b) => (intentados.get(a.slug) ?? -1) - (intentados.get(b.slug) ?? -1)).slice(0, args.p_limite);
    }
    if (verbo === 'guardar_metricas') { guardados.push({ slug: args.p_slug, datos: args.p_datos }); intentados.set(args.p_slug, Date.now() + guardados.length); return { saved: true }; }
    if (verbo === 'metricas_resumen') {
      const umbral = new Date(args.p_antes_de).getTime();
      return { pending: aceleradores.filter((a) => !intentados.has(a.slug) || intentados.get(a.slug) < umbral).length };
    }
    throw new Error(`rpc inesperada ${verbo}`);
  };
  return { rpc, guardados };
}
const acel = (n) => Array.from({ length: n }, (_, i) => ({ slug: `a${i}`, repo_url: `https://github.com/o/r${i}`, registry: null, package: null }));
const ghOk = { 'api.github.com': resp({ stargazers_count: 3, forks_count: 1, archived: false, pushed_at: '2026-01-01T00:00:00Z' }) };

test('proceso: reanudable por lotes (la segunda pasada sigue donde se quedó)', async () => {
  const { rpc, guardados } = baseFalsa(acel(5));
  const { ctx } = ctxDe(ghOk);
  const r1 = await refrescarLote({ limite: 2, deps: { rpc, ctx } });
  assert.equal(r1.processed, 2); assert.equal(r1.saved, 2); assert.equal(r1.pending_after, 3);
  const r2 = await refrescarLote({ limite: 2, deps: { rpc, ctx } });
  const r3 = await refrescarLote({ limite: 2, deps: { rpc, ctx } });
  assert.deepEqual(guardados.map((g) => g.slug), ['a0', 'a1', 'a2', 'a3', 'a4']);
  assert.equal(r3.pending_after, 0);
  assert.equal((await refrescarLote({ limite: 2, deps: { rpc, ctx } })).processed, 0);   // nada que hacer hasta dentro de 14 días
  assert.equal(r2.stopped_by, null);
});

test('proceso: tope de tiempo', async () => {
  const { rpc, guardados } = baseFalsa(acel(5));
  let t = 0;
  const { ctx } = ctxDe(ghOk);
  const r = await refrescarLote({ limite: 5, presupuestoMs: 1000, deps: { rpc, ctx, ahora: () => (t += 400) } });
  assert.equal(r.stopped_by, 'time');
  assert.ok(r.processed < 5 && r.processed === guardados.length);
  assert.ok(r.pending_after > 0);
});

test('proceso: un error de una fuente se guarda y el lote sigue', async () => {
  const lista = acel(3);
  const { rpc, guardados } = baseFalsa(lista);
  const { ctx } = ctxDe({ 'api.github.com/repos/o/r1': resp({}, { estado: 404 }), 'api.github.com': resp({ stargazers_count: 9, forks_count: 0, archived: false, pushed_at: null }) });
  const r = await refrescarLote({ limite: 10, deps: { rpc, ctx } });
  assert.equal(r.saved, 3); assert.equal(r.with_error, 1);
  assert.match(guardados.find((g) => g.slug === 'a1').datos.error, /not found/);
  assert.equal(guardados.find((g) => g.slug === 'a2').datos.stars, 9);
});

test('proceso: cupo de GitHub agotado → se para sin marcar los no intentados', async () => {
  const { rpc, guardados } = baseFalsa(acel(4));
  let n = 0;
  const { ctx, f } = ctxDe({ 'api.github.com': () => (++n <= 1 ? resp({ stargazers_count: 1, forks_count: 0, archived: false, pushed_at: null })
    : resp({}, { estado: 403, cab: { 'x-ratelimit-remaining': '0' } })) });
  const r = await refrescarLote({ limite: 10, deps: { rpc, ctx } });
  assert.equal(r.saved, 1);
  assert.equal(r.skipped_rate_limited, 3);
  assert.equal(r.stopped_by, 'rate_limit');
  assert.deepEqual(r.rate_limited_sources, ['github']);
  assert.equal(guardados.length, 1);
  assert.equal(f.llamadas.length, 2);   // tras el 403, ninguna petición más
  assert.equal(r.pending_after, 3);     // siguen pendientes: la próxima pasada los coge
});

test('proceso: forzar ignora la antigüedad y se detiene al recorrerlos una vez', async () => {
  const { rpc } = baseFalsa(acel(2));
  const { ctx } = ctxDe(ghOk);
  await refrescarLote({ limite: 10, deps: { rpc, ctx } });
  const r = await refrescarLote({ limite: 10, forzar: true, deps: { rpc, ctx, ahora: () => Date.now() + 5 } });
  assert.equal(r.processed, 2);
});

test('proceso: un fallo al guardar no tira el lote', async () => {
  const { ctx } = ctxDe(ghOk);
  const rpc = async (v, a) => {
    if (v === 'metricas_pendientes') return acel(2);
    if (v === 'guardar_metricas') { if (a.p_slug === 'a0') throw new Error('db caída'); return {}; }
    return { pending: 0 };
  };
  const r = await refrescarLote({ deps: { rpc, ctx } });
  assert.equal(r.processed, 2); assert.equal(r.saved, 1); assert.equal(r.with_error, 1);
});

// ── ruta del cron
function llamarCron(cabeceras, query = {}) {
  const res = { cab: {}, setHeader(k, v) { this.cab[k] = v; }, end(c) { this.cuerpo = c; } };
  return cron.metricas({ headers: cabeceras, query }, res).then(() => ({ estado: res.statusCode, json: JSON.parse(res.cuerpo), cab: res.cab }));
}

test('cron: protegido con CRON_SECRET (Authorization: Bearer)', async (t) => {
  const prev = process.env.CRON_SECRET;
  t.after(() => { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; });
  const original = cron.dependencias.refrescarLote;
  t.after(() => { cron.dependencias.refrescarLote = original; });
  let args = null;
  cron.dependencias.refrescarLote = async (a) => { args = a; return { processed: 1, saved: 1, pending_after: 0 }; };

  delete process.env.CRON_SECRET;
  assert.equal((await llamarCron({ authorization: 'Bearer x' })).estado, 503);          // sin secreto: cerrada
  process.env.CRON_SECRET = 'corto';
  assert.equal((await llamarCron({ authorization: 'Bearer corto' })).estado, 503);      // secreto flojo: cerrada
  process.env.CRON_SECRET = 'un-secreto-de-prueba-largo';
  assert.equal((await llamarCron({})).estado, 401);
  assert.equal((await llamarCron({ authorization: 'Bearer otro' })).estado, 401);
  assert.equal((await llamarCron({ authorization: 'un-secreto-de-prueba-largo' })).estado, 401);   // sin «Bearer»
  assert.equal(args, null);                                                              // nada se ejecutó sin permiso
  const ok = await llamarCron({ authorization: 'Bearer un-secreto-de-prueba-largo' }, { limit: '7' });
  assert.equal(ok.estado, 200); assert.equal(ok.json.ok, true); assert.equal(args.limite, 7); assert.equal(args.presupuestoMs, 22_000);
  assert.equal(ok.cab['cache-control'], 'no-store');
  await llamarCron({ authorization: 'Bearer un-secreto-de-prueba-largo' }, { limit: '9999' });
  assert.equal(args.limite, 25);
  cron.dependencias.refrescarLote = async () => { throw new Error('boom'); };
  assert.equal((await llamarCron({ authorization: 'Bearer un-secreto-de-prueba-largo' })).estado, 502);
});

test('cron: la ruta existe para GET y POST; vercel.json la programa', async () => {
  assert.equal(resolver(rutas, 'GET', '/api/cron/metricas').estado, 200);
  assert.equal(resolver(rutas, 'POST', '/api/cron/metricas').estado, 200);
  assert.equal(resolver(rutas, 'DELETE', '/api/cron/metricas').estado, 405);
  const { readFileSync } = await import('node:fs');
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(v.crons[0].path, '/api/cron/metricas');
  // Hobby: como mucho una vez al día (campos de minuto y hora fijos, sin listas ni pasos)
  assert.match(v.crons[0].schedule, /^\d+ \d+ \* \* \*$/);
});

// ── formato
test('abreviar: 1,2 k / 3,4 M con Intl', () => {
  assert.equal(abreviar(950, 'en'), '950');
  assert.equal(abreviar(1234, 'es-ES'), '1,2 k');
  assert.equal(abreviar(1234, 'en-GB'), '1.2 k');
  assert.equal(abreviar(3_400_000, 'es-ES'), '3,4 M');
  assert.equal(abreviar(1000, 'en'), '1 k');
  assert.equal(abreviar(999_950, 'en'), '1 M');
  assert.equal(abreviar(19_300_000_000, 'en'), '19.3 G');
  assert.equal(abreviar(1234, 'en', { sinEspacio: true }), '1.2k');
  assert.equal(abreviar(-1), ''); assert.equal(abreviar(NaN), '');
});

test('textoCompacto y metricasDe', () => {
  assert.equal(textoCompacto({}), '');
  assert.equal(textoCompacto({ stars: null, downloads_month: null }), '');
  assert.equal(textoCompacto({ stars: 12345, downloads_month: 1_200_000, registry: 'npm' }), '12.3k stars · 1.2M downloads/mo');
  assert.equal(textoCompacto({ stars: 0, downloads_total: 9_900_000_000, registry: 'nuget' }), '0 stars · 9.9G downloads total');
  assert.equal(textoCompacto({ downloads_month: 29212, registry: 'homebrew', archived: true }), '29.2k installs/mo · archived');
  assert.equal(metricasDe({ stars: 'mil' }), null);
});

test('piezasMetricas: textos EN/ES con la fecha de actualización en el título', () => {
  const T = (dic) => (k, v = {}) => (dic[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));
  const fecha = (d) => new Date(d).toISOString().slice(0, 10);
  const a = { stars: 1234, downloads_month: 3_400_000, registry: 'npm', metrics_updated_at: '2026-11-15T04:00:00Z' };
  const e = piezasMetricas(a, { t: T(en), fecha, locale: 'en-GB' });
  assert.deepEqual(e.partes.map((p) => p.texto), ['⭐ 1.2 k', '↓ 3.4 M/mo']);
  assert.match(e.titulo, /1,234 GitHub stars/); assert.match(e.titulo, /Updated 2026-11-15/);
  const s = piezasMetricas(a, { t: T(es), fecha, locale: 'es-ES' });
  assert.deepEqual(s.partes.map((p) => p.texto), ['⭐ 1,2 k', '↓ 3,4 M/mes']);
  assert.match(s.titulo, /Actualizado el 2026-11-15/);
  assert.equal(piezasMetricas({ name: 'x' }, { t: T(en), fecha, locale: 'en' }), null);
  assert.deepEqual(piezasMetricas({ downloads_total: 5000, registry: 'rubygems' }, { t: T(en), fecha, locale: 'en' }).partes.map((p) => p.texto), ['↓ 5 k total']);
});

test('los textos nuevos están en EN y ES', () => {
  const claves = Object.keys(en).filter((k) => k.startsWith('met.'));
  assert.ok(claves.length >= 8);
  for (const k of claves) assert.ok(k in es, `falta ${k} en es`);
});

test('Markdown del agente: la popularidad va entre paréntesis, compacta', () => {
  const item = { slug: 'r', title: 'R', statement: 's', priority: 1, categories: [{ slug: 'c', priority: 1 }],
    accelerators: [
      { slug: 'a', name: 'Alpha', model: 'open_source', cost: 'free', url: 'https://a.example', stars: 12345, downloads_month: 1_200_000, registry: 'npm' },
      { slug: 'b', name: 'Beta', model: 'saas', cost: 'paid', url: 'https://b.example' }] };
  const md = renderMarkdown([item], { sinMensaje: true });
  assert.match(md, /\*\*Alpha\*\* \(open source · free · 12\.3k stars · 1\.2M downloads\/mo\) https:\/\/a\.example/);
  assert.match(md, /\*\*Beta\*\* \(SaaS · paid\) https:\/\/b\.example/);
});

// ── API: orden por popularidad
test('filtros: sort=popularity en aceleradores; valores inválidos dan error', async () => {
  assert.equal(parseFiltrosAceleradores({ sort: 'popularity' }).orden, 'popularity');
  assert.equal(parseFiltrosAceleradores({}).orden, null);
  assert.match(parseFiltrosAceleradores({ sort: 'copies' }).error, /sort: relevance \| popularity/);
  let args;
  await buscarAceleradores(parseFiltrosAceleradores({ sort: 'popularity' }), null, { rpc: async (v, a) => { args = { v, a }; return []; }, embed: null, aplicarCupo: null });
  assert.equal(args.v, 'buscar_aceleradores'); assert.equal(args.a.p_orden, 'popularity');
});

test('CLI: popularidad compacta', () => {
  assert.equal(popularidad({}), '');
  assert.equal(popularidad({ stars: 12345, downloads_month: 2_500_000, registry: 'pypi' }), '12.3k stars, 2.5M downloads/mo');
  assert.equal(popularidad({ downloads_total: 800, registry: 'homebrew' }), '800 installs total');
});
