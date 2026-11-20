// Endpoints de lectura (públicos): categorías, requisitos, tests y aceleradores.
// Con `project=<id>` (y sesión o API key) los resultados se anotan con el estado
// que cada cosa tiene en ese proyecto, y se puede ocultar lo ya hecho (hide=done).

import { rpc } from '../bd.mjs';
import { entrar, enviar, error, errorBd } from '../entrada.mjs';
import { parseFiltros, parseFiltrosTests, parseFiltrosAceleradores, proyectoId } from '../filtros.mjs';
import { buscar, buscarTests, buscarAceleradores } from '../busqueda.mjs';
import { enriquecer, anotar, ocultarPorEstado } from '../enriquecer.mjs';
import { renderMarkdown } from '../markdown.mjs';
import { mensajeAgente } from '../mensaje_agente.mjs';
import { leerJson, baseUrl, sha256 } from '../http.mjs';
import { cargarCategorias, expandirCombinado } from '../categorias.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]{1,119}$/;
const CACHE_LARGA = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' };

// Carga el proyecto y el mapa de estados. Devuelve null si ya ha respondido (401/404).
async function cargarProyecto(res, ident, id) {
  if (!id) return { estados: null, info: null };
  if (ident.tipo === 'anon') {
    error(res, 401, 'project needs an account: send a session token or an API key', { 'www-authenticate': 'Bearer' });
    return null;
  }
  const p = await rpc('proyecto', { p_sub: ident.owner, p_id: id });
  if (!p) { error(res, 404, 'project not found'); return null; }
  const estados = {};
  for (const i of p.items) estados[`${i.type}:${i.slug}`] = i.status;
  return { estados, info: { id: p.id, name: p.name } };
}

async function nombresCategorias() {
  const cats = await cargarCategorias();
  return Object.fromEntries(cats.map((c) => [c.slug, c.name]));
}

// Una audiencia (b2b) o un dominio (finance-accounting) pedidos como `category` se
// expanden a las categorías que contienen; un slug que no existe es un 400.
// Devuelve null si ya ha respondido.
async function conJerarquia(res, f) {
  if (!f.categorias.length) return f;
  const { slugs, desconocidas } = expandirCombinado(f.categorias, await cargarCategorias());
  if (desconocidas.length) {
    error(res, 400, `unknown category: ${desconocidas.slice(0, 5).join(', ')} (see /api/v1/categories)`);
    return null;
  }
  return { ...f, categorias: slugs };
}

// `flow` es el nombre que se ve de screen_type (los flujos: registro, inicio de sesión, ajustes…).
const TIPOS_CAT = ['app_type', 'screen_type', 'flow', 'cross_cutting', 'audience', 'domain', 'software_category'];

// Cuenta una copia por persona, requisito y día. Quien la hace es un hash opaco (nunca la IP ni el
// usuario). Si la base falla, la lectura sigue: contar es secundario.
async function contarCopias(slugs, ident) {
  if (!slugs.length) return 0;
  try {
    return await rpc('contar_copias', { p_slugs: slugs.slice(0, 200), p_quien: sha256(String(ident.id)).slice(0, 24) });
  } catch { return 0; }
}

// GET /api/v1/categories?type=audience,domain&q=crm  (sin filtros: todas)
export async function categorias(req, res) {
  if (!(await entrar(req, res))) return;
  const tipos = String(req.query.type ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    .map((t) => (t === 'flow' ? 'screen_type' : t));
  if (tipos.some((t) => !TIPOS_CAT.includes(t))) return error(res, 400, `type: ${TIPOS_CAT.join(', ')}`);
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 80);
  try {
    let lista = await cargarCategorias();
    if (tipos.length) lista = lista.filter((c) => tipos.includes(c.type));
    if (q) lista = lista.filter((c) => `${c.name} ${c.slug}`.toLowerCase().includes(q));
    enviar(res, 200, { count: lista.length, categories: lista }, CACHE_LARGA);
  } catch (e) { errorBd(res, e); }
}

// Lo común a GET /requirements y POST /export: de una lista de fichas a la respuesta.
async function responder(req, res, items, f, proy, extra = {}, contar = null) {
  const base = baseUrl(req);
  const enriquecidos = await enriquecer(items, { estados: proy.estados, ocultar: f.ocultar,
    incluirTests: f.incluirTests, incluirAceleradores: f.incluirAceleradores, testsMax: f.testsMax });
  const lista = enriquecidos.slice(0, f.limite);

  if (f.formato === 'md') {
    if (contar) await contar(lista);
    return enviar(res, 200, renderMarkdown(lista, { nombres: await nombresCategorias(),
      categorias: f.categorias, proyecto: proy.info, base }));
  }
  enviar(res, 200, { count: lista.length, requirements: lista,
    agent_message: mensajeAgente({ base, proyecto: proy.info }), ...extra });
}

export async function listarRequisitos(req, res) {
  const ident = await entrar(req, res); if (!ident) return;
  const f0 = parseFiltros(req.query);
  if (!f0.ok) return error(res, 400, f0.error);
  try {
    const f = await conJerarquia(res, f0); if (!f) return;
    const proy = await cargarProyecto(res, ident, f.proyecto); if (!proy) return;
    // Si se oculta lo hecho, se pide de más: el límite se aplica después de ocultar.
    const { items, degradado } = await buscar({ ...f, limite: f.ocultar.length ? 200 : f.limite }, res);
    if (degradado) res.setHeader('x-search-mode', 'text-only');
    // Pedir el Markdown (lo que hace un agente o `reqdb pull`) cuenta como copia.
    await responder(req, res, items, f, proy, {}, (lista) => contarCopias(lista.map((i) => i.slug), ident));
  } catch (e) { errorBd(res, e); }
}

