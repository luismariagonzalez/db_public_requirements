// Parseo y validación de los parámetros de búsqueda. Puro: recibe el objeto de
// query (de Vercel o de URLSearchParams) y devuelve filtros limpios o un error.

const SLUG = /^[a-z0-9][a-z0-9_-]{1,59}$/;
import { CLASES } from './umbral.mjs';
const ORDENES = ['priority', 'copies', 'relevance'];
const TIPOS_TEST = ['unit', 'integration', 'e2e', 'security', 'performance', 'accessibility', 'manual'];
const MODELOS = ['open_source', 'proprietary', 'saas'];
const ESTADOS = ['planned', 'in_progress', 'done', 'skipped'];
const INCLUDES = ['tests', 'accelerators'];

export const lista = (v) => (Array.isArray(v) ? v : [v])
  .filter((x) => x != null)
  .flatMap((x) => String(x).split(','))
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

function numero(v, def, min, max, nombre) {
  if (v == null || v === '') return { v: def };
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${nombre}: integer from ${min} to ${max}` };
  return { v: n };
}

// Trozo común: category, q, limit.
function comun(query) {
  const categorias = lista(query.category);
  if (categorias.length > 12 || categorias.some((c) => !SLUG.test(c)))
    return { error: 'category: up to 12 valid slugs, comma separated' };
  const q = String(Array.isArray(query.q) ? query.q[0] : query.q ?? '').trim();
  if (q.length > 300) return { error: 'q: at most 300 characters' };
  const l = numero(query.limit, 50, 1, 200, 'limit');
  if (l.error) return { error: l.error };
  return { categorias, q, limite: l.v };
}

export function parseFiltros(query = {}) {
  const c = comun(query);
  if (c.error) return { error: c.error };

  const clases = lista(query.kind);
  if (clases.some((x) => !CLASES.includes(x))) return { error: `kind: one of ${CLASES.join(', ')}` };

  const p = numero(query.max_priority, 5, 1, 5, 'max_priority');
  if (p.error) return { error: p.error };

  const orden = lista(query.sort)[0] ?? null;
  if (orden && !ORDENES.includes(orden)) return { error: `sort: ${ORDENES.join(' | ')}` };

  const formato = String(query.format ?? 'json').toLowerCase();
  if (!['json', 'md'].includes(formato)) return { error: 'format: json or md' };

  const include = lista(query.include);
  if (include.some((x) => !INCLUDES.includes(x))) return { error: `include: ${INCLUDES.join(', ')}` };

  const t = numero(query.tests_max_priority, 5, 1, 5, 'tests_max_priority');
  if (t.error) return { error: t.error };

  const ocultar = lista(query.hide);
  if (ocultar.some((x) => !ESTADOS.includes(x))) return { error: `hide: ${ESTADOS.join(', ')}` };

  const proyecto = proyectoId(query.project);
  if (proyecto.error) return { error: proyecto.error };

  return { ok: true, categorias: c.categorias, clases, prioridadMax: p.v, orden, q: c.q, formato, limite: c.limite,
    incluirTests: include.includes('tests'), incluirAceleradores: include.includes('accelerators'),
    testsMax: t.v, ocultar, proyecto: proyecto.v };
}

export function proyectoId(v) {
  if (v == null || v === '') return { v: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) return { error: 'project: positive integer id' };
  return { v: n };
}

export function parseFiltrosTests(query = {}) {
  const c = comun(query);
  if (c.error) return { error: c.error };
  const p = numero(query.max_priority, 5, 1, 5, 'max_priority');
  if (p.error) return { error: p.error };
  const tipos = lista(query.type);
  if (tipos.some((x) => !TIPOS_TEST.includes(x))) return { error: `type: one of ${TIPOS_TEST.join(', ')}` };
  return { ok: true, categorias: c.categorias, q: c.q, limite: c.limite, prioridadMax: p.v, tipos };
}

export function parseFiltrosAceleradores(query = {}) {
  const c = comun(query);
  if (c.error) return { error: c.error };
  const modelos = lista(query.model);
  if (modelos.some((x) => !MODELOS.includes(x))) return { error: `model: one of ${MODELOS.join(', ')}` };
  const plataformas = lista(query.platform);
  if (plataformas.length > 8 || plataformas.some((x) => !/^[a-z0-9._+#-]{1,30}$/.test(x)))
    return { error: 'platform: up to 8 simple names, comma separated (e.g. javascript,python,any)' };
  return { ok: true, categorias: c.categorias, q: c.q, limite: c.limite, modelos, plataformas };
}
