// Reglas PURAS de la revisión de tests y aceleradores (y la parte común a requisitos):
// validar lo que devuelve la IA, detectar inyección de prompt a mano y decidir
// qué hacer con el análisis. Sin red ni base: se prueban solas. La IA propone, el
// código dispone: nada de lo que diga el modelo se acepta sin pasar por aquí.

import { UMBRAL } from './umbral.mjs';
import { CODIGOS_RECHAZO, NIVELES_RIESGO, RIESGO_POR_CODIGO, TIPOS_TEST, MODELOS_ACELERADOR,
  COSTES_ACELERADOR, COBERTURAS } from './prompts_revision.mjs';

export const MAX_REQ_TEST = 8;
export const MAX_REQ_ACELERADOR = 20;

const limpia = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Segunda red de seguridad contra inyección: frases típicas en inglés y español. No sustituye
// al prompt (que también la detecta): si salta, el aporte nunca se publica solo.
const PATRONES_INYECCION = [
  /ignor(a|e|ar|en)\s+(\w+\s+){0,3}(instruccion(es)?|reglas|indicaciones|prompt)/i,
  /(olvida|olvide|omite|salta(te)?)\s+(\w+\s+){0,3}(instruccion(es)?|reglas|anterior(es)?)/i,
  /ignore\s+(\w+\s+){0,4}(instructions?|rules|prompts?|guidelines|polic(y|ies))/i,
  /disregard\s+(\w+\s+){0,4}(instructions?|rules|prompts?|polic(y|ies))/i,
  /forget\s+(\w+\s+){0,3}(instructions?|rules|everything)/i,
  /(aprueba|aprobar|acepta|acepte)\s+(esto|este|esta|el aporte|sin)/i,
  /\b(approve|accept)\s+(this|it|the\s+contribution)\b/i,
  /(system|developer)\s*(prompt|message)|prompt\s+del\s+sistema/i,
  /(reveal|show|print|muestra|revela)\s+(\w+\s+){0,3}(prompt|instructions|instrucciones)/i,
  /you\s+are\s+now\b|a\s+partir\s+de\s+ahora\s+(eres|act[uú]a)|\bact\s+as\b|\bact[uú]a\s+como\b/i,
  /["']?verdict["']?\s*[:=]\s*["']?accept|["']?injection_detected["']?\s*[:=]/i,
  /\bjailbreak\b|\bDAN\s+mode\b|developer\s+mode/i,
];
export function detectarInyeccion(texto) {
  const t = String(texto ?? '');
  return PATRONES_INYECCION.some((r) => r.test(t));
}

// ───────────────────────────────────────────────────────── análisis del modelo
const num01 = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };

// Normaliza los campos comunes del análisis (el modelo puede devolver cualquier cosa).
export function normalizarAnalisis(raw) {
  const verdict = raw?.verdict === 'accept' ? 'accept' : 'reject';
  let codigo = CODIGOS_RECHAZO.includes(raw?.reject_code) ? raw.reject_code : 'none';
  if (verdict === 'reject' && codigo === 'none') codigo = 'not_an_item';
  if (verdict === 'accept') codigo = 'none';
  let riesgo = NIVELES_RIESGO.includes(raw?.risk_level) ? raw.risk_level : 'low';
  // Si el modelo rechaza por un motivo grave pero declara poco riesgo, manda el motivo.
  const piso = RIESGO_POR_CODIGO[codigo];
  if (piso && NIVELES_RIESGO.indexOf(piso) > NIVELES_RIESGO.indexOf(riesgo)) riesgo = piso;
  return {
    verdict, codigo, riesgo,
    razon: limpia(raw?.reason).slice(0, 300),
    confianza: num01(raw?.confidence),
    inyeccion: raw?.injection_detected === true,
    idioma: limpia(raw?.source_language).slice(0, 20),
  };
}

// ¿Qué hacemos con el análisis? → { accion: 'rejected' | 'needs_human' | 'continue', codigo, razon, riesgo }
//   · rechazo del modelo → rejected
//   · riesgo alto → rejected aunque el modelo diga accept
//   · riesgo medio, inyección (del modelo o detectada a mano) o poca confianza → needs_human
export function decidirAnalisis(a, { inyeccionTexto = false } = {}) {
  const inyeccion = a.inyeccion || inyeccionTexto;
  if (a.verdict === 'reject')
    return { accion: 'rejected', codigo: a.codigo, riesgo: a.riesgo, inyeccion, razon: a.razon || 'it does not meet the contribution policy' };
  if (a.riesgo === 'high')
    return { accion: 'rejected', codigo: a.codigo === 'none' ? 'harmful' : a.codigo, riesgo: 'high', inyeccion,
      razon: a.razon || 'it does not meet the contribution policy' };
  if (a.riesgo === 'medium')
    return { accion: 'needs_human', codigo: 'none', riesgo: 'medium', inyeccion, razon: 'a person will check it before it is published' };
  if (inyeccion)
    return { accion: 'needs_human', codigo: 'prompt_injection', riesgo: 'medium', inyeccion,
      razon: 'the text contains instructions aimed at the reviewer; a person will check it' };
  if (a.confianza < UMBRAL.confianzaMinima)
    return { accion: 'needs_human', codigo: 'unclear', riesgo: a.riesgo, inyeccion, razon: 'low confidence in the automatic review' };
  return { accion: 'continue', codigo: 'none', riesgo: a.riesgo, inyeccion, razon: '' };
}

