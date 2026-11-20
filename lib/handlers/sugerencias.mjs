// Sugerencias SOBRE LA APP (airedb): una funcionalidad nueva (`feature`) o un problema
// (`problem`). Cualquier persona con cuenta, o su agente con su API key, puede enviarlas.
// Quedan guardadas para que las revise una persona (no pasan por la IA).
// Lo que falte de requisitos, tests o aceleradores NO va aquí: se aporta por
// `POST /api/contribute` (type: requirement | test | accelerator).
//
// Compatibilidad con agentes y filas antiguas: `new_item` y `improvement` se tratan como
// `feature` y `report` como `problem` (siempre que no apunten a un requisito, test o
// acelerador); si apuntan a uno, es un 400 que redirige al flujo de aportar.

import { rpc } from '../bd.mjs';
import { entrar, aplicarCupo, enviar, error, errorBd } from '../entrada.mjs';
import { leerJson } from '../http.mjs';

export const KINDS = ['feature', 'problem'];
const ALIAS = { new_item: 'feature', improvement: 'feature', report: 'problem' };
const OBJETIVOS_APP = ['app', 'general'];

export async function crear(req, res) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  let c;
  try { c = await leerJson(req, 6_000); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const kind = ALIAS[c.kind] ?? c.kind ?? 'feature';
  const texto = String(c.text ?? '').trim();
  if (!KINDS.includes(kind)) return error(res, 400, `kind: ${KINDS.join(' | ')}`);
  if (c.target || (c.target_type && !OBJETIVOS_APP.includes(c.target_type)))
    return error(res, 400, 'suggestions are about the airedb app itself (a new feature or a problem). To add or improve a requirement, test or accelerator use POST /api/contribute');
  if (texto.length < 10 || texto.length > 1500) return error(res, 400, 'text: between 10 and 1500 characters');

  if (!(await aplicarCupo(res, `sug|${ident.owner}`, 5, 20))) return;
  try {
    const id = await rpc('sugerir', { p_autor: ident.owner, p_tipo: kind, p_objetivo_tipo: 'app', p_objetivo_slug: null, p_texto: texto });
    enviar(res, 201, { id, kind, status: 'new', note: 'Thanks! A person will review it.' });
  } catch (e) {
    errorBd(res, e, [[/demasiadas sugerencias/, 429, 'too many suggestions today']]);
  }
}

export async function listar(req, res) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  try { enviar(res, 200, { suggestions: await rpc('mis_sugerencias', { p_sub: ident.owner }) }); }
  catch (e) { errorBd(res, e); }
}
