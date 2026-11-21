// Validación (pura) de las herramientas de semilla, con las mismas reglas que la tabla
// `herramienta` (migración 0010). La usan scripts/sembrar_herramientas.mjs y los tests.

export const CATEGORIAS_HERRAMIENTA = ['framework', 'library', 'auth', 'payments', 'database', 'backend', 'cms', 'ecommerce',
  'devops', 'ai', 'analytics', 'communication', 'storage', 'other'];

const HTTPS = /^https:\/\/[^\s]+$/;

// Devuelve la lista de problemas ([] si está bien).
export function validarHerramienta(h) {
  const p = [];
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(h?.slug ?? '')) p.push('slug no válido');
  if (!h?.nombre || h.nombre.length > 80) p.push('nombre: 1-80 caracteres');
  if (!CATEGORIAS_HERRAMIENTA.includes(h?.categoria)) p.push(`categoria: ${CATEGORIAS_HERRAMIENTA.join(' | ')}`);
  if ((h?.descripcion ?? '').length > 300) p.push('descripcion: máximo 300 caracteres');
  for (const campo of ['url_codigo', 'url_docs'])
    if (h?.[campo] != null && !HTTPS.test(h[campo])) p.push(`${campo}: debe ser https`);
  if (!h?.url_codigo && !h?.url_docs) p.push('hace falta url_codigo o url_docs');
  if (h?.plataformas != null && !(Array.isArray(h.plataformas) && h.plataformas.every((x) => typeof x === 'string'))) p.push('plataformas: lista de textos');
  return p;
}

// Valida todo el fichero: lista de { slug, problemas } y slugs repetidos.
export function validarLista(lista) {
  if (!Array.isArray(lista)) return [{ slug: '(fichero)', problemas: ['debe ser una lista'] }];
  const vistos = new Set(), fallos = [];
  for (const h of lista) {
    const problemas = validarHerramienta(h);
    if (vistos.has(h?.slug)) problemas.push('slug repetido');
    vistos.add(h?.slug);
    if (problemas.length) fallos.push({ slug: h?.slug ?? '(sin slug)', problemas });
  }
  return fallos;
}
