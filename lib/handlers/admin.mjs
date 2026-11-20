// Zona admin: /api/admin/*. TODOS los handlers pasan por entrarAdmin (lib/admin.mjs): sesión de Clerk
// con el sub en ADMIN_SUBS; una API key nunca vale. Nada de datos personales: las personas salen como
// hash corto con sal. Cada acción que cambia datos queda en la tabla de auditoría (dentro de la
// función SQL o con srv_admin_auditar).

import { rpc } from '../bd.mjs';
import { entrarAdmin, LIMITE_GEMINI_DIA } from '../admin.mjs';
import { aplicarCupo, enviar, error, errorBd } from '../entrada.mjs';
import { leerJson } from '../http.mjs';
import { puntuar, UMBRAL_CANDIDATO } from '../partible.mjs';
import { proponerDivision } from '../dividir.mjs';
import { embed, aLiteral } from '../gemini.mjs';
import { cargarCategorias } from '../categorias.mjs';
import { validarItem, estadoFinal } from '../umbral.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]{1,119}$/;
const sal = () => process.env.IP_SALT ?? '';
const entero = (v, def, min, max) => { const n = Number(v); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def; };
const ESTADOS_APORTE = ['pending', 'created', 'merged', 'rejected', 'needs_human'];
const ESTADOS_SUG = ['new', 'accepted', 'dismissed'];

// Envuelve un handler: puerta de admin + errores de base como 502.
const admin = (fn) => async (req, res, params) => {
  const a = await entrarAdmin(req, res); if (!a) return;
  try { await fn(req, res, params, a); }
  catch (e) { if (!res.headersSent) errorBd(res, e); }
};

// ── quién soy (la página lo usa para decidir si pinta el cuadro o el 403)
export const yo = admin(async (req, res, p, a) => enviar(res, 200, { admin: true, id: a.hash }));

// ── resumen, actividad y paneles
export const resumen = admin(async (req, res) => enviar(res, 200, await rpc('admin_resumen')));

