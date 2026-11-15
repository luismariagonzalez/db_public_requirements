// Proyectos: lo que una persona (o su agente, con su API key) lleva implementado
// y pendiente. Vale sesión de Clerk o API key; el dueño es siempre `ident.owner`
// y la base nunca revela proyectos ajenos (da «not found»).

import { rpc } from '../bd.mjs';
import { entrar, enviar, error, errorBd } from '../entrada.mjs';
import { leerJson, baseUrl } from '../http.mjs';
import { mensajeAgente, ESTADOS } from '../mensaje_agente.mjs';

const SLUG_CAT = /^[a-z0-9][a-z0-9_-]{1,59}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,119}$/;
const TIPOS = ['requirement', 'test', 'accelerator'];

const idDe = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER ? n : null; };

export async function listar(req, res) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  try { enviar(res, 200, { projects: await rpc('listar_proyectos', { p_sub: ident.owner }) }); }
  catch (e) { errorBd(res, e); }
}

export async function crear(req, res) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  let c;
  try { c = await leerJson(req, 4_000); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const nombre = String(c.name ?? '').trim();
  const descripcion = String(c.description ?? '').trim();
  const cats = Array.isArray(c.categories) ? c.categories.map(String) : [];
  if (nombre.length < 1 || nombre.length > 80) return error(res, 400, 'name: 1 to 80 characters');
  if (descripcion.length > 500) return error(res, 400, 'description: at most 500 characters');
  if (cats.length > 12 || cats.some((s) => !SLUG_CAT.test(s))) return error(res, 400, 'categories: up to 12 valid slugs');

  try {
    const r = await rpc('crear_proyecto', { p_sub: ident.owner, p_nombre: nombre, p_descripcion: descripcion, p_categorias: cats });
    enviar(res, 201, { ...r, agent_message: mensajeAgente({ base: baseUrl(req), proyecto: r }) });
  } catch (e) {
    errorBd(res, e, [[/ya tienes un proyecto/, 409, 'you already have a project with that name'],
                     [/máximo 20 proyectos/, 409, 'maximum 20 projects: delete one first']]);
  }
}

export async function ver(req, res, { id }) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  const n = idDe(id); if (!n) return error(res, 400, 'invalid project id');
  try {
    const p = await rpc('proyecto', { p_sub: ident.owner, p_id: n });
    if (!p) return error(res, 404, 'project not found');
    const resumen = Object.fromEntries(ESTADOS.map((e) => [e, p.items.filter((i) => i.status === e).length]));
    enviar(res, 200, { ...p, counts: resumen, agent_message: mensajeAgente({ base: baseUrl(req), proyecto: p }) });
  } catch (e) { errorBd(res, e); }
}

export async function borrar(req, res, { id }) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  const n = idDe(id); if (!n) return error(res, 400, 'invalid project id');
  try {
    (await rpc('borrar_proyecto', { p_sub: ident.owner, p_id: n })) ? enviar(res, 200, { deleted: true }) : error(res, 404, 'project not found');
  } catch (e) { errorBd(res, e); }
}

// PUT /api/v1/projects/:id/items  { items: [{ type, slug, status, note? }] }
export async function marcarItems(req, res, { id }) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  const n = idDe(id); if (!n) return error(res, 400, 'invalid project id');
  let c;
  try { c = await leerJson(req, 60_000); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const items = Array.isArray(c.items) ? c.items : null;
  if (!items || items.length < 1 || items.length > 200) return error(res, 400, 'items: 1 to 200 entries');
  const limpios = [];
  for (const [i, it] of items.entries()) {
    if (!TIPOS.includes(it?.type)) return error(res, 400, `items[${i}].type: ${TIPOS.join(' | ')}`);
    if (!SLUG.test(String(it?.slug ?? ''))) return error(res, 400, `items[${i}].slug: invalid`);
    if (!ESTADOS.includes(it?.status)) return error(res, 400, `items[${i}].status: ${ESTADOS.join(' | ')}`);
    const nota = it.note == null ? undefined : String(it.note).slice(0, 300);
    limpios.push({ type: it.type, slug: it.slug, status: it.status, ...(nota !== undefined ? { note: nota } : {}) });
  }

  try {
    const r = await rpc('marcar_items', { p_sub: ident.owner, p_id: n, p_items: limpios });
    enviar(res, 200, r);   // { updated, unknown: ["requirement:slug-que-no-existe", …] }
  } catch (e) {
    errorBd(res, e, [[/proyecto no encontrado/, 404, 'project not found'],
                     [/demasiados items/, 409, 'this project has too many items']]);
  }
}
