// Clientes de las fuentes de popularidad. `fetch` (y el reloj) son inyectables: las
// pruebas no tocan la red jamás. Cada función devuelve solo los campos que la fuente da:
//   { stars, forks, archived, last_commit }          GitHub
//   { downloads_month, downloads_total }              registros
// y lanza ErrorMetrica si no puede (sin repetir: el proceso guarda el error y sigue).
//
// Fuentes, límites y por qué esas: docs/metricas_aceleradores.md.

import { repoGithub, paqueteValido } from './origen.mjs';

// Genérico a propósito: las APIs (crates.io, Packagist) piden identificarse; quien despliegue
// puede añadir un contacto con METRICAS_USER_AGENT (p. ej. «reqdb-metrics/1.0 (+https://…)»).
export const USER_AGENT_DEFECTO = 'reqdb-metrics/1.0';
export const userAgent = (env = process.env) => String(env.METRICAS_USER_AGENT || USER_AGENT_DEFECTO).replace(/[\r\n]/g, ' ').slice(0, 200);

const VERSION_API_GITHUB = '2026-03-10';
const dormirReal = (ms) => new Promise((ok) => setTimeout(ok, ms));

export class ErrorMetrica extends Error {
  // limite: la fuente nos frena (el proceso debe parar ESA fuente por hoy). hastaMs: epoch en ms si se sabe.
  constructor(mensaje, { estado = null, limite = false, hastaMs = null } = {}) {
    super(mensaje);
    this.name = 'ErrorMetrica';
    this.estado = estado; this.limite = limite; this.hastaMs = hastaMs;
  }
}

// Dependencias por defecto y el espaciado mínimo entre peticiones a un mismo host (crates.io: 1 por segundo).
const ESPACIO_MS = { 'crates.io': 1100, 'pypistats.org': 300, 'api.github.com': 0 };

export function crearContexto({ fetchFn = globalThis.fetch, dormir = dormirReal, ahora = Date.now, env = process.env,
  token = env.GITHUB_TOKEN, reintentos = 3, esperaBaseMs = 400, topeEsperaMs = 5_000, timeoutMs = 8_000, espacio = ESPACIO_MS } = {}) {
  return { fetchFn, dormir, ahora, token, reintentos, esperaBaseMs, topeEsperaMs, timeoutMs, espacio,
    ua: userAgent(env), ultimo: new Map() };
}

// GET con retroceso exponencial: reintenta fallos de red, 429 y 5xx. Un 403/429 con el cupo agotado
// (x-ratelimit-remaining: 0) NO se reintenta: es un ErrorMetrica con limite=true. Los demás 4xx se devuelven.
export async function pedir(ctx, url, cabeceras = {}) {
  const host = new URL(url).hostname;
  let ultimoError;
  for (let intento = 0; intento <= ctx.reintentos; intento++) {
    const hueco = ctx.espacio[host] ?? 0;
    if (hueco) {
      const espera = (ctx.ultimo.get(host) ?? 0) + hueco - ctx.ahora();
      if (espera > 0) await ctx.dormir(espera);
    }
    ctx.ultimo.set(host, ctx.ahora());
    let r;
    try {
      r = await ctx.fetchFn(url, { headers: { 'user-agent': ctx.ua, accept: 'application/json', ...cabeceras },
        signal: AbortSignal.timeout(ctx.timeoutMs) });
    } catch (e) {
      ultimoError = new ErrorMetrica(`network error: ${e.message}`.slice(0, 200));
      if (intento < ctx.reintentos) await ctx.dormir(ctx.esperaBaseMs * 2 ** intento);
      continue;
    }
    if (r.status === 403 || r.status === 429) {
      const reset = Number(r.headers.get('x-ratelimit-reset'));
      const retry = Number(r.headers.get('retry-after'));
      const frenado = (hastaMs) => new ErrorMetrica(`rate limited by ${host} (${r.status})`, { estado: r.status, limite: true, hastaMs });
      if (r.headers.get('x-ratelimit-remaining') === '0')   // cupo agotado: no se insiste
        throw frenado(reset > 0 ? reset * 1000 : null);
      if (retry > 0 || r.status === 429) {                  // «espera un poco»: solo si es corto
        if (!(retry > 0 && retry * 1000 <= ctx.topeEsperaMs)) throw frenado(retry > 0 ? ctx.ahora() + retry * 1000 : null);
        ultimoError = frenado(ctx.ahora() + retry * 1000);
        if (intento < ctx.reintentos) await ctx.dormir(retry * 1000);
        continue;
      }
      return r;   // 403 que no es de cupo (p. ej. repositorio bloqueado): lo trata quien llama
    }
    if (r.status >= 500) {
      ultimoError = new ErrorMetrica(`${host} answered ${r.status}`, { estado: r.status });
      if (intento < ctx.reintentos) await ctx.dormir(ctx.esperaBaseMs * 2 ** intento);
      continue;
    }
    return r;
  }
  throw ultimoError;
}