export const actividad = admin(async (req, res) => {
  const dias = [30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const serie = await rpc('admin_actividad', { p_dias: dias });
  enviar(res, 200, { days: dias, series: serie, totals: totales(serie) });
});

// Suma de la serie (puro, con test).
export function totales(serie) {
  const t = { counters: {}, contributions: {}, suggestions: 0, keys_created: 0, projects_created: 0, requirements_created: 0 };
  for (const d of serie ?? []) {
    for (const [k, v] of Object.entries(d.counters ?? {})) t.counters[k] = (t.counters[k] ?? 0) + Number(v);
    for (const [k, v] of Object.entries(d.contributions ?? {})) t.contributions[k] = (t.contributions[k] ?? 0) + Number(v);
    for (const k of ['suggestions', 'keys_created', 'projects_created', 'requirements_created']) t[k] += Number(d[k] ?? 0);
  }
  return t;
}

export const paneles = admin(async (req, res) => enviar(res, 200, await rpc('admin_paneles')));
export const auditoria = admin(async (req, res) => enviar(res, 200, { audit: await rpc('admin_auditoria', { p_limite: entero(req.query.limit, 50, 1, 200) }) }));

// ── aportes: línea de tiempo y cola de needs_human
export const aportes = admin(async (req, res) => {
  const q = req.query;
  const estado = q.status ?? '';
  if (estado && !ESTADOS_APORTE.includes(estado)) return error(res, 400, `status: ${ESTADOS_APORTE.join(' | ')}`);
  const requisito = q.requirement ?? '';
  if (requisito && !SLUG.test(requisito)) return error(res, 400, 'requirement: invalid slug');
  const quien = q.who ?? '';
  if (quien && !/^[0-9a-f]{10}$/.test(quien)) return error(res, 400, 'who: a 10-character hash');
  const antes = q.before == null ? null : entero(q.before, null, 1, Number.MAX_SAFE_INTEGER);
  enviar(res, 200, await rpc('admin_aportes', { p_estado: estado, p_requisito: requisito, p_quien: quien, p_sal: sal(),
    p_limite: entero(q.limit, 50, 1, 100), p_antes: antes }));
});

const idDe = (params) => { const n = Number(params.id); return Number.isInteger(n) && n > 0 ? n : null; };

// Aprobar un aporte en needs_human: aplica los ítems guardados (crear o fusionar). Lo que no tenga
// ítem guardado (aportes anteriores a este cuadro, o fallos de la IA) sigue pendiente.
export const aprobarAporte = admin(async (req, res, params, a) => {
  const id = idDe(params); if (!id) return error(res, 400, 'id: positive integer');
  const r = await rpc('admin_aporte_reclamar', { p_id: id });
  if (!r) return error(res, 409, 'the contribution is not waiting for a person (needs_human)');

  const verdict = r.verdict ?? { items: [] };
  const resultados = []; let primerRequisito = null; let aplicados = 0;
  try {
    const slugs = new Set((await cargarCategorias()).map((c) => c.slug));
    for (const it of verdict.items ?? []) {
      if (it.action !== 'needs_human') { resultados.push(it); continue; }
      const v = it.item ? validarItem(it.item, slugs) : { ok: false };
      if (!v.ok) { resultados.push({ ...it, reason: 'no stored text to apply: reject it or ask for a new contribution' }); continue; }
      const vec = await embed(`${v.item.title}. ${v.item.statement}`, 'RETRIEVAL_DOCUMENT').then(aLiteral).catch(() => null);
      if (it.merge_into?.id) {
        const f = await rpc('fusionar', { p_requisito_id: it.merge_into.id, p_titulo: v.item.title, p_enunciado: v.item.statement,
          p_criterios: v.item.criteria, p_categorias: v.item.categories, p_vec: vec, p_aporte_id: id });
        resultados.push({ action: 'merged', slug: f.slug, reason: 'approved by an admin' });
        primerRequisito ??= f.id;
      } else {
        const c = await rpc('crear_requisito', { p_titulo: v.item.title, p_enunciado: v.item.statement, p_criterios: v.item.criteria,
          p_clase: v.item.kind, p_categorias: v.item.categories, p_vec: vec, p_autor: r.author, p_aporte_id: id, p_slug: null });
        resultados.push({ action: 'created', slug: c.slug, reason: 'approved by an admin' });
        primerRequisito ??= c.id;
      }
      aplicados++;
    }
  } catch (e) {
    // Devolver el aporte a la cola (lo ya aplicado queda aplicado: el aporte conserva su enlace).
    await rpc('resolver_aporte', { p_id: id, p_estado: 'needs_human', p_veredicto: verdict, p_requisito_id: primerRequisito }).catch(() => {});
    throw e;
  }

  const estado = estadoFinal(resultados.map((x) => x.action));
  const nuevo = { ...verdict, items: resultados, admin: { decision: 'approved', by: a.hash, at: new Date().toISOString() } };
  await rpc('resolver_aporte', { p_id: id, p_estado: estado, p_veredicto: nuevo, p_requisito_id: primerRequisito });
  await rpc('admin_auditar', { p_admin: a.hash, p_accion: 'contribution_approved', p_objetivo: `contribution:${id}`,
    p_detalle: { applied: aplicados, status: estado } });
  if (!aplicados) return error(res, 409, 'nothing could be applied: the contribution has no stored text. Reject it instead.');
  enviar(res, 200, { id, status: estado, items: resultados });
});

export const rechazarAporte = admin(async (req, res, params, a) => {
  const id = idDe(params); if (!id) return error(res, 400, 'id: positive integer');
  let c; try { c = await leerJson(req, 2_000); } catch (e) { return error(res, e.status ?? 400, e.message); }
  const motivo = String(c.reason ?? '').trim().slice(0, 300);
  const r = await rpc('admin_aporte_reclamar', { p_id: id });
  if (!r) return error(res, 409, 'the contribution is not waiting for a person (needs_human)');
  const nuevo = { ...(r.verdict ?? { items: [] }), admin: { decision: 'rejected', reason: motivo, by: a.hash, at: new Date().toISOString() } };
  await rpc('resolver_aporte', { p_id: id, p_estado: 'rejected', p_veredicto: nuevo, p_requisito_id: null });
  await rpc('admin_auditar', { p_admin: a.hash, p_accion: 'contribution_rejected', p_objetivo: `contribution:${id}`, p_detalle: { reason: motivo } });
  enviar(res, 200, { id, status: 'rejected' });
});

// ── sugerencias
export const sugerencias = admin(async (req, res) => {
  const estado = req.query.status ?? '';
  if (estado && !ESTADOS_SUG.includes(estado)) return error(res, 400, `status: ${ESTADOS_SUG.join(' | ')}`);
  enviar(res, 200, { suggestions: await rpc('admin_sugerencias', { p_estado: estado, p_sal: sal(),
    p_limite: entero(req.query.limit, 50, 1, 100), p_antes: req.query.before == null ? null : entero(req.query.before, null, 1, Number.MAX_SAFE_INTEGER) }) });
});

export const cambiarSugerencia = admin(async (req, res, params, a) => {
  const id = idDe(params); if (!id) return error(res, 400, 'id: positive integer');
  let c; try { c = await leerJson(req, 1_000); } catch (e) { return error(res, e.status ?? 400, e.message); }
  if (!ESTADOS_SUG.includes(c.status)) return error(res, 400, `status: ${ESTADOS_SUG.join(' | ')}`);
  (await rpc('admin_sugerencia_estado', { p_id: id, p_estado: c.status, p_admin: a.hash }))
    ? enviar(res, 200, { id, status: c.status }) : error(res, 404, 'suggestion not found');
});

// ── historial de versiones
export const historial = admin(async (req, res, params) => {
  if (!SLUG.test(params.slug)) return error(res, 400, 'invalid slug');
  const r = await rpc('admin_versiones', { p_slug: params.slug });
  r ? enviar(res, 200, r) : error(res, 404, 'requirement not found');
});

// ── requisitos largos / partibles
export const candidatos = admin(async (req, res) => {
  const min = entero(req.query.min_score, UMBRAL_CANDIDATO, 0, 100);
  const filas = await rpc('admin_candidatos', { p_limite: 300 });
  const lista = filas.map((f) => ({ ...f, analysis: puntuar(f) }))
    .filter((f) => f.analysis.score >= min)
    .sort((x, y) => y.analysis.score - x.analysis.score || y.copies - x.copies)
    .slice(0, 100)
    .map((f) => ({ slug: f.slug, title: f.title, copies: f.copies, version: f.version, proposal: f.proposal, ...f.analysis }));
  enviar(res, 200, { min_score: min, candidates: lista });
});

// Pide a Gemini una propuesta de división y la GUARDA. No cambia ningún requisito.
export const proponerDividir = admin(async (req, res, params, a) => {
  let c; try { c = await leerJson(req, 1_000); } catch (e) { return error(res, e.status ?? 400, e.message); }
  const slug = String(c.slug ?? '');
  if (!SLUG.test(slug)) return error(res, 400, 'slug: invalid');
  const r = await rpc('admin_requisito', { p_slug: slug });
  if (!r || r.status !== 'published') return error(res, 404, 'requirement not found');
  if (!(await aplicarCupo(res, 'admin|gemini', 10, LIMITE_GEMINI_DIA))) return;

  const analisis = puntuar({ statement: r.statement, criteria_count: r.criteria.length, categories_count: r.categories.length });
  let prop;
  try { prop = await proponerDivision({ title: r.title, statement: r.statement, criteria: r.criteria }); }
  catch { return error(res, 502, 'the AI service is unavailable, try again later'); }
  if (!prop.ok) return error(res, 502, `the AI proposal was not valid: ${prop.motivo}`);

  const id = await rpc('admin_propuesta_crear', { p_slug: slug, p_partes: prop.partes, p_motivo: prop.motivo,
    p_puntuacion: analisis.score, p_modelo: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash', p_admin: a.hash });
  enviar(res, 201, { id, requirement: slug, reason: prop.motivo, parts: prop.partes, status: 'pending' });
});

export const propuestas = admin(async (req, res) => {
  const estado = req.query.status ?? 'pending';
  if (estado && !['pending', 'accepted', 'dismissed'].includes(estado)) return error(res, 400, 'status: pending | accepted | dismissed');
  enviar(res, 200, { proposals: await rpc('admin_propuestas', { p_estado: estado, p_limite: entero(req.query.limit, 50, 1, 100) }) });
});

export const descartarPropuesta = admin(async (req, res, params, a) => {
  const id = idDe(params); if (!id) return error(res, 400, 'id: positive integer');
  (await rpc('admin_propuesta_descartar', { p_id: id, p_admin: a.hash }))
    ? enviar(res, 200, { id, status: 'dismissed' }) : error(res, 404, 'proposal not found or already resolved');
});

export const aceptarPropuesta = admin(async (req, res, params, a) => {
  const id = idDe(params); if (!id) return error(res, 400, 'id: positive integer');
  const p = (await rpc('admin_propuestas', { p_estado: 'pending', p_limite: 100 })).find((x) => x.id === id);
  if (!p) return error(res, 404, 'proposal not found or already resolved');
  // Embeddings de las partes (si Gemini falla, la parte se crea sin vector y se podrá re-embeber).
  const vecs = [];
  for (const parte of p.parts) vecs.push(await embed(`${parte.title}. ${parte.statement}`, 'RETRIEVAL_DOCUMENT').then(aLiteral).catch(() => null));
  try { enviar(res, 200, await rpc('admin_propuesta_aceptar', { p_id: id, p_vecs: vecs, p_admin: a.hash })); }
  catch (e) { errorBd(res, e, [[/ya está resuelta|ya no está publicado/, 409, 'the proposal is already resolved or the requirement is no longer published']]); }
});
