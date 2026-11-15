// Jerarquía de categorías: audiencia → dominio → categoría «hoja».
//
// Los requisitos cuelgan de las hojas (tipos de app, categorías de software,
// pantallas, transversales). Pedir una audiencia (b2b) o un dominio (finanzas) se
// EXPANDE aquí a las hojas que contiene, y la búsqueda sigue filtrando por hojas.
// Puro salvo la caché; la lista de categorías cambia poco, así que vive unos minutos
// en memoria de la función.

import { rpc } from './bd.mjs';

const TTL_MS = 5 * 60_000;
let cache = { hasta: 0, valor: null };

export async function cargarCategorias(deps = { rpc }) {
  if (cache.valor && Date.now() < cache.hasta) return cache.valor;
  cache = { valor: await deps.rpc('categorias'), hasta: Date.now() + TTL_MS };
  return cache.valor;
}
export const olvidarCategorias = () => { cache = { hasta: 0, valor: null }; };

// Un slug inexistente que no casa con nada hace que la búsqueda dé vacío (en vez de
// quitar el filtro y devolver todo): un conjunto vacío nunca debe significar «sin filtro».
export const NINGUNA = '__ninguna__';

export function expandir(pedidas, categorias) {
  const por = new Map(categorias.map((c) => [c.slug, c]));
  const desconocidas = pedidas.filter((s) => !por.has(s));
  const salida = new Set();
  for (const s of pedidas) {
    const c = por.get(s);
    if (!c) continue;
    if (c.type === 'audience') {
      for (const h of categorias) if (h.audiences?.includes(s) && h.type !== 'audience' && h.type !== 'domain') salida.add(h.slug);
    } else if (c.type === 'domain') {
      for (const h of categorias) if (h.domain === s) salida.add(h.slug);
    } else salida.add(s);
  }
  return { slugs: salida.size ? [...salida].slice(0, 1500) : [NINGUNA], desconocidas };
}

// Audiencias y dominios elegidos juntos (b2b + finanzas) son un Y, no un O: las hojas
// que cumplen las dos. Varios del mismo tipo siguen siendo un O (b2b o b2c).
export function expandirCombinado(pedidas, categorias) {
  const por = new Map(categorias.map((c) => [c.slug, c]));
  const aud = pedidas.filter((s) => por.get(s)?.type === 'audience');
  const dom = pedidas.filter((s) => por.get(s)?.type === 'domain');
  const hojas = pedidas.filter((s) => por.has(s) && !['audience', 'domain'].includes(por.get(s).type));
  const desconocidas = pedidas.filter((s) => !por.has(s));
  if (!(aud.length && dom.length)) return expandir(pedidas, categorias);

  const deAud = new Set(expandir(aud, categorias).slugs);
  const deDom = new Set(expandir(dom, categorias).slugs);
  const cruce = [...deAud].filter((s) => deDom.has(s));
  const salida = new Set([...cruce, ...hojas]);
  return { slugs: salida.size ? [...salida].slice(0, 1500) : [NINGUNA], desconocidas };
}
