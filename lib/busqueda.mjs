// Búsqueda para la API: calcula (o recupera de caché) el embedding de la consulta
// y llama a la base. `deps` es inyectable para poder probarla sin red.

import { rpc } from './bd.mjs';
import { embed, aLiteral } from './gemini.mjs';
import { sha256 } from './http.mjs';
import { aplicarCupo } from './entrada.mjs';

const CUPO_EMBEDDINGS = { min: 120, dia: 5000 };   // global: protege la factura de Gemini
const DEPS = { rpc, embed, aplicarCupo };

// → { vec, degradado }. Sin q no hay vector. Si Gemini falla o se acaba el tope
// global, se busca solo por texto (degradado) en vez de dar error.
export async function vectorDeConsulta(q, res, deps = DEPS) {
  if (!q) return { vec: null, degradado: false };
  const hash = sha256(q.toLowerCase().replace(/\s+/g, ' '));
  try {
    const guardado = await deps.rpc('embedding_get', { p_hash: hash });
    if (guardado) return { vec: guardado, degradado: false };
    const permitido = res
      ? await deps.aplicarCupo(res, 'global|embed', CUPO_EMBEDDINGS.min, CUPO_EMBEDDINGS.dia, { silencioso: true })
      : true;
    if (!permitido) return { vec: null, degradado: true };
    const vec = aLiteral(await deps.embed(q, 'RETRIEVAL_QUERY'));
    await deps.rpc('embedding_put', { p_hash: hash, p_vec: vec }).catch(() => {});
    return { vec, degradado: false };
  } catch {
    return { vec: null, degradado: true };
  }
}

export async function buscar(filtros, res, deps = DEPS) {
  const { vec, degradado } = await vectorDeConsulta(filtros.q, res, deps);
  const r = await deps.rpc('buscar', {
    p_vec: vec,
    p_texto: filtros.q || null,
    p_categorias: filtros.categorias.length ? filtros.categorias : null,
    p_prioridad_max: filtros.prioridadMax,
    p_clases: filtros.clases.length ? filtros.clases : null,
    p_limite: filtros.limite,
    p_orden: filtros.orden ?? null,
    // país: la API ya lo ha expandido a sus ámbitos superiores (ES → ES, EU)
    p_paises: filtros.paisesExpandidos?.length ? filtros.paisesExpandidos : null,
    p_solo_pais: Boolean(filtros.soloPais),
    p_desde: filtros.desde ?? 0,
  });
  // la 0012 devuelve {total, items}; una base sin ella, la lista tal cual
  const items = Array.isArray(r) ? r : (r?.items ?? []);
  const total = Array.isArray(r) ? null : (r?.total ?? null);
  return { items, total, degradado };
}

export async function buscarTests(filtros, res, deps = DEPS) {
  const { vec, degradado } = await vectorDeConsulta(filtros.q, res, deps);
  const items = await deps.rpc('buscar_tests', {
    p_vec: vec,
    p_texto: filtros.q || null,
    p_categorias: filtros.categorias.length ? filtros.categorias : null,
    p_prioridad_max: filtros.prioridadMax,
    p_tipos: filtros.tipos.length ? filtros.tipos : null,
    p_limite: filtros.limite,
  });
  return { items, degradado };
}

export async function buscarAceleradores(filtros, res, deps = DEPS) {
  const { vec, degradado } = await vectorDeConsulta(filtros.q, res, deps);
  const items = await deps.rpc('buscar_aceleradores', {
    p_vec: vec,
    p_texto: filtros.q || null,
    p_categorias: filtros.categorias.length ? filtros.categorias : null,
    p_modelos: filtros.modelos.length ? filtros.modelos : null,
    p_plataformas: filtros.plataformas.length ? filtros.plataformas : null,
    p_limite: filtros.limite,
    p_orden: filtros.orden ?? null,
  });
  return { items, degradado };
}
