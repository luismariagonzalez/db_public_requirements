#!/usr/bin/env node
// reqdb: command line client for Requirements DB.
// One file, zero dependencies, Node >= 18. Made for coding agents and for CI:
// plain text output, `--json` everywhere, stable exit codes.
//
//   curl -fsSL https://joderestatodocogido.com/proyectos/requirements-db/app/reqdb.mjs -o reqdb.mjs
//   node reqdb.mjs help
//
// Exit codes: 0 ok · 1 `check` found pending work, or a refused request · 2 usage error
//             3 API key missing or invalid · 4 rate limited · 5 network or server error

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, unlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';
export const URL_DEFECTO = 'https://joderestatodocogido.com/proyectos/requirements-db/app';
const ESTADOS = ['done', 'in_progress', 'planned', 'skipped'];
const TIPOS = ['requirement', 'test', 'accelerator'];

export class Fallo extends Error {
  constructor(mensaje, codigo = 1) { super(mensaje); this.codigo = codigo; }
}

// ── argumentos ─────────────────────────────────────────────────────────────
const BOOLEANAS = new Set(['json', 'quiet', 'tests', 'accelerators', 'no-tests', 'no-accelerators',
  'hide-done', 'help', 'version', 'force']);

export function parseArgs(argv) {
  const pos = [], f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a === '-h') { f.help = true; continue; }
    if (a === '-o') { f.out = argv[++i]; if (f.out === undefined) throw new Fallo('-o needs a file name (or - for stdout)', 2); continue; }
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      if (BOOLEANAS.has(k) && v === undefined) { f[k] = true; continue; }
      const valor = v ?? argv[++i];
      if (valor === undefined) throw new Fallo(`--${k} needs a value`, 2);
      f[k] = valor;
      continue;
    }
    pos.push(a);
  }
  return { pos, f };
}

const lista = (v) => (v == null || v === '' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

// ── configuración ──────────────────────────────────────────────────────────
// Prioridad: flag > variable de entorno > .reqdb.json del proyecto > configuración del usuario > defecto.
export function dirConfigUsuario(env) {
  if (env.REQDB_CONFIG_DIR) return env.REQDB_CONFIG_DIR;
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'reqdb');
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'reqdb');
}
const leerJson = (ruta) => { try { return JSON.parse(readFileSync(ruta, 'utf8')); } catch { return null; } };

function buscarFicheroProyecto(cwd) {
  let d = resolve(cwd);
  for (;;) {
    const p = join(d, '.reqdb.json');
    if (existsSync(p)) return p;
    const arriba = dirname(d);
    if (arriba === d) return null;
    d = arriba;
  }
}

export function contexto(f, env, cwd) {
  const ficheroProyecto = buscarFicheroProyecto(cwd);
  const proy = (ficheroProyecto && leerJson(ficheroProyecto)) || {};
  const dirUsuario = dirConfigUsuario(env);
  const usuario = leerJson(join(dirUsuario, 'config.json')) || {};
  // Una variable de entorno o un flag vacíos cuentan como «no definido» (REQDB_KEY= no tapa la clave guardada).
  const primero = (...v) => v.find((x) => x !== undefined && x !== null && x !== '') ?? null;
  return {
    url: String(primero(f.url, env.REQDB_URL, proy.url) ?? URL_DEFECTO).replace(/\/+$/, ''),
    key: primero(f.key, env.REQDB_KEY, usuario.key),
    project: primero(f.project, env.REQDB_PROJECT, proy.project),
    ficheroProyecto, proy, dirUsuario,
  };
}

// ── HTTP ───────────────────────────────────────────────────────────────────
async function llamar(ctx, io, metodo, ruta, { query = {}, cuerpo, clave = false, texto = false } = {}) {
  const url = new URL(ctx.url + ruta);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const cab = { accept: texto ? 'text/markdown, application/json' : 'application/json', 'user-agent': `reqdb-cli/${VERSION}` };
  if (ctx.key) cab.authorization = `Bearer ${ctx.key}`;
  else if (clave) throw new Fallo('This command needs an API key. Create one in the web app (Account → API keys), then run `reqdb login --key rq_…` or set REQDB_KEY.', 3);
  if (cuerpo) cab['content-type'] = 'application/json';

  let r;
  try {
    r = await io.fetch(url, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(30_000) });
  } catch (e) { throw new Fallo(`Cannot reach ${ctx.url} (${e.cause?.code ?? e.message})`, 5); }

  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* texto plano (Markdown) */ }
  if (!r.ok) {
    const msg = j?.error ?? `HTTP ${r.status}`;
    if (r.status === 401) throw new Fallo(`${msg}. Check your key: reqdb login --key rq_…`, 3);
    if (r.status === 429) throw new Fallo(`${msg} Retry in ${r.headers.get('retry-after') ?? '?'} s.`, 4);
    throw new Fallo(msg, r.status >= 500 ? 5 : 1);
  }
  return j ?? t;
}