export async function verRequisito(req, res, { slug }) {
  if (!(await entrar(req, res))) return;
  if (!SLUG.test(slug)) return error(res, 400, 'invalid slug');
  try {
    const r = await rpc('requisito', { p_slug: slug });
    if (!r) return error(res, 404, 'requirement not found');
    const rel = (await rpc('relacionados', { p_slugs: [slug], p_tests: true, p_tests_max: 5, p_aceleradores: true }))?.[slug];
    enviar(res, 200, { ...r, tests: rel?.tests ?? [], accelerators: rel?.accelerators ?? [] });
  } catch (e) { errorBd(res, e); }
}

// POST /api/v1/copied { slugs }: la web lo llama cuando alguien pulsa «Copiar»
// (la vista previa llama a /export sin parar, por eso no se cuenta ahí).
export async function copiado(req, res) {
  const ident = await entrar(req, res); if (!ident) return;
  let cuerpo;
  try { cuerpo = await leerJson(req); } catch (e) { return error(res, e.status ?? 400, e.message); }
  const slugs = [...new Set(Array.isArray(cuerpo.slugs) ? cuerpo.slugs.map(String) : [])];
  if (!slugs.length || slugs.length > 200 || slugs.some((s) => !SLUG.test(s)))
    return error(res, 400, 'slugs: 1 to 200 valid requirement slugs');
  enviar(res, 200, { counted: await contarCopias(slugs, ident) });
}

// POST /api/v1/export { slugs, format, include, tests_max_priority, project }
export async function exportar(req, res) {
  const ident = await entrar(req, res); if (!ident) return;
  let cuerpo;
  try { cuerpo = await leerJson(req); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const slugs = [...new Set(Array.isArray(cuerpo.slugs) ? cuerpo.slugs.map(String) : [])];
  if (!slugs.length || slugs.length > 200 || slugs.some((s) => !SLUG.test(s)))
    return error(res, 400, 'slugs: 1 to 200 valid requirement slugs');
  const f = parseFiltros({ format: cuerpo.format, include: cuerpo.include, tests_max_priority: cuerpo.tests_max_priority,
    hide: cuerpo.hide, project: cuerpo.project, limit: 200 });
  if (!f.ok) return error(res, 400, f.error);

  try {
    const proy = await cargarProyecto(res, ident, f.proyecto); if (!proy) return;
    const items = (await Promise.all(slugs.map((s) => rpc('requisito', { p_slug: s })))).filter(Boolean);
    await responder(req, res, items, f, proy);
  } catch (e) { errorBd(res, e); }
}

export async function listarTests(req, res) {
  const ident = await entrar(req, res); if (!ident) return;
  const f0 = parseFiltrosTests(req.query);
  if (!f0.ok) return error(res, 400, f0.error);
  const proy = await proyectoDeQuery(req, res, ident); if (proy === false) return;
  try {
    const f = await conJerarquia(res, f0); if (!f) return;
    const { items, degradado } = await buscarTests(f, res);
    if (degradado) res.setHeader('x-search-mode', 'text-only');
    const lista = anotar(items, 'test', proy?.estados ?? null);
    enviar(res, 200, { count: lista.length, tests: lista });
  } catch (e) { errorBd(res, e); }
}

export async function verTest(req, res, { slug }) {
  if (!(await entrar(req, res))) return;
  if (!SLUG.test(slug)) return error(res, 400, 'invalid slug');
  try {
    const t = await rpc('test', { p_slug: slug });
    t ? enviar(res, 200, t) : error(res, 404, 'test not found');
  } catch (e) { errorBd(res, e); }
}

export async function listarAceleradores(req, res) {
  const ident = await entrar(req, res); if (!ident) return;
  const f0 = parseFiltrosAceleradores(req.query);
  if (!f0.ok) return error(res, 400, f0.error);
  const proy = await proyectoDeQuery(req, res, ident); if (proy === false) return;
  try {
    const f = await conJerarquia(res, f0); if (!f) return;
    const { items, degradado } = await buscarAceleradores(f, res);
    if (degradado) res.setHeader('x-search-mode', 'text-only');
    const lista = anotar(items, 'accelerator', proy?.estados ?? null);
    enviar(res, 200, { count: lista.length, accelerators: lista });
  } catch (e) { errorBd(res, e); }
}

export async function verAcelerador(req, res, { slug }) {
  if (!(await entrar(req, res))) return;
  if (!SLUG.test(slug)) return error(res, 400, 'invalid slug');
  try {
    const a = await rpc('acelerador', { p_slug: slug });
    a ? enviar(res, 200, a) : error(res, 404, 'accelerator not found');
  } catch (e) { errorBd(res, e); }
}

// ?project= en listados de tests/aceleradores. false = ya se ha respondido.
async function proyectoDeQuery(req, res, ident) {
  const id = proyectoId(req.query.project);
  if (id.error) { error(res, 400, id.error); return false; }
  if (!id.v) return null;
  try { return (await cargarProyecto(res, ident, id.v)) ?? false; }
  catch (e) { errorBd(res, e); return false; }
}

// GET /api/v1/agent-instructions?project=<id> → el mensaje al agente, en Markdown.
export async function instruccionesAgente(req, res) {
  const ident = await entrar(req, res); if (!ident) return;
  const id = proyectoId(req.query.project);
  if (id.error) return error(res, 400, id.error);
  try {
    const proy = await cargarProyecto(res, ident, id.v); if (!proy) return;
    enviar(res, 200, mensajeAgente({ base: baseUrl(req), proyecto: proy.info }));
  } catch (e) { errorBd(res, e); }
}
