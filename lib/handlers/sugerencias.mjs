// Sugerencias: cualquier persona con cuenta, o su agente con su API key, puede
// proponer algo nuevo, una mejora o avisar de un problema. Quedan guardadas para
// que las revise una persona (no pasan por la IA: no cambian el contenido solas).

import { rpc } from '../bd.mjs';
import { entrar, aplicarCupo, enviar, error, errorBd } from '../entrada.mjs';
import { leerJson } from '../http.mjs';

const KINDS = ['new_item', 'improvement', 'report'];
const TARGETS = ['requirement', 'test', 'accelerator', 'general'];

export async function crear(req, res) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  let c;
  try { c = await leerJson(req, 6_000); } catch (e) { return error(res, e.status ?? 400, e.message); }

  const kind = c.kind ?? 'improvement';
  const targetType = c.target_type ?? (c.target ? 'requirement' : 'general');
  const target = c.target == null ? null : String(c.target);
  const texto = String(c.text ?? '').trim();
  if (!KINDS.includes(kind)) return error(res, 400, `kind: ${KINDS.join(' | ')}`);
  if (!TARGETS.includes(targetType)) return error(res, 400, `target_type: ${TARGETS.join(' | ')}`);
  if (target && !/^[a-z0-9][a-z0-9-]{1,119}$/.test(target)) return error(res, 400, 'target: invalid slug');
  if (targetType === 'general' && target) return error(res, 400, 'target must be empty when target_type is general');
  if (texto.length < 10 || texto.length > 1500) return error(res, 400, 'text: between 10 and 1500 characters');

  if (!(await aplicarCupo(res, `sug|${ident.owner}`, 5, 20))) return;
  try {
    const id = await rpc('sugerir', { p_autor: ident.owner, p_tipo: kind, p_objetivo_tipo: targetType, p_objetivo_slug: target, p_texto: texto });
    enviar(res, 201, { id, status: 'new', note: 'Thanks! A person will review it.' });
  } catch (e) {
    errorBd(res, e, [[/el objetivo no existe/, 400, 'target not found: check its slug'],
                     [/demasiadas sugerencias/, 429, 'too many suggestions today']]);
  }
}

export async function listar(req, res) {
  const ident = await entrar(req, res, { cuenta: true }); if (!ident) return;
  try { enviar(res, 200, { suggestions: await rpc('mis_sugerencias', { p_sub: ident.owner }) }); }
  catch (e) { errorBd(res, e); }
}
