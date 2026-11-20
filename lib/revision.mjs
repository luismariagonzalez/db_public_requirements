// Revisión de aportes de TESTS y ACELERADORES (los requisitos siguen en revisar.mjs, con el mismo
// patrón). Flujo:
//   0. Comprobaciones baratas sin IA: forma de la propuesta, URL del acelerador (https, pública),
//      que los requisitos enlazados existan.
//   1. Análisis con Gemini (prompts_revision.mjs): política de contenido, normalizar a inglés,
//      nivel de riesgo, inyección de prompt. El código decide qué hacer con ello (revision_reglas).
//   2. Solo si se acepta: se comprueba la URL en la red (con tiempo límite y sin SSRF).
//   3. Embedding → el más cercano de su tipo →
//        ≥ 0.93 duplicado · 0.80–0.93 pregunta a la IA (update | new | duplicate) · < 0.80 nuevo
//   4. Crear, actualizar (fusionar), rechazar o mandar a una persona.
// Una fusión nunca cambia una prioridad ni una cobertura existentes; discutir un P1 → needs_human.
// `deps` es inyectable: los tests usan base, Gemini y red simulados.

import { rpc } from './bd.mjs';
import { embed, aLiteral, generarJson } from './gemini.mjs';
import { UMBRAL, decidirPorSimilitud } from './umbral.mjs';
import { ESQUEMAS_ANALISIS, ESQUEMA_DECISION, promptTest, promptAcelerador, promptActualizacion,
  propuestaATexto } from './prompts_revision.mjs';
import { detectarInyeccion, normalizarAnalisis, decidirAnalisis, validarTest, validarAcelerador,
  limpiarUrl, conflictoPrioridadTest, enlacesNuevosTest, enlacesNuevosAcelerador, cabenEnlaces,
  MAX_REQ_TEST, MAX_REQ_ACELERADOR } from './revision_reglas.mjs';
import { validarUrlAcelerador, comprobarUrlSegura } from './url_segura.mjs';

const DEPS = { rpc, embed, generarJson, comprobarUrl: comprobarUrlSegura };
const limpia = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const slugsDe = (lista, max) => [...new Set((Array.isArray(lista) ? lista : [])
  .map((x) => limpia(typeof x === 'string' ? x : x?.slug).toLowerCase()).filter((s) => /^[a-z0-9][a-z0-9-]{1,119}$/.test(s)))].slice(0, max);

const ADAPTADORES = {
  test: {
    max: MAX_REQ_TEST,
    texto: (i) => `${i.title}. ${i.scenario}`,
    similares: 'similares_tests',
    validar: (raw, slugs) => validarTest(raw, slugs),
    nuevos: enlacesNuevosTest,
    textoMezcla: (m, item) => ({ title: limpia(m?.title), text: limpia(m?.text) }),
    mezclaValida: (m) => m.title.length >= 5 && m.title.length <= 120 && m.text.length >= 10 && m.text.length <= 800,
  },
  accelerator: {
    max: MAX_REQ_ACELERADOR,
    texto: (i) => `${i.name}. ${i.description}`,
    similares: 'similares_aceleradores',
    validar: (raw, slugs, url) => validarAcelerador(raw, slugs, url),
    nuevos: enlacesNuevosAcelerador,
    textoMezcla: (m) => ({ title: '', text: limpia(m?.text) }),
    mezclaValida: (m) => m.text.length >= 10 && m.text.length <= 600,
  },
};