const proyectoOError = (ctx) => {
  if (!ctx.project) throw new Fallo('No project selected. Run `reqdb init --name "My app"` in your repo, `reqdb use <id>`, or pass --project <id>.', 2);
  return ctx.project;
};

// ── salida ─────────────────────────────────────────────────────────────────
const recorta = (s, n = 110) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const lineaReq = (it) => `P${it.priority}  ${it.slug}${it.project_status ? `  [${it.project_status}]` : ''}  ${recorta(it.title)}`;
function imprimir(io, f, datos, texto) { io.out(f.json ? JSON.stringify(datos, null, 2) : texto()); }

// Con `conProyecto`, lo que no se pide por flag sale de .reqdb.json (pull y check); en las búsquedas sueltas, no.
const flagsBusqueda = (ctx, f, conProyecto = false) => ({
  category: lista(f.category ?? (conProyecto ? ctx.proy.categories : undefined)),
  max_priority: f['max-priority'] ?? (conProyecto ? ctx.proy.maxPriority : undefined),
  kind: f.kind, sort: f.sort, limit: f.limit,
});

// ── comandos ───────────────────────────────────────────────────────────────
const AYUDA = `reqdb ${VERSION}: client for Requirements DB (requirements, tests and accelerators for coding agents)

Usage: reqdb <command> [options]

Discover
  categories [--type T] [--q text]      audiences, domains, software categories, app types, flows, topics
  search [text] [--category a,b] [--max-priority N] [--kind functional|technical]
         [--sort priority|copies|relevance] [--tests] [--accelerators] [--limit N]
  show <slug>                           one requirement with its tests and accelerators
  tests [text] [--category a,b] [--max-priority N]
  accelerators [text] [--category a,b] [--model open_source|proprietary|saas] [--platform p]

Work on a project (needs an API key)
  login --key rq_…                      store your key (or set REQDB_KEY)
  init --name "My app" [--category a,b] [--max-priority N]   create a project, write .reqdb.json
  projects | use <id>                   list your projects / select one for this repo
  pull [-o REQUIREMENTS.md] [--hide-done] [--no-tests] [--no-accelerators]
                                        write the Markdown brief for your agent
  mark <status> <item…> [--note text]   status: done | in_progress | planned | skipped
                                        item: slug | test:slug | accelerator:slug
  status                                what is done and what is pending
  check [--max-priority N]              exit 1 if requirements up to P<N> are still pending (for CI)
  suggest <text> [--about slug] [--type requirement|test|accelerator]
  agent                                 print the instructions your agent should follow

Global options
  --json  --url <base>  --key <key>  --project <id>  --quiet  -h/--help  --version

Config precedence: flags > env (REQDB_URL, REQDB_KEY, REQDB_PROJECT) > .reqdb.json > ~/.config/reqdb/config.json.
Exit codes: 0 ok · 1 pending work / refused · 2 usage · 3 key missing or invalid · 4 rate limited · 5 network or server.
Docs: ${URL_DEFECTO}/cli.html`;

