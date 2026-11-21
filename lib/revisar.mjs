// La revisión de un aporte por la IA. Flujo (ver el plan del proyecto):
//   1. Normalizar y filtrar: ¿es un requisito?, traducir al inglés, partir si
//      trae varios, quitar lo que dicte DÓNDE va (pantallas, layout).
//   2. Por cada ítem: embedding → los 5 más parecidos →
//        ≥ 0.93  duplicado   · 0.80–0.93  pregunta a la IA (merge o new)  · < 0.80  nuevo
//   3. Crear, fusionar, rechazar o mandar a una persona.
//
// El texto del aporte es entrada NO confiable: va delimitado, el modelo solo
// puede devolver el esquema, y todo lo que devuelve se valida en umbral.mjs.
// `deps` es inyectable: los tests usan un Gemini y una base simulados.

import { rpc } from './bd.mjs';
import { embed, aLiteral, generarJson } from './gemini.mjs';
import { textoParaEmbedding, indexarCategorias } from './texto_embedding.mjs';
import { UMBRAL, MAX_ITEMS_POR_APORTE, decidirPorSimilitud, validarItem,
  conflictoPrioridad, categoriasNuevas, estadoFinal } from './umbral.mjs';
import { ESQUEMAS_ANALISIS, ESQUEMA_DECISION, promptRequisito, promptActualizacion } from './prompts_revision.mjs';
import { detectarInyeccion, normalizarAnalisis, decidirAnalisis } from './revision_reglas.mjs';

// Prompts, política y esquemas: lib/prompts_revision.mjs (una sola fuente para los tres tipos).
export const promptPaso1 = promptRequisito;
export const promptPaso2 = (item, candidatos) => promptActualizacion('requirement', item, candidatos);

// El embedding de un requisito lleva todas sus etiquetas (lib/texto_embedding.mjs).
const textoEmbedding = (i, idx) => textoParaEmbedding(i, idx);

