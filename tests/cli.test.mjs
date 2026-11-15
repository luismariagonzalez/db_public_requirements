import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseArgs, contexto, URL_DEFECTO } from '../cli/reqdb.mjs';

const KEY = 'rq_AbCdEfGh1234567890abcdefXYZ';

// Entorno de prueba: carpetas temporales, fetch simulado y salida recogida.
function entorno({ env = {}, rutas = {} } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'reqdb-cwd-'));
  const cfg = mkdtempSync(join(tmpdir(), 'reqdb-cfg-'));
  const llamadas = [], out = [], err = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    llamadas.push({ metodo: init.method ?? 'GET', ruta: u.pathname, q: Object.fromEntries(u.searchParams), auth: init.headers?.authorization, cuerpo: init.body ? JSON.parse(init.body) : null });
    const r = rutas[`${init.method ?? 'GET'} ${u.pathname}`];
    if (r === undefined) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    const x = typeof r === 'function' ? r(u, init) : r;
    if (x instanceof Error) throw x;
    const cuerpo = typeof x.body === 'string' ? x.body : JSON.stringify(x.body ?? {});
    return new Response(cuerpo, { status: x.status ?? 200, headers: x.headers ?? {} });
  };
  const io = { cwd, env: { REQDB_CONFIG_DIR: cfg, REQDB_URL: 'https://reqdb.test', ...env }, fetch, out: (s) => out.push(s), err: (s) => err.push(s), leerStdin: async () => KEY };
  return { io, cwd, cfg, llamadas, out, err, correr: (...a) => main(a, io) };
}

test('parseArgs: posicionales, --k v, --k=v, booleanas, -o y --', () => {
  const { pos, f } = parseArgs(['search', 'login', 'flow', '--category', 'a,b', '--max-priority=2', '--json', '-o', 'x.md', '--', '--no-flag']);
  assert.deepEqual(pos, ['search', 'login', 'flow', '--no-flag']);
  assert.deepEqual([f.category, f['max-priority'], f.json, f.out], ['a,b', '2', true, 'x.md']);
  assert.throws(() => parseArgs(['--category']), /needs a value/);
});

test('configuración: flag > env > .reqdb.json > usuario > defecto', () => {
  const e = entorno();
  const base = { REQDB_CONFIG_DIR: e.cfg };                       // sin REQDB_URL ni claves del entorno
  assert.equal(contexto({}, base, e.cwd).url, URL_DEFECTO);
  writeFileSync(join(e.cfg, 'config.json'), JSON.stringify({ key: 'rq_usuario_1234567890' }));
  writeFileSync(join(e.cwd, '.reqdb.json'), JSON.stringify({ project: 7, url: 'https://proyecto.example/app/', maxPriority: 1 }));
  let c = contexto({}, base, e.cwd);
  assert.deepEqual([c.url, c.project, c.key], ['https://proyecto.example/app', 7, 'rq_usuario_1234567890']);
  c = contexto({}, { ...base, REQDB_URL: 'https://env.example', REQDB_KEY: 'rq_env_1234567890', REQDB_PROJECT: '9' }, e.cwd);
  assert.deepEqual([c.url, c.project, c.key], ['https://env.example', '9', 'rq_env_1234567890']);
  c = contexto({ url: 'https://flag.example', project: '3' }, { ...base, REQDB_URL: 'https://env.example' }, e.cwd);
  assert.deepEqual([c.url, c.project], ['https://flag.example', '3']);
});

test('sin argumentos enseña la ayuda con código 2; help y --version con 0', async () => {
  const e = entorno();
  assert.equal(await e.correr(), 2);
  assert.match(e.out.join('\n'), /Usage: reqdb <command>/);
  assert.equal(await e.correr('help'), 0);
  assert.equal(await e.correr('--version'), 0);
  assert.equal(await e.correr('inventado'), 2);
  assert.match(e.err.join('\n'), /Unknown command/);
});

test('login: valida la clave contra la API y la guarda; nunca la imprime entera', async () => {
  const e = entorno({ rutas: { 'GET /api/v1/projects': { body: { projects: [] } } } });
  assert.equal(await e.correr('login', '--key', KEY), 0);
  assert.equal(JSON.parse(readFileSync(join(e.cfg, 'config.json'), 'utf8')).key, KEY);
  assert.equal(e.llamadas[0].auth, `Bearer ${KEY}`);
  assert.ok(!e.out.join('\n').includes(KEY), 'la clave completa no debe salir por pantalla');
  assert.equal(await e.correr('login', '--key', 'no-es-una-clave'), 2);
  const stdin = entorno({ rutas: { 'GET /api/v1/projects': { body: { projects: [] } } } });
  assert.equal(await stdin.correr('login', '--key', '-'), 0);   // la clave llega por stdin
});