const COMANDOS = {
  async help({ io }) { io.out(AYUDA); },
  async version({ io }) { io.out(VERSION); },

  async login({ ctx, f, io }) {
    let key = f.key;
    if (key === '-') key = (await io.leerStdin()).trim();
    if (!key || !/^rq_[A-Za-z0-9_-]{8,}$/.test(key)) throw new Fallo('Usage: reqdb login --key rq_…  (use --key - to read it from stdin)', 2);
    await llamar({ ...ctx, key }, io, 'GET', '/api/v1/projects', { clave: true });   // comprueba que vale
    mkdirSync(ctx.dirUsuario, { recursive: true });
    const ruta = join(ctx.dirUsuario, 'config.json');
    writeFileSync(ruta, JSON.stringify({ ...(leerJson(ruta) ?? {}), key }, null, 2) + '\n');
    try { chmodSync(ruta, 0o600); } catch { /* Windows */ }
    io.out(`Logged in with ${key.slice(0, 10)}… (stored in ${ruta})`);
  },
  async logout({ ctx, io }) {
    const ruta = join(ctx.dirUsuario, 'config.json');
    const c = leerJson(ruta);
    if (c?.key) { delete c.key; writeFileSync(ruta, JSON.stringify(c, null, 2) + '\n'); }
    else if (existsSync(ruta)) unlinkSync(ruta);
    io.out('Key removed.');
  },

  async categories({ ctx, f, io }) {
    const r = await llamar(ctx, io, 'GET', '/api/v1/categories', { query: { type: lista(f.type), q: f.q } });
    imprimir(io, f, r, () => [
      ...r.categories.map((c) => `${c.slug.padEnd(40)} ${c.type.padEnd(18)} ${String(c.requirements).padStart(4)}  ${c.name}`),
      `${r.count} categories. Use --type audience|domain|software_category|app_type|flow|cross_cutting and --q to narrow.`].join('\n'));
  },

  async search({ ctx, f, pos, io }) {
    const r = await llamar(ctx, io, 'GET', '/api/v1/requirements', { query: { ...flagsBusqueda(ctx, f), q: pos.join(' '),
      include: [f.tests && 'tests', f.accelerators && 'accelerators'].filter(Boolean),
      project: ctx.project, hide: f['hide-done'] ? 'done' : f.hide } });
    imprimir(io, f, r, () => [...r.requirements.map((it) => [lineaReq(it),
      ...(it.tests ?? []).map((t) => `      test P${t.priority}  ${t.slug}  ${recorta(t.title, 90)}`),
      ...(it.accelerators ?? []).map((a) => `      accelerator  ${a.slug}  ${a.name} (${a.model}, ${a.cost})`)].join('\n')),
      `${r.count} requirement(s). Details: reqdb show <slug>`].join('\n'));
  },

  async show({ ctx, f, pos, io }) {
    if (!pos[0]) throw new Fallo('Usage: reqdb show <slug>', 2);
    const r = await llamar(ctx, io, 'GET', `/api/v1/requirements/${encodeURIComponent(pos[0])}`);
    imprimir(io, f, r, () => [`P${r.priority}  ${r.title}  (${r.slug})`, `kind: ${r.kind} · categories: ${r.categories.map((c) => `${c.slug} P${c.priority}`).join(', ')}`,
      '', r.statement, '', ...(r.criteria ?? []).map((c) => `  - ${c}`),
      ...(r.tests?.length ? ['', 'Tests:', ...r.tests.map((t) => `  P${t.priority} ${t.slug} [${t.type}] ${t.scenario}`)] : []),
      ...(r.accelerators?.length ? ['', 'Accelerators:', ...r.accelerators.map((a) => `  ${a.slug}: ${a.name} (${a.model}, ${a.cost}, ${a.coverage}) ${a.url}`)] : [])].join('\n'));
  },

  async tests({ ctx, f, pos, io }) {
    const r = await llamar(ctx, io, 'GET', '/api/v1/tests', { query: { category: lista(f.category), max_priority: f['max-priority'], type: lista(f.type), q: pos.join(' '), limit: f.limit, project: ctx.project } });
    imprimir(io, f, r, () => [...r.tests.map((t) => `P${t.priority}  ${t.slug}  [${t.type}]${t.project_status ? `  [${t.project_status}]` : ''}  ${recorta(t.title, 90)}`), `${r.count} test(s).`].join('\n'));
  },
  async accelerators({ ctx, f, pos, io }) {
    const r = await llamar(ctx, io, 'GET', '/api/v1/accelerators', { query: { category: lista(f.category), model: lista(f.model), platform: lista(f.platform), q: pos.join(' '), limit: f.limit, project: ctx.project } });
    imprimir(io, f, r, () => [...r.accelerators.map((a) => `${a.slug}  ${a.name}  (${a.model}, ${a.cost})  ${a.url}`), `${r.count} accelerator(s).`].join('\n'));
  },

  async init({ ctx, f, io, cwd }) {
    const existente = ctx.ficheroProyecto && dirname(ctx.ficheroProyecto) === resolve(cwd) ? ctx.ficheroProyecto : null;
    if (existente && !f.force) throw new Fallo(`${existente} already exists (use --force to replace it, or \`reqdb use <id>\`).`, 2);
    const nombre = String(f.name ?? basename(resolve(cwd))).trim();
    const categorias = lista(f.category);
    const r = await llamar(ctx, io, 'POST', '/api/v1/projects', { cuerpo: { name: nombre, categories: categorias }, clave: true });
    const datos = { ...(ctx.url !== URL_DEFECTO ? { url: ctx.url } : {}), project: r.id, name: nombre, categories: categorias,
      maxPriority: Number(f['max-priority'] ?? 2), tests: true, accelerators: true };
    const ruta = join(resolve(cwd), '.reqdb.json');
    writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n');
    imprimir(io, f, { ...datos, file: ruta }, () => `Created project ${r.id} “${nombre}” → ${ruta}\nNext: reqdb pull   (writes REQUIREMENTS.md for your agent)`);
  },
  async projects({ ctx, f, io }) {
    const r = await llamar(ctx, io, 'GET', '/api/v1/projects', { clave: true });
    imprimir(io, f, r, () => r.projects.map((p) => `${String(p.id).padEnd(6)} ${p.name}  (${p.counts.done} done, ${p.counts.in_progress} in progress, ${p.counts.planned} planned, ${p.counts.skipped} skipped)`).join('\n') || 'No projects yet. Run `reqdb init`.');
  },
  async use({ pos, ctx, io, cwd }) {
    const id = Number(pos[0]);
    if (!Number.isInteger(id) || id < 1) throw new Fallo('Usage: reqdb use <project id>', 2);
    const ruta = ctx.ficheroProyecto ?? join(resolve(cwd), '.reqdb.json');
    writeFileSync(ruta, JSON.stringify({ ...ctx.proy, project: id }, null, 2) + '\n');
    io.out(`This repo now uses project ${id} (${ruta})`);
  },

  async pull({ ctx, f, io, cwd }) {
    const md = await llamar(ctx, io, 'GET', '/api/v1/requirements', { texto: true, query: { ...flagsBusqueda(ctx, f, true),
      format: 'md', limit: f.limit ?? 200, project: ctx.project,
      include: [!f['no-tests'] && ctx.proy.tests !== false && 'tests', !f['no-accelerators'] && ctx.proy.accelerators !== false && 'accelerators'].filter(Boolean),
      hide: f['hide-done'] ? 'done' : f.hide } });
    if (typeof md !== 'string') throw new Fallo('Unexpected response from the server.', 5);
    const n = /<!-- (\d+) requirement/.exec(md)?.[1] ?? '?';
    if (f.out === '-') { io.out(md); return; }
    const ruta = resolve(cwd, f.out ?? 'REQUIREMENTS.md');
    writeFileSync(ruta, md);
    imprimir(io, f, { file: ruta, requirements: Number(n) || 0, bytes: md.length }, () => `Wrote ${n} requirement(s) to ${ruta}${ctx.project ? ` (project ${ctx.project})` : ' (no project: run `reqdb init` so your agent can record progress)'}`);
  },

  async mark({ ctx, f, pos, io }) {
    const estado = pos[0];
    if (!ESTADOS.includes(estado) || pos.length < 2) throw new Fallo(`Usage: reqdb mark <${ESTADOS.join('|')}> <slug | test:slug | accelerator:slug>… [--note "why"]`, 2);
    const id = proyectoOError(ctx);
    const items = pos.slice(1).map((x) => {
      const m = /^(requirement|test|accelerator):(.+)$/.exec(x);
      if (!m && /^[a-z]+:/.test(x)) throw new Fallo(`Unknown item type in “${x}” (use ${TIPOS.join(', ')}).`, 2);
      return { type: m ? m[1] : 'requirement', slug: m ? m[2] : x, status: estado, ...(f.note ? { note: String(f.note) } : {}) };
    });
    let actualizados = 0; const desconocidos = [];
    for (let i = 0; i < items.length; i += 200) {
      const r = await llamar(ctx, io, 'PUT', `/api/v1/projects/${id}/items`, { cuerpo: { items: items.slice(i, i + 200) }, clave: true });
      actualizados += r.updated; desconocidos.push(...r.unknown);
    }
    imprimir(io, f, { updated: actualizados, unknown: desconocidos }, () => `Marked ${actualizados} item(s) as ${estado}.${desconocidos.length ? `\nUnknown (not marked): ${desconocidos.join(', ')}` : ''}`);
    return desconocidos.length ? 1 : 0;
  },

  async status({ ctx, f, io }) {
    const id = proyectoOError(ctx);
    const p = await llamar(ctx, io, 'GET', `/api/v1/projects/${id}`, { clave: true });
    const pendientes = p.items.filter((i) => i.status === 'planned' || i.status === 'in_progress');
    imprimir(io, f, { ...p, pending: pendientes }, () => [`${p.name} (project ${p.id}): ${p.counts.done} done · ${p.counts.in_progress} in progress · ${p.counts.planned} planned · ${p.counts.skipped} skipped`,
      ...pendientes.map((i) => `  [${i.status}] ${i.type}:${i.slug}  ${recorta(i.title, 80)}${i.note ? `  (“${i.note}”)` : ''}`)].join('\n'));
  },

  async check({ ctx, f, io }) {
    const id = proyectoOError(ctx);
    const max = Number(f['max-priority'] ?? ctx.proy.maxPriority ?? 2);
    const r = await llamar(ctx, io, 'GET', '/api/v1/requirements', { clave: true, query: { category: lista(f.category ?? ctx.proy.categories), max_priority: max, project: id, hide: 'done,skipped', limit: 200 } });
    const faltan = r.requirements;
    imprimir(io, f, { max_priority: max, pending: faltan.length, requirements: faltan }, () => faltan.length
      ? [`${faltan.length} requirement(s) up to P${max} are not done or skipped:`, ...faltan.map(lineaReq)].join('\n')
      : `OK: every requirement up to P${max} is done or skipped.`);
    return faltan.length ? 1 : 0;
  },

  async suggest({ ctx, f, pos, io }) {
    const texto = pos.join(' ').trim();
    if (texto.length < 10) throw new Fallo('Usage: reqdb suggest "what should change, and why" [--about slug] [--type requirement|test|accelerator]  (at least 10 characters)', 2);
    const r = await llamar(ctx, io, 'POST', '/api/v1/suggestions', { clave: true, cuerpo: {
      kind: f.kind ?? (f.about ? 'improvement' : 'new_item'), target_type: f.about ? (f.type ?? 'requirement') : 'general',
      target: f.about ?? undefined, text: texto } });
    imprimir(io, f, r, () => `Suggestion ${r.id} received. A person will review it.`);
  },

  async agent({ ctx, io }) {
    io.out(String(await llamar(ctx, io, 'GET', '/api/v1/agent-instructions', { texto: true, query: { project: ctx.project }, clave: Boolean(ctx.project) })).trimEnd());
  },
};