export async function revisar({ autor, texto, categoriasSugeridas = [] }, deps = { rpc, embed, generarJson }) {
  const categorias = await deps.rpc('categorias');
  const slugs = new Set(categorias.map((c) => c.slug));
  const idxCat = indexarCategorias(categorias);
  const sugeridas = categoriasSugeridas.filter((s) => slugs.has(s)).slice(0, 12);

  const aporteId = await deps.rpc('registrar_aporte', { p_autor: autor, p_texto: texto, p_categorias: sugeridas });

  const cerrar = async (estado, veredicto, requisitoId = null) => {
    await deps.rpc('resolver_aporte', { p_id: aporteId, p_estado: estado, p_veredicto: veredicto, p_requisito_id: requisitoId });
    return { id: aporteId, status: estado, ...veredicto };
  };

  // 1 ─ normalizar, filtrar por la política y medir el riesgo
  let p1;
  try { p1 = await deps.generarJson(promptPaso1(texto, categorias), ESQUEMAS_ANALISIS.requirement); }
  catch { return cerrar('needs_human', { type: 'requirement', reason: 'automatic review unavailable; a person will look at it', items: [] }); }

  const analisis = normalizarAnalisis(p1);
  const meta = { type: 'requirement', risk_level: analisis.riesgo, confidence: analisis.confianza,
    injection_detected: analisis.inyeccion || detectarInyeccion(texto), language: analisis.idioma || null };
  const dec = decidirAnalisis(analisis, { inyeccionTexto: detectarInyeccion(texto) });
  if (dec.accion === 'rejected' || !Array.isArray(p1?.items) || !p1.items.length)
    return cerrar('rejected', { ...meta, reason: dec.razon || 'not a software requirement', reason_code: dec.codigo === 'none' ? 'not_an_item' : dec.codigo, items: [] });
  if (dec.accion === 'needs_human')
    return cerrar('needs_human', { ...meta, reason: dec.razon, reason_code: dec.codigo, items: [] });

  const resultados = [];

  for (const crudo of p1.items.slice(0, MAX_ITEMS_POR_APORTE)) {
    const v = validarItem(crudo, slugs);
    if (!v.ok) { resultados.push({ action: 'rejected', reason: v.motivo }); continue; }
    const item = v.item;

    try {
      const vec = aLiteral(await deps.embed(textoEmbedding(item, idxCat), 'RETRIEVAL_DOCUMENT'));
      const similares = await deps.rpc('similares', { p_vec: vec, p_n: 5 });
      const mejor = similares[0];
      const decision = mejor ? decidirPorSimilitud(mejor.similarity) : 'new';

      let accion = decision, objetivo = mejor, texto2 = null, razon = '';
      if (decision === 'ask') {
        const p2 = await deps.generarJson(promptPaso2(item, similares), ESQUEMA_DECISION);
        accion = ['update', 'merge', 'new', 'duplicate'].includes(p2?.decision) ? (p2.decision === 'update' ? 'merge' : p2.decision) : 'new';
        const r2 = normalizarAnalisis({ verdict: 'accept', risk_level: p2?.risk_level, confidence: 1, injection_detected: p2?.injection_detected });
        if (r2.riesgo === 'high') { resultados.push({ action: 'rejected', reason: 'it does not meet the contribution policy', reason_code: 'harmful' }); continue; }
        if (r2.inyeccion || r2.riesgo === 'medium') { resultados.push({ action: 'needs_human', reason: 'a person will check it before it is published', reason_code: 'prompt_injection' }); continue; }
        objetivo = similares.find((s) => s.slug === p2?.target_slug) ?? mejor;
        razon = String(p2?.reason ?? '').slice(0, 300);
        if (accion === 'merge') {
          const m = validarItem({ ...item, title: p2.merged?.title, statement: p2.merged?.text ?? p2.merged?.statement, criteria: p2.merged?.criteria ?? item.criteria }, slugs);
          texto2 = m.ok ? m.item : null;
          if (!texto2) accion = 'duplicate';
        }
      }

      // Duplicado: si trae categorías que el requisito no tiene, se añaden; si no, se rechaza.
      if (accion === 'duplicate') {
        const nuevas = categoriasNuevas(objetivo.categories, item.categories);
        if (nuevas.length) {
          // Con etiquetas nuevas el texto del embedding cambia: se recalcula (si Gemini falla, se deja el anterior).
          const vecNuevo = await deps.embed(textoEmbedding({ ...objetivo, categories: [...(objetivo.categories ?? []), ...nuevas] }, idxCat), 'RETRIEVAL_DOCUMENT')
            .then(aLiteral).catch(() => null);
          const r = await deps.rpc('fusionar', {
            p_requisito_id: objetivo.id, p_titulo: objetivo.title, p_enunciado: objetivo.statement,
            p_criterios: objetivo.criteria, p_categorias: nuevas, p_vec: vecNuevo, p_aporte_id: aporteId });
          resultados.push({ action: 'merged', slug: r.slug, reason: 'already existed; added the new categories' });
        } else {
          resultados.push({ action: 'rejected', duplicate_of: objetivo.slug, reason: 'this requirement already exists' });
        }
        continue;
      }

      if (accion === 'merge') {
        if (conflictoPrioridad(objetivo.categories, item.categories)) {
          resultados.push({ action: 'needs_human', slug: objetivo.slug,
            reason: 'proposes a different priority for an essential (P1) requirement',
            item: texto2 ?? item, merge_into: { id: objetivo.id, slug: objetivo.slug } });
          continue;
        }
        const final = texto2 ?? item;
        const nuevasCat = categoriasNuevas(objetivo.categories, item.categories);
        const vecFinal = aLiteral(await deps.embed(textoEmbedding(
          { ...final, kind: objetivo.kind ?? final.kind, categories: [...(objetivo.categories ?? []), ...nuevasCat] }, idxCat), 'RETRIEVAL_DOCUMENT'));
        const r = await deps.rpc('fusionar', {
          p_requisito_id: objetivo.id, p_titulo: final.title, p_enunciado: final.statement,
          p_criterios: final.criteria, p_categorias: nuevasCat,
          p_vec: vecFinal, p_aporte_id: aporteId });
        resultados.push({ action: 'merged', slug: r.slug, reason: razon || 'merged into an existing requirement' });
        continue;
      }

      const r = await deps.rpc('crear_requisito', {
        p_titulo: item.title, p_enunciado: item.statement, p_criterios: item.criteria, p_clase: item.kind,
        p_categorias: item.categories, p_vec: vec, p_autor: autor, p_aporte_id: aporteId, p_slug: null });
      resultados.push({ action: 'created', slug: r.slug, reason: razon || 'new requirement' });
    } catch {
      resultados.push({ action: 'needs_human', reason: 'error while checking for duplicates' });
    }
  }

  const estado = estadoFinal(resultados.map((r) => r.action));
  // crear_requisito y fusionar ya enlazaron el aporte con el requisito; aquí solo
  // se fija el estado final y el veredicto.
  return cerrar(estado, { ...meta, reason: resultados[0]?.reason ?? '', items: resultados });
}