// ───────────────────────────────────────────────────────── elementos
const unicosSlugs = (lista, validos, max) => {
  const vistos = new Set(); const sal = [];
  for (const s of Array.isArray(lista) ? lista : []) {
    const slug = limpia(typeof s === 'string' ? s : s?.slug);
    if (!validos.has(slug) || vistos.has(slug)) continue;
    vistos.add(slug); sal.push(slug);
    if (sal.length === max) break;
  }
  return sal;
};

// `slugsValidos`: Set de requisitos que EXISTEN (los que la persona enlazó y la base confirmó).
export function validarTest(raw, slugsValidos) {
  const title = limpia(raw?.title);
  const scenario = limpia(raw?.scenario);
  if (title.length < 5 || title.length > 120) return { ok: false, motivo: 'invalid title' };
  if (scenario.length < 10 || scenario.length > 800) return { ok: false, motivo: 'invalid scenario' };
  const type = TIPOS_TEST.includes(raw?.type) ? raw.type : 'manual';
  const p = Number(raw?.priority);
  const priority = Number.isInteger(p) && p >= 1 && p <= 5 ? p : 3;
  const requirements = unicosSlugs(raw?.requirements, slugsValidos, MAX_REQ_TEST);
  if (!requirements.length) return { ok: false, motivo: 'a test must verify at least one existing requirement' };
  return { ok: true, item: { title, scenario, type, priority, requirements } };
}

export function validarAcelerador(raw, slugsValidos, urlValida) {
  const name = limpia(raw?.name);
  const description = limpia(raw?.description);
  if (name.length < 2 || name.length > 80) return { ok: false, motivo: 'invalid name' };
  if (description.length < 10 || description.length > 600) return { ok: false, motivo: 'invalid description' };
  const model = MODELOS_ACELERADOR.includes(raw?.model) ? raw.model : 'saas';
  const cost = COSTES_ACELERADOR.includes(raw?.cost) ? raw.cost : 'freemium';
  const platforms = [...new Set((Array.isArray(raw?.platforms) ? raw.platforms : [])
    .map((x) => limpia(x).toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9+#._-]{0,23}$/.test(x)))].slice(0, 12);
  const vistos = new Set(); const requirements = [];
  for (const r of Array.isArray(raw?.requirements) ? raw.requirements : []) {
    const slug = limpia(r?.slug);
    if (!slugsValidos.has(slug) || vistos.has(slug)) continue;
    vistos.add(slug);
    requirements.push({ slug, coverage: COBERTURAS.includes(r?.coverage) ? r.coverage : 'partial' });
    if (requirements.length === MAX_REQ_ACELERADOR) break;
  }
  if (!requirements.length) return { ok: false, motivo: 'an accelerator must help with at least one existing requirement' };
  // La URL final es la que comprobó el código (el modelo solo puede quitarle parámetros, no cambiarla).
  return { ok: true, item: { name, description, model, cost, url: urlValida, platforms, requirements } };
}

// Quita parámetros de seguimiento/afiliado de una URL ya validada (utm_*, ref, aff…).
export function limpiarUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|ref$|ref_|aff|affiliate|campaign|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch { return url; }
}

// Un test fusionado no cambia su prioridad. Si la persona propone otra para un test P1 existente,
// es una discusión: a revisión humana (igual que con los requisitos).
export function conflictoPrioridadTest(existente, propuesto) {
  return Number(existente?.priority) === 1 && Number(propuesto?.priority) !== 1;
}

// Requisitos que la propuesta enlaza y el elemento existente aún no.
export const enlacesNuevosTest = (existente, item) =>
  item.requirements.filter((s) => !(existente.requirements ?? []).includes(s));
export const enlacesNuevosAcelerador = (existente, item) => {
  const tiene = new Set((existente.requirements ?? []).map((r) => r.slug));
  return item.requirements.filter((r) => !tiene.has(r.slug));
};
// Un test no admite más de 8 requisitos ni un acelerador más de 20.
export const cabenEnlaces = (tipo, existente, nuevos) =>
  (existente.requirements?.length ?? 0) + nuevos.length <= (tipo === 'test' ? MAX_REQ_TEST : MAX_REQ_ACELERADOR);
