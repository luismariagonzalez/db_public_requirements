// Lógica pura de la página (sin document ni fetch): construye la URL de la API
// a partir de los filtros elegidos. Se prueba en tests/consulta.test.mjs.

export function paramsDe({ q = '', prio = 5, cats = [], formato = 'json', limite = 50,
  incluirTests = false, incluirAceleradores = false, proyecto = null, ocultarHecho = false } = {}) {
  const p = new URLSearchParams();
  if (cats.length) p.set('category', cats.join(','));
  if (prio < 5) p.set('max_priority', String(prio));
  if (q.trim()) p.set('q', q.trim());
  if (formato === 'md') p.set('format', 'md');
  if (limite !== 50) p.set('limit', String(limite));
  const inc = [incluirTests && 'tests', incluirAceleradores && 'accelerators'].filter(Boolean);
  if (inc.length) p.set('include', inc.join(','));
  // Los tests siguen la misma prioridad máxima que los requisitos.
  if (incluirTests && prio < 5) p.set('tests_max_priority', String(prio));
  if (proyecto) {
    p.set('project', String(proyecto));
    if (ocultarHecho) p.set('hide', 'done');
  }
  return p;
}

export function rutaBusqueda(estado) {
  const qs = paramsDe(estado).toString();
  return '/api/v1/requirements' + (qs ? '?' + qs : '');
}

// ¿Hay algo que buscar? Sin texto ni categorías no se lanza nada.
export const hayFiltro = ({ q = '', cats = [], audiencias = [], dominios = [] }) =>
  q.trim().length > 0 || cats.length > 0 || audiencias.length > 0 || dominios.length > 0;

// Solo se pintan enlaces https: la base ya lo exige, pero la página no se fía.
export const urlSegura = (u) => (/^https:\/\/[^\s]+$/.test(String(u ?? '')) ? u : null);

// Audiencia y dominio son FILTROS DE NAVEGACIÓN: acotan la lista de categorías que se
// ve. Lo que se busca son las categorías «hoja» elegidas; solo si no se ha elegido
// ninguna se busca por la audiencia/dominio mismos (la API los expande a sus hojas).
export const categoriasEfectivas = ({ cats = [], audiencias = [], dominios = [] }) =>
  cats.length ? cats : [...audiencias, ...dominios];

// Lo que ve la lista de categorías según los filtros de navegación
// (audiencias: O entre ellas; dominio y texto: Y).
export function visibles(categorias, { audiencias = [], dominios = [], texto = '' } = {}) {
  const t = texto.trim().toLowerCase();
  return categorias.filter((c) =>
    (!audiencias.length || (c.audiences ?? []).some((a) => audiencias.includes(a)))
    && (!dominios.length || dominios.includes(c.domain))
    && (!t || `${c.name} ${c.slug}`.toLowerCase().includes(t)));
}

// Los dominios que tienen algo para las audiencias elegidas (para no enseñar dominios vacíos).
export function dominiosDisponibles(categorias, audiencias) {
  if (!audiencias.length) return null;
  return new Set(categorias.filter((c) => (c.audiences ?? []).some((a) => audiencias.includes(a)))
    .map((c) => c.domain).filter(Boolean));
}

export const GRUPOS = [
  ['app_type', 'App type'],
  ['screen_type', 'Screen type'],
  ['cross_cutting', 'Cross-cutting concerns'],
];
export const MAX_SOFTWARE = 60;

export const ESTADOS = [
  ['planned', 'Planned (roadmap)'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
  ['skipped', 'Skipped'],
];
