// Lo que exige SESIÓN de Clerk (una API key no vale): aportar requisitos, gestionar
// las keys y borrar los datos propios.

import { randomBytes } from 'node:crypto';
import { rpc } from '../bd.mjs';
import { hashKey } from '../auth.mjs';
import { entrar, aplicarCupo, enviar, error, errorBd } from '../entrada.mjs';
import { leerJson } from '../http.mjs';
import { revisar } from '../revisar.mjs';
import { revisarPropuesta } from '../revision.mjs';
import { TIPOS_TEST, MODELOS_ACELERADOR, COSTES_ACELERADOR } from '../prompts_revision.mjs';

const POR_USUARIO_DIA = 10;
const GLOBAL_DIA = 200;   // protege la factura de Gemini

// Valida el cuerpo según el tipo. Devuelve { propuesta } o { error }. Los límites de tamaño
// son los de las columnas; la IA revisa el fondo (lib/revision.mjs).
export function validarCuerpoAporte(c) {
  const tipo = c.type === undefined ? 'requirement' : String(c.type);
  const t = (v) => String(v ?? '').trim();
  const largo = (v, min, max) => v.length >= min && v.length <= max;
  const slugs = (v) => (Array.isArray(v) ? v : []).slice(0, 20)
    .map((x) => (typeof x === 'string' ? x : { slug: t(x?.slug), coverage: x?.coverage === 'full' ? 'full' : 'partial' }))
    .filter((x) => (typeof x === 'string' ? x.length <= 120 : x.slug.length <= 120));
  if (tipo === 'requirement') {
    const text = t(c.text);
    if (!largo(text, 10, 4000)) return { error: 'text: between 10 and 4000 characters' };
    return { tipo, propuesta: { text }, categorias: Array.isArray(c.categories) ? c.categories.map(String).slice(0, 12) : [] };
  }
  if (tipo === 'test') {
    const p = { title: t(c.title), scenario: t(c.scenario), type: t(c.test_type) || undefined,
      priority: c.priority === undefined ? undefined : Number(c.priority), requirements: slugs(c.requirements).map((x) => (typeof x === 'string' ? x : x.slug)) };
    if (!largo(p.title, 5, 120)) return { error: 'title: between 5 and 120 characters' };
    if (!largo(p.scenario, 10, 800)) return { error: 'scenario: between 10 and 800 characters' };
    if (p.type && !TIPOS_TEST.includes(p.type)) return { error: `test_type: one of ${TIPOS_TEST.join(', ')}` };
    if (p.priority !== undefined && !(Number.isInteger(p.priority) && p.priority >= 1 && p.priority <= 5)) return { error: 'priority: integer 1 to 5' };
    if (!p.requirements.length) return { error: 'requirements: at least one requirement slug' };
    return { tipo, propuesta: p, categorias: [] };
  }
  if (tipo === 'accelerator') {
    const p = { name: t(c.name), url: t(c.url), description: t(c.description), model: t(c.model) || undefined, cost: t(c.cost) || undefined,
      platforms: (Array.isArray(c.platforms) ? c.platforms : []).slice(0, 12).map((x) => t(x).slice(0, 24)), requirements: slugs(c.requirements) };
    if (!largo(p.name, 2, 80)) return { error: 'name: between 2 and 80 characters' };
    if (!largo(p.url, 8, 300)) return { error: 'url: up to 300 characters' };
    if (!largo(p.description, 10, 600)) return { error: 'description: between 10 and 600 characters' };
    if (p.model && !MODELOS_ACELERADOR.includes(p.model)) return { error: `model: one of ${MODELOS_ACELERADOR.join(', ')}` };
    if (p.cost && !COSTES_ACELERADOR.includes(p.cost)) return { error: `cost: one of ${COSTES_ACELERADOR.join(', ')}` };
    if (!p.requirements.length) return { error: 'requirements: at least one requirement slug' };
    return { tipo, propuesta: p, categorias: [] };
  }
  return { error: 'type: requirement, test or accelerator' };
}

export async function aportar(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  let c;
  try { c = await leerJson(req); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const v = validarCuerpoAporte(c ?? {});
  if (v.error) return error(res, 400, v.error);
  if (c.accept_terms !== true)
    return error(res, 400, 'accept_terms must be true: you confirm you may submit this and agree to the Content Terms (/terms.html), including the licence you grant the project');

  if (!(await aplicarCupo(res, `contrib|${ident.id}`, 3, POR_USUARIO_DIA))) return;
  if (!(await aplicarCupo(res, 'global|contrib', 60, GLOBAL_DIA))) return;
  try {
    const r = v.tipo === 'requirement'
      ? await revisar({ autor: ident.id, texto: v.propuesta.text, categoriasSugeridas: v.categorias })
      : await revisarPropuesta({ autor: ident.id, tipo: v.tipo, propuesta: v.propuesta });
    enviar(res, 200, r);
  } catch { error(res, 502, 'review unavailable, try again later'); }
}

export async function misAportes(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  try { enviar(res, 200, { contributions: await rpc('mis_aportes', { p_sub: ident.owner }) }); }
  catch (e) { errorBd(res, e); }
}

export async function listarKeys(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  try { enviar(res, 200, { keys: await rpc('listar_keys', { p_sub: ident.owner }) }); }
  catch (e) { errorBd(res, e); }
}

export async function crearKey(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  let c;
  try { c = await leerJson(req, 2_000); } catch (e) { return error(res, e.status ?? 400, e.message); }
  const nombre = String(c.name ?? '').trim();
  if (nombre.length < 1 || nombre.length > 60) return error(res, 400, 'name: 1 to 60 characters');
  const key = 'rq_' + randomBytes(24).toString('base64url');
  try {
    const r = await rpc('crear_key', { p_sub: ident.owner, p_nombre: nombre, p_prefijo: key.slice(0, 10), p_hash: hashKey(key) });
    enviar(res, 201, { id: r.id, name: nombre, key, note: 'Store it now: it will not be shown again.' });
  } catch (e) { errorBd(res, e, [[/máximo 5 keys/, 409, 'maximum 5 active keys: revoke one first']]); }
}

export async function revocarKey(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id < 1) return error(res, 400, 'id: positive integer');
  try {
    (await rpc('revocar_key', { p_sub: ident.owner, p_id: id })) ? enviar(res, 200, { revoked: true }) : error(res, 404, 'key not found');
  } catch (e) { errorBd(res, e); }
}

export async function borrarMisDatos(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  try { enviar(res, 200, await rpc('borrar_mis_datos', { p_sub: ident.owner })); }
  catch (e) { errorBd(res, e); }
}