test('login con clave rechazada → código 3 y no se guarda', async () => {
  const e = entorno({ rutas: { 'GET /api/v1/projects': { status: 401, body: { error: 'invalid or revoked API key' } } } });
  assert.equal(await e.correr('login', '--key', KEY), 3);
  assert.equal(existsSync(join(e.cfg, 'config.json')), false);
});

test('init: exige clave, crea el proyecto, escribe .reqdb.json y no pisa uno existente', async () => {
  const rutas = { 'POST /api/v1/projects': { status: 201, body: { id: 42, name: 'x' } } };
  const sin = entorno({ rutas });
  assert.equal(await sin.correr('init', '--name', 'Mi app'), 3);
  const e = entorno({ rutas, env: { REQDB_KEY: KEY } });
  assert.equal(await e.correr('init', '--name', 'Mi app', '--category', 'messaging,security', '--max-priority', '1'), 0);
  assert.deepEqual(e.llamadas[0].cuerpo, { name: 'Mi app', categories: ['messaging', 'security'] });
  const cfg = JSON.parse(readFileSync(join(e.cwd, '.reqdb.json'), 'utf8'));
  assert.deepEqual([cfg.project, cfg.maxPriority, cfg.categories], [42, 1, ['messaging', 'security']]);
  assert.equal(await e.correr('init', '--name', 'otra'), 2);          // ya existe
  assert.equal(await e.correr('init', '--name', 'otra', '--force'), 0);
});

test('pull: usa lo de .reqdb.json, manda el proyecto y escribe REQUIREMENTS.md', async () => {
  const e = entorno({ env: { REQDB_KEY: KEY }, rutas: { 'GET /api/v1/requirements': { body: '# Requirements for your agent\n\n<!-- 3 requirement(s). Content: Requirements DB -->\n', headers: { 'content-type': 'text/markdown' } } } });
  writeFileSync(join(e.cwd, '.reqdb.json'), JSON.stringify({ project: 5, categories: ['messaging'], maxPriority: 2, tests: true, accelerators: false }));
  assert.equal(await e.correr('pull', '--hide-done'), 0);
  const q = e.llamadas[0].q;
  assert.deepEqual([q.project, q.category, q.max_priority, q.format, q.include, q.hide], ['5', 'messaging', '2', 'md', 'tests', 'done']);
  assert.match(readFileSync(join(e.cwd, 'REQUIREMENTS.md'), 'utf8'), /Requirements for your agent/);
  assert.match(e.out.join('\n'), /Wrote 3 requirement\(s\)/);
  assert.equal(await e.correr('pull', '-o', '-'), 0);               // a stdout, sin fichero
});

test('mark: entiende test:slug y accelerator:slug, pide proyecto y avisa de los desconocidos', async () => {
  const e = entorno({ env: { REQDB_KEY: KEY, REQDB_PROJECT: '5' }, rutas: { 'PUT /api/v1/projects/5/items': (u, init) => ({ body: { updated: JSON.parse(init.body).items.length - 1, unknown: ['requirement:nope'] } }) } });
  assert.equal(await e.correr('mark', 'done', 'auth-reset', 'test:reset-once', 'accelerator:lucia', 'nope', '--note', 'ok'), 1);   // 1 desconocido → 1
  assert.deepEqual(e.llamadas[0].cuerpo.items.map((i) => `${i.type}:${i.slug}`), ['requirement:auth-reset', 'test:reset-once', 'accelerator:lucia', 'requirement:nope']);
  assert.equal(e.llamadas[0].cuerpo.items[0].note, 'ok');
  assert.match(e.out.join('\n'), /Unknown \(not marked\): requirement:nope/);
  assert.equal(await e.correr('mark', 'hecho', 'x'), 2);
  assert.equal(await e.correr('mark', 'done', 'cosa:x'), 2);
  const sinProyecto = entorno({ env: { REQDB_KEY: KEY } });
  assert.equal(await sinProyecto.correr('mark', 'done', 'x'), 2);
});

