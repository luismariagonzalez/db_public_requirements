// Lo que exige SESIÓN de Clerk (una API key no vale): aportar requisitos, gestionar
// las keys y borrar los datos propios.

import { randomBytes } from 'node:crypto';
import { rpc } from '../bd.mjs';
import { hashKey } from '../auth.mjs';
import { entrar, aplicarCupo, enviar, error, errorBd } from '../entrada.mjs';
import { leerJson } from '../http.mjs';
import { revisar } from '../revisar.mjs';

const POR_USUARIO_DIA = 10;
const GLOBAL_DIA = 200;   // protege la factura de Gemini

export async function aportar(req, res) {
  const ident = await entrar(req, res, { soloUsuario: true }); if (!ident) return;
  let c;
  try { c = await leerJson(req); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const texto = String(c.text ?? '').trim();
  if (texto.length < 10 || texto.length > 4000) return error(res, 400, 'text: between 10 and 4000 characters');
  if (c.accept_terms !== true)
    return error(res, 400, 'accept_terms must be true: you confirm you may submit this and agree to the Content Terms (/terms.html), including the licence you grant the project');
  const categorias = Array.isArray(c.categories) ? c.categories.map(String).slice(0, 12) : [];

  if (!(await aplicarCupo(res, `contrib|${ident.id}`, 3, POR_USUARIO_DIA))) return;
  if (!(await aplicarCupo(res, 'global|contrib', 60, GLOBAL_DIA))) return;
  try { enviar(res, 200, await revisar({ autor: ident.id, texto, categoriasSugeridas: categorias })); }
  catch { error(res, 502, 'review unavailable, try again later'); }
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