export async function revisarPropuesta({ autor, tipo, propuesta }, deps = DEPS) {
  const ad = ADAPTADORES[tipo];
  if (!ad) throw new Error('tipo de aporte no soportado');
  const texto = propuestaATexto(tipo, propuesta).slice(0, 4000);
  const inyeccionTexto = detectarInyeccion(texto);
  const acelerador = tipo === 'accelerator';

  // Lo que se guarda de la propuesta: solo los campos conocidos, ya recortados.
  const guardada = acelerador
    ? { name: limpia(propuesta.name).slice(0, 120), url: String(propuesta.url ?? '').trim().slice(0, 300),
        description: limpia(propuesta.description).slice(0, 800), model: propuesta.model, cost: propuesta.cost,
        platforms: (propuesta.platforms ?? []).slice(0, 12), requirements: propuesta.requirements }
    : { title: limpia(propuesta.title).slice(0, 160), scenario: limpia(propuesta.scenario).slice(0, 1000),
        type: propuesta.type, priority: propuesta.priority, requirements: propuesta.requirements };
  const aporteId = await deps.rpc('registrar_propuesta', { p_autor: autor, p_tipo: tipo, p_texto: texto, p_propuesta: guardada, p_categorias: [] });

  let meta = { risk_level: 'none', confidence: null, injection_detected: inyeccionTexto, language: null };
  const cerrar = async (estado, items, extra = {}) => {
    const veredicto = { type: tipo, reason: items[0]?.reason ?? '', ...meta, ...extra, items };
    await deps.rpc('resolver_aporte', { p_id: aporteId, p_estado: estado, p_veredicto: veredicto, p_requisito_id: null });
    return { id: aporteId, status: estado, ...veredicto };
  };
  const rechazo = (reason, code = 'not_an_item') => cerrar('rejected', [{ action: 'rejected', reason, reason_code: code }]);
  const humano = (reason, code = 'unclear') => cerrar('needs_human', [{ action: 'needs_human', reason, reason_code: code }]);

  // 0 ─ comprobaciones sin IA
  let urlLimpia = null;
  if (acelerador) {
    const v = validarUrlAcelerador(limpiarUrl(String(propuesta.url ?? '').trim()));
    if (!v.ok) return rechazo(v.motivo);
    urlLimpia = v.url;
  }
  const pedidos = slugsDe(propuesta.requirements, ad.max);
  const encontrados = (await Promise.all(pedidos.map((s) => deps.rpc('requisito', { p_slug: s }).catch(() => null))))
    .filter(Boolean).map((r) => ({ slug: r.slug, title: r.title, statement: r.statement }));
  if (!encontrados.length) return rechazo('link it to at least one existing requirement (use the requirement slug)');
  const slugsValidos = new Set(encontrados.map((r) => r.slug));

  // 1 ─ análisis y política
  let p1;
  try {
    p1 = await deps.generarJson(acelerador ? promptAcelerador(texto, encontrados, true) : promptTest(texto, encontrados), ESQUEMAS_ANALISIS[tipo]);
  } catch { return humano('automatic review unavailable; a person will look at it'); }
  const analisis = normalizarAnalisis(p1);
  meta = { risk_level: analisis.riesgo, confidence: analisis.confianza, injection_detected: analisis.inyeccion || inyeccionTexto, language: analisis.idioma || null };
  const dec = decidirAnalisis(analisis, { inyeccionTexto });
  if (dec.accion === 'rejected') return rechazo(dec.razon, dec.codigo);
  if (dec.accion === 'needs_human') return humano(dec.razon, dec.codigo);

  const v = ad.validar(p1.item, slugsValidos, urlLimpia);
  if (!v.ok) return rechazo(v.motivo, 'unclear');
  const item = v.item;

  // 2 ─ la URL existe de verdad (solo ahora: no se pide a nadie que visitemos URLs de aportes rechazados)
  if (acelerador) {
    const u = await deps.comprobarUrl(urlLimpia);
    if (!u.ok) return u.red ? humano(`${u.motivo}; a person will check it`, 'unclear') : rechazo(u.motivo, 'not_an_item');
  }

  try {
    // 3 ─ el más cercano de su tipo
    const vec = aLiteral(await deps.embed(ad.texto(item), 'RETRIEVAL_DOCUMENT'));
    let similares = await deps.rpc(ad.similares, { p_vec: vec, p_n: 5 });
    if (acelerador) {
      const igual = await deps.rpc('acelerador_por_url', { p_url: urlLimpia });
      if (igual) similares = [igual, ...similares.filter((s) => s.slug !== igual.slug)];
    }
    const mejor = similares[0];
    let accion = mejor ? decidirPorSimilitud(mejor.similarity) : 'new';
    let objetivo = mejor, mezcla = null, razon = '';

    if (accion === 'ask') {
      const p2 = await deps.generarJson(promptActualizacion(tipo, item, similares), ESQUEMA_DECISION);
      const r2 = normalizarAnalisis({ verdict: 'accept', risk_level: p2?.risk_level, confidence: p2?.confidence ?? 1, injection_detected: p2?.injection_detected });
      if (r2.riesgo === 'high') return rechazo('it does not meet the contribution policy', 'harmful');
      if (r2.inyeccion || r2.riesgo === 'medium') return humano('a person will check it before it is published', 'prompt_injection');
      accion = ['update', 'new', 'duplicate'].includes(p2?.decision) ? p2.decision : 'new';
      razon = limpia(p2?.reason).slice(0, 300);
      const elegido = similares.find((s) => s.slug === p2?.target_slug);
      // «Actualizar» solo con mucha cercanía: el objetivo ha de ser uno de los parecidos de verdad.
      if (accion !== 'new' && (!elegido || elegido.similarity < UMBRAL.parecido)) accion = 'new';
      objetivo = elegido ?? mejor;
      if (accion === 'update') {
        const m = ad.textoMezcla(p2?.merged, item);
        if (ad.mezclaValida(m)) mezcla = m; else accion = 'duplicate';
      }
    }
    // (Un acelerador con la misma URL que otro publicado entra como el más parecido, similitud 1: duplicado.)

    // Duplicado: si trae enlaces a requisitos que el elemento no tiene, se añaden; si no, se rechaza.
    if (accion === 'duplicate') {
      const nuevos = ad.nuevos(objetivo, item);
      if (nuevos.length && cabenEnlaces(tipo, objetivo, nuevos)) {
        const r = acelerador
          ? await deps.rpc('fusionar_acelerador', { p_acelerador_id: objetivo.id, p_descripcion: objetivo.description, p_plataformas: [],
              p_requisitos: nuevos, p_vec: null, p_aporte_id: aporteId })
          : await deps.rpc('fusionar_test', { p_test_id: objetivo.id, p_titulo: objetivo.title, p_escenario: objetivo.scenario,
              p_requisitos: nuevos, p_vec: null, p_aporte_id: aporteId });
        return cerrar('merged', [{ action: 'merged', slug: r.slug, reason: 'already existed; added the new requirement links', reason_code: 'none' }]);
      }
      return cerrar('rejected', [{ action: 'rejected', duplicate_of: objetivo.slug, reason: 'this already exists', reason_code: 'duplicate' }]);
    }

    if (accion === 'update') {
      if (!acelerador && conflictoPrioridadTest(objetivo, item))
        return cerrar('needs_human', [{ action: 'needs_human', slug: objetivo.slug, reason_code: 'unclear',
          reason: 'proposes a different priority for an essential (P1) test' }]);
      const nuevos = ad.nuevos(objetivo, item);
      if (!cabenEnlaces(tipo, objetivo, nuevos)) return humano('it would link more requirements than allowed; a person will check it');
      const texto2 = acelerador ? { description: mezcla.text } : { title: mezcla.title, scenario: mezcla.text };
      const vecFinal = aLiteral(await deps.embed(acelerador ? `${objetivo.name}. ${texto2.description}` : `${texto2.title}. ${texto2.scenario}`, 'RETRIEVAL_DOCUMENT'));
      const r = acelerador
        ? await deps.rpc('fusionar_acelerador', { p_acelerador_id: objetivo.id, p_descripcion: texto2.description, p_plataformas: item.platforms,
            p_requisitos: nuevos, p_vec: vecFinal, p_aporte_id: aporteId })
        : await deps.rpc('fusionar_test', { p_test_id: objetivo.id, p_titulo: texto2.title, p_escenario: texto2.scenario,
            p_requisitos: nuevos, p_vec: vecFinal, p_aporte_id: aporteId });
      return cerrar('merged', [{ action: 'merged', slug: r.slug, reason: razon || `merged into an existing ${tipo}`, reason_code: 'none' }]);
    }

    // Nuevo
    const r = acelerador
      ? await deps.rpc('crear_acelerador', { p_nombre: item.name, p_descripcion: item.description, p_modelo: item.model, p_coste: item.cost,
          p_url: urlLimpia, p_plataformas: item.platforms, p_requisitos: item.requirements, p_vec: vec, p_autor: autor, p_slug: null })
      : await deps.rpc('crear_test', { p_titulo: item.title, p_escenario: item.scenario, p_tipo: item.type, p_prioridad: item.priority,
          p_requisitos: item.requirements, p_vec: vec, p_autor: autor, p_slug: null });
    await deps.rpc('enlazar_aporte', { p_id: aporteId, p_tipo: tipo, p_item_id: r.id });
    return cerrar('created', [{ action: 'created', slug: r.slug, reason: razon || `new ${tipo}`, reason_code: 'none', item }]);
  } catch {
    return humano('error while checking for duplicates; a person will look at it');
  }
}