export async function main(argv, ext = {}) {
  const io = { env: process.env, cwd: process.cwd(), fetch: globalThis.fetch,
    out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n'),
    leerStdin: async () => { const t = []; for await (const c of process.stdin) t.push(c); return Buffer.concat(t).toString('utf8'); }, ...ext };
  try {
    const { pos, f } = parseArgs(argv);
    if (f.version) { COMANDOS.version({ io }); return 0; }
    const cmd = pos.shift();
    if (!cmd || cmd === 'help' || f.help) { await COMANDOS.help({ io }); return cmd || f.help ? 0 : 2; }
    const fn = COMANDOS[cmd];
    if (!fn || cmd === 'help') throw new Fallo(`Unknown command “${cmd}”. Run \`reqdb help\`.`, 2);
    return (await fn({ ctx: contexto(f, io.env, io.cwd), f, pos, io, cwd: io.cwd })) ?? 0;
  } catch (e) {
    if (e instanceof Fallo) { io.err(`reqdb: ${e.message}`); return e.codigo; }
    io.err(`reqdb: unexpected error: ${e.message}`);
    return 5;
  }
}

// Solo se ejecuta si es el programa principal (no si lo importan los tests).
const esPrincipal = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (esPrincipal) process.exitCode = await main(process.argv.slice(2));