test('check: código 1 si queda trabajo hasta P<N>, 0 si no; pide ocultar hecho y descartado', async () => {
  const pendiente = { requirements: [{ priority: 1, slug: 'a-req', title: 'Algo pendiente', project_status: 'planned' }] };
  const e = entorno({ env: { REQDB_KEY: KEY, REQDB_PROJECT: '5' }, rutas: { 'GET /api/v1/requirements': { body: pendiente } } });
  assert.equal(await e.correr('check', '--max-priority', '1'), 1);
  assert.deepEqual([e.llamadas[0].q.hide, e.llamadas[0].q.max_priority, e.llamadas[0].q.project], ['done,skipped', '1', '5']);
  assert.match(e.out.join('\n'), /1 requirement\(s\) up to P1 are not done/);
  const ok = entorno({ env: { REQDB_KEY: KEY, REQDB_PROJECT: '5' }, rutas: { 'GET /api/v1/requirements': { body: { requirements: [] } } } });
  assert.equal(await ok.correr('check'), 0);
  assert.match(ok.out.join('\n'), /^OK:/);
});

test('errores de la API: 429 → código 4 con Retry-After; sin red → 5; 401 → 3', async () => {
  const limitado = entorno({ rutas: { 'GET /api/v1/categories': { status: 429, body: { error: 'rate limit exceeded (minute).' }, headers: { 'retry-after': '17' } } } });
  assert.equal(await limitado.correr('categories'), 4);
  assert.match(limitado.err.join('\n'), /Retry in 17 s/);
  const caido = entorno({ rutas: { 'GET /api/v1/categories': Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }) } });
  assert.equal(await caido.correr('categories'), 5);
  assert.match(caido.err.join('\n'), /ENOTFOUND/);
  const sinPermiso = entorno({ env: { REQDB_KEY: KEY }, rutas: { 'GET /api/v1/projects': { status: 401, body: { error: 'invalid session token' } } } });
  assert.equal(await sinPermiso.correr('projects'), 3);
});

test('search: manda el texto y los filtros; --json imprime JSON; no usa el proyecto por sorpresa', async () => {
  const e = entorno({ rutas: { 'GET /api/v1/requirements': { body: { count: 1, requirements: [{ priority: 1, slug: 's', title: 'T' }] } } } });
  writeFileSync(join(e.cwd, '.reqdb.json'), JSON.stringify({ project: 5, categories: ['messaging'], maxPriority: 1 }));
  assert.equal(await e.correr('search', 'password', 'reset', '--category', 'security', '--tests', '--json'), 0);
  const q = e.llamadas[0].q;
  assert.deepEqual([q.q, q.category, q.include, q.max_priority], ['password reset', 'security', 'tests', undefined]);
  assert.equal(JSON.parse(e.out.join('\n')).count, 1);
});

test('suggest y agent', async () => {
  const e = entorno({ env: { REQDB_KEY: KEY, REQDB_PROJECT: '5' }, rutas: {
    'POST /api/v1/suggestions': { status: 201, body: { id: 3, status: 'new' } },
    'GET /api/v1/agent-instructions': { body: '## Instructions for the agent\n', headers: { 'content-type': 'text/markdown' } } } });
  assert.equal(await e.correr('suggest', 'cover group chats as well', '--about', 'typing-indicator'), 0);
  assert.deepEqual([e.llamadas[0].cuerpo.target, e.llamadas[0].cuerpo.target_type, e.llamadas[0].cuerpo.kind], ['typing-indicator', 'requirement', 'improvement']);
  assert.equal(await e.correr('suggest', 'corto'), 2);
  assert.equal(await e.correr('agent'), 0);
  assert.equal(e.llamadas.at(-1).q.project, '5');
  assert.match(e.out.join('\n'), /Instructions for the agent/);
});

test('una variable de entorno vacía cuenta como no definida', () => {
  const e = entorno();
  writeFileSync(join(e.cfg, 'config.json'), JSON.stringify({ key: 'rq_guardada_1234567890' }));
  const c = contexto({}, { REQDB_CONFIG_DIR: e.cfg, REQDB_KEY: '', REQDB_URL: '', REQDB_PROJECT: '' }, e.cwd);
  assert.deepEqual([c.key, c.url, c.project], ['rq_guardada_1234567890', URL_DEFECTO, null]);
});