async function json(ctx, url, cabeceras, { quien }) {
  const r = await pedir(ctx, url, cabeceras);
  if (r.status === 404) throw new ErrorMetrica(`${quien}: not found`, { estado: 404 });
  if (!r.ok) throw new ErrorMetrica(`${quien}: HTTP ${r.status}`, { estado: r.status });
  try { return await r.json(); }
  catch { throw new ErrorMetrica(`${quien}: invalid JSON`); }
}

const entero = (v) => (Number.isFinite(v) && v >= 0 && Number.isInteger(v) ? v : null);

// ── GitHub: estrellas, forks, archivado y último push (pushed_at: la mejor aproximación al último commit)
export async function consultarGithub(ctx, repoUrl) {
  const gh = repoGithub(repoUrl);
  if (!gh) throw new ErrorMetrica('github: repo_url is not a github.com repository');
  const cab = { accept: 'application/vnd.github+json', 'x-github-api-version': VERSION_API_GITHUB,
    ...(ctx.token ? { authorization: `Bearer ${ctx.token}` } : {}) };
  const j = await json(ctx, `https://api.github.com/repos/${gh.owner}/${gh.repo}`, cab, { quien: `github ${gh.owner}/${gh.repo}` });
  const stars = entero(j.stargazers_count);
  if (stars === null) throw new ErrorMetrica(`github ${gh.owner}/${gh.repo}: unexpected response`);
  return { stars, forks: entero(j.forks_count), archived: typeof j.archived === 'boolean' ? j.archived : null,
    last_commit: typeof j.pushed_at === 'string' ? j.pushed_at : null };
}

// ── registros
const REGISTRO = {
  // https://github.com/npm/registry/blob/main/docs/download-counts.md · «last-month» = últimos 30 días disponibles
  async npm(ctx, p) {
    const j = await json(ctx, `https://api.npmjs.org/downloads/point/last-month/${p}`, {}, { quien: `npm ${p}` });
    const m = entero(j.downloads);
    if (m === null) throw new ErrorMetrica(`npm ${p}: unexpected response`);
    return { downloads_month: m };
  },
  // https://pypistats.org/api/ · se actualiza una vez al día; sin espejos. Fuente oficial: BigQuery (exige credenciales).
  async pypi(ctx, p) {
    const j = await json(ctx, `https://pypistats.org/api/packages/${encodeURIComponent(p.toLowerCase())}/recent`, {}, { quien: `pypi ${p}` });
    const m = entero(j?.data?.last_month);
    if (m === null) throw new ErrorMetrica(`pypi ${p}: unexpected response`);
    return { downloads_month: m };
  },
  // https://crates.io/api/v1/crates/{n} (total) y /downloads (90 días por versión y día: se suman los últimos 30)
  async crates(ctx, p) {
    const j = await json(ctx, `https://crates.io/api/v1/crates/${encodeURIComponent(p)}`, {}, { quien: `crates ${p}` });
    const total = entero(j?.crate?.downloads);
    if (total === null) throw new ErrorMetrica(`crates ${p}: unexpected response`);
    const datos = { downloads_total: total };
    try {
      const d = await json(ctx, `https://crates.io/api/v1/crates/${encodeURIComponent(p)}/downloads`, {}, { quien: `crates ${p}` });
      const filas = [...(d.version_downloads ?? []), ...(d.meta?.extra_downloads ?? [])];
      const fechas = filas.map((f) => f.date).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
      if (fechas.length) {
        const ultima = new Date(`${fechas.at(-1)}T00:00:00Z`).getTime();
        const desde = new Date(ultima - 29 * 86_400_000).toISOString().slice(0, 10);
        datos.downloads_month = filas.filter((f) => f.date >= desde).reduce((s, f) => s + (entero(f.downloads) ?? 0), 0);
      }
    } catch (e) { if (e.limite) throw e; /* sin el mensual se guarda el total */ }
    return datos;
  },
  // Búsqueda de NuGet (documentada): totalDownloads. El endpoint sale del índice de servicio; se usa el conocido.
  async nuget(ctx, p) {
    const j = await json(ctx, `https://azuresearch-usnc.nuget.org/query?q=packageid:${encodeURIComponent(p)}&take=1&prerelease=true&semVerLevel=2.0.0`,
      {}, { quien: `nuget ${p}` });
    const hit = (j?.data ?? []).find((d) => String(d.id).toLowerCase() === p.toLowerCase());
    const t = entero(hit?.totalDownloads);
    if (t === null) throw new ErrorMetrica(`nuget ${p}: not found`, { estado: 404 });
    return { downloads_total: t };
  },
  // https://guides.rubygems.org/rubygems-org-api/ · total acumulado
  async rubygems(ctx, p) {
    const j = await json(ctx, `https://rubygems.org/api/v1/gems/${encodeURIComponent(p)}.json`, {}, { quien: `rubygems ${p}` });
    const t = entero(j.downloads);
    if (t === null) throw new ErrorMetrica(`rubygems ${p}: unexpected response`);
    return { downloads_total: t };
  },
  // https://packagist.org/apidoc · caché de 12 h en su lado
  async packagist(ctx, p) {
    const j = await json(ctx, `https://packagist.org/packages/${p}.json`, {}, { quien: `packagist ${p}` });
    const d = j?.package?.downloads;
    const total = entero(d?.total), mes = entero(d?.monthly);
    if (total === null && mes === null) throw new ErrorMetrica(`packagist ${p}: unexpected response`);
    return { ...(mes !== null ? { downloads_month: mes } : {}), ...(total !== null ? { downloads_total: total } : {}) };
  },
  // formulae.brew.sh: instalaciones (no descargas) de los últimos 30 días, de la analítica opt-out de Homebrew
  async homebrew(ctx, p) {
    const j = await json(ctx, `https://formulae.brew.sh/api/formula/${encodeURIComponent(p)}.json`, {}, { quien: `homebrew ${p}` });
    const mes = j?.analytics?.install?.['30d'];
    const n = mes && typeof mes === 'object' ? entero(mes[p] ?? Object.values(mes).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0)) : null;
    if (n === null) throw new ErrorMetrica(`homebrew ${p}: no install analytics`);
    return { downloads_month: n };
  },
};

