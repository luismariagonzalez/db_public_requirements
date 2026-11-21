// Lógica pura de la página (sin document ni fetch): construye la URL de la API
// a partir de los filtros elegidos. Se prueba en tests/consulta.test.mjs.

export function paramsDe({ q = '', prio = 5, cats = [], formato = 'json', limite = 50,
  incluirTests = false, incluirAceleradores = false, proyecto = null, ocultarHecho = false, kinds = [], orden = null,
  paises = [], soloPais = false } = {}) {
  const p = new URLSearchParams();
  if (cats.length) p.set('category', cats.join(','));
  // país: solo lo que aplica allí, con el matiz de ese país (los genéricos siguen salvo soloPais)
  if (paises.length) { p.set('country', paises.join(',')); if (soloPais) p.set('country_only', '1'); }
  if (prio < 5) p.set('max_priority', String(prio));
  if (kinds.length) p.set('kind', kinds.join(','));
  if (orden) p.set('sort', orden);
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
export const hayFiltro = ({ q = '', cats = [], audiencias = [], dominios = [], paises = [] }) =>
  q.trim().length > 0 || cats.length > 0 || audiencias.length > 0 || dominios.length > 0 || paises.length > 0;

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

// Clase de requisito: lo que se puede hacer (functional) o cómo se construye y se opera (technical).
export const CLASES = ['functional', 'technical'];
// Orden de la lista: '' (por defecto: relevancia con texto, prioridad sin él), prioridad o más copiados.
export const ORDENES = ['priority', 'copies'];
// Familias de los flujos (tipo screen_type), en el orden en que se enseñan.
export const FAMILIAS = ['account', 'discover', 'buy', 'manage', 'attract'];

// Los flujos agrupados por familia: [[familia, [categoría…]], …]. Una familia desconocida va al final.
export function flujosPorFamilia(categorias) {
  const flujos = categorias.filter((c) => c.type === 'screen_type');
  const orden = [...FAMILIAS, ...new Set(flujos.map((c) => c.family).filter((f) => f && !FAMILIAS.includes(f)))];
  return orden.map((f) => [f, flujos.filter((c) => c.family === f)]).filter(([, l]) => l.length);
}

// Lo que está activo, como lista de «chips» con su ×. Cada chip dice qué quitar.
export function chipsActivos(e, categorias = []) {
  const por = new Map(categorias.map((c) => [c.slug, c]));
  const nombre = (s) => por.get(s)?.name ?? s;
  const chips = [];
  for (const a of e.audiencias ?? []) chips.push({ tipo: 'audiencia', valor: a, texto: nombre(a) });
  for (const d of e.dominios ?? []) chips.push({ tipo: 'dominio', valor: d, texto: nombre(d) });
  for (const c of e.cats ?? []) chips.push({ tipo: 'cat', valor: c, texto: nombre(c) });
  for (const k of e.kinds ?? []) chips.push({ tipo: 'clase', valor: k, texto: k });
  for (const c of e.paises ?? []) chips.push({ tipo: 'pais', valor: c, texto: c });
  if ((e.prio ?? 5) < 5) chips.push({ tipo: 'prio', valor: e.prio, texto: `P1–P${e.prio}` });
  if ((e.q ?? '').trim()) chips.push({ tipo: 'q', valor: e.q.trim(), texto: `“${e.q.trim().slice(0, 30)}”` });
  if (e.orden) chips.push({ tipo: 'orden', valor: e.orden, texto: e.orden });
  return chips;
}

// Quita del estado lo que dice un chip (devuelve el mismo objeto, ya modificado).
export function quitarFiltro(e, chip) {
  const sin = (lista, v) => lista.filter((x) => x !== v);
  if (chip.tipo === 'audiencia') e.audiencias = sin(e.audiencias, chip.valor);
  else if (chip.tipo === 'dominio') e.dominios = sin(e.dominios, chip.valor);
  else if (chip.tipo === 'cat') e.cats = sin(e.cats, chip.valor);
  else if (chip.tipo === 'clase') e.kinds = sin(e.kinds, chip.valor);
  else if (chip.tipo === 'pais') { e.paises = sin(e.paises, chip.valor); if (!e.paises.length) e.soloPais = false; }
  else if (chip.tipo === 'prio') e.prio = 5;
  else if (chip.tipo === 'q') e.q = '';
  else if (chip.tipo === 'orden') e.orden = null;
  return e;
}

// «Borrar filtros»: quita lo que se busca y filtra. Se conservan las opciones de lo que viene
// con cada requisito (tests, aceleradores) y todo lo del proyecto.
export function limpiarFiltros(e) {
  Object.assign(e, { q: '', prio: 5, cats: [], audiencias: [], dominios: [], kinds: [], orden: null, filtroCat: '', paises: [], soloPais: false });
  return e;
}

export const contarFiltros = (e, categorias = []) => chipsActivos(e, categorias).length;

// Jurisdicciones que se pueden elegir: las que tienen requisitos (la UE se ofrece aparte de los países).
export const paisesElegibles = (jurisdicciones = []) => jurisdicciones.filter((j) => j.requirements > 0);

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
