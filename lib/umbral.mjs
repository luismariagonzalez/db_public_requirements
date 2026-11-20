// Reglas puras de la revisión de aportes. Sin red, sin base: se prueban solas.
//
// Los umbrales de similitud son una estimación inicial. Calibrarlos con la
// semilla ya cargada: pedir similares de pares que SABES que son duplicados y de
// pares que no, y ajustar aquí.

export const UMBRAL = {
  duplicado: 0.93,        // ≥ esto: casi seguro el mismo requisito
  parecido: 0.80,         // entre este y el anterior: pregunta a la IA (paso 2)
  confianzaMinima: 0.6,   // por debajo, lo mira una persona
};

// Clase de un requisito: lo que el usuario puede hacer (functional) o cómo se construye y
// se opera el sistema (technical). El TEMA (seguridad, privacidad, accesibilidad…) NO es una
// clase: son las categorías transversales.
export const CLASES = ['functional', 'technical'];

export const MAX_ITEMS_POR_APORTE = 3;

export function decidirPorSimilitud(sim) {
  if (sim >= UMBRAL.duplicado) return 'duplicate';
  if (sim >= UMBRAL.parecido) return 'ask';
  return 'new';
}

const limpia = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Lo que devuelve la IA es entrada NO confiable: se valida entero aquí aunque
// venga con el esquema JSON, y lo que no encaja se descarta o se rechaza.
export function validarItem(raw, slugsValidos) {
  const title = limpia(raw?.title);
  const statement = limpia(raw?.statement);
  if (title.length < 5 || title.length > 120) return { ok: false, motivo: 'invalid title' };
  if (statement.length < 10 || statement.length > 1000) return { ok: false, motivo: 'invalid statement' };

  const criteria = (Array.isArray(raw?.criteria) ? raw.criteria : [])
    .map(limpia).filter((c) => c.length >= 3 && c.length <= 200).slice(0, 12);

  const kind = CLASES.includes(raw?.kind) ? raw.kind : 'functional';

  const vistas = new Set();
  const categories = [];
  for (const c of Array.isArray(raw?.categories) ? raw.categories : []) {
    const slug = limpia(c?.slug);
    if (!slugsValidos.has(slug) || vistas.has(slug)) continue;
    vistas.add(slug);
    const p = Number(c?.priority);
    categories.push({ slug, priority: Number.isInteger(p) && p >= 1 && p <= 5 ? p : 3 });
    if (categories.length === 8) break;
  }
  if (!categories.length) return { ok: false, motivo: 'no valid categories' };

  return { ok: true, item: { title, statement, criteria, kind, categories } };
}

// Una fusión nunca cambia una prioridad que ya existe (lo hace una persona).
// Si el aporte discrepa de una prioridad 1, es una discusión: a revisión humana.
export function conflictoPrioridad(existentes, propuestas) {
  const mapa = new Map((existentes ?? []).map((c) => [c.slug, c.priority]));
  return (propuestas ?? []).some((p) => mapa.get(p.slug) === 1 && p.priority !== 1);
}

// Categorías que el aporte trae y el requisito aún no tiene.
export function categoriasNuevas(existentes, propuestas) {
  const tiene = new Set((existentes ?? []).map((c) => c.slug));
  return (propuestas ?? []).filter((p) => !tiene.has(p.slug));
}

// Estado del aporte a partir de lo que pasó con cada ítem.
const ORDEN = ['needs_human', 'created', 'merged', 'rejected'];
export function estadoFinal(acciones) {
  const mapa = { needs_human: 'needs_human', created: 'created', merged: 'merged', rejected: 'rejected' };
  for (const e of ORDEN) if (acciones.some((a) => mapa[a] === e)) return e;
  return 'rejected';
}