export async function consultarRegistro(ctx, registro, paquete) {
  if (!REGISTRO[registro]) throw new ErrorMetrica(`${registro}: no public downloads source`);
  if (!paqueteValido(registro, paquete)) throw new ErrorMetrica(`${registro}: invalid package name`);
  return REGISTRO[registro](ctx, paquete);
}

// Un acelerador entero: { repo_url, registry, package } → datos para srv_guardar_metricas.
// GitHub y el registro son independientes: si uno falla y el otro no, se guardan los datos que llegaron
// y el error del que falló. `frenados` acumula las fuentes que han frenado por cupo (se dejan en paz el resto del lote).
// → { datos, limitado }: limitado = no se ha podido preguntar a alguna fuente por el cupo y no llegó ningún dato
// (el proceso entonces NO marca el intento, para repetirlo en la próxima pasada).
export async function consultarAcelerador(ctx, { repo_url, registry, package: paquete }, { frenados = new Set() } = {}) {
  const datos = {}, fuentes = [], errores = [];
  const intentar = async (nombre, fn) => {
    if (frenados.has(nombre)) { errores.push(`${nombre}: skipped (rate limited)`); return; }
    try { Object.assign(datos, Object.fromEntries(Object.entries(await fn()).filter(([, v]) => v !== null))); fuentes.push(nombre); }
    catch (e) {
      errores.push(String(e.message).slice(0, 120));
      if (e.limite) frenados.add(nombre);
      if (!(e instanceof ErrorMetrica)) throw e;
    }
  };
  if (repo_url && repoGithub(repo_url)) await intentar('github', () => consultarGithub(ctx, repo_url));
  if (registry && paquete) {
    if (REGISTRO[registry]) await intentar(registry, () => consultarRegistro(ctx, registry, paquete));
    else if (!repo_url) errores.push(`${registry}: no public downloads source`);
  }
  if (!errores.length && !fuentes.length) errores.push('nothing to query');
  return { datos: { ...datos, source: fuentes.join('+') || undefined, error: errores.join('; ').slice(0, 300) || null },
    limitado: !fuentes.length && frenados.size > 0 && errores.every((e) => /rate limited/.test(e)) };
}
