// El texto que se convierte en vector para un requisito. UNA sola función para todos los sitios
// que calculan el embedding de un requisito (semilla, aportes, reembebido), de modo que dos
// requisitos que significan lo mismo y cuelgan de las mismas etiquetas queden cerca, y los mapas
// y las búsquedas por significado «sepan» de qué tipo de app, tema y flujo va cada uno.
//
// Compone: título + enunciado + criterios + clase + TODAS sus categorías con su nombre legible,
// agrupadas por tipo, y las audiencias y dominios que se deducen de las hojas (una hoja cuelga de un
// dominio y sirve a varias audiencias). Pura: sin red ni base. El contenido de la base está en inglés,
// así que las etiquetas de los grupos también.

const GRUPOS = [
  ['app_type', 'App types'],
  ['software_category', 'Software categories'],
  ['cross_cutting', 'Cross-cutting concerns'],
  ['screen_type', 'Flows'],
];
const MAX_CRITERIOS = 12;
const MAX_CARACTERES = 3000;   // Gemini admite más; esto basta y mantiene el texto enfocado

// Acepta las dos formas en que llegan las categorías: la de la API / base
// ({slug, type, name, domain, audiences}) y la de semilla/categorias.json ({slug, tipo, nombre, dominio, audiencias}).
// También vale un objeto { slug: 'Nombre' } (sin tipo: caen en «Other tags»).
export function indexarCategorias(origen) {
  const por = new Map();
  if (origen instanceof Map) return origen;   // ya indexado
  if (Array.isArray(origen)) {
    for (const c of origen) {
      if (!c?.slug) continue;
      por.set(c.slug, { slug: c.slug, type: c.type ?? c.tipo, name: c.name ?? c.nombre ?? c.slug,
        domain: c.domain ?? c.dominio ?? null, audiences: c.audiences ?? c.audiencias ?? [] });
    }
    return por;
  }
  for (const [k, v] of Object.entries(origen ?? {})) por.set(k, typeof v === 'string' ? { slug: k, name: v } : v);
  return por;
}

const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const unicos = (lista) => [...new Set(lista)];
const porNombre = (a, b) => a.localeCompare(b, 'en');

// requisito: { title, statement, criteria[], kind, categories: [{slug, priority}] | [slug] }
export function textoParaEmbedding(requisito, categorias) {
  const r = requisito ?? {};
  const idx = indexarCategorias(categorias);   // en bucles, indexa una vez y pasa el Map: se reutiliza tal cual
  const slugs = unicos((r.categories ?? []).map((c) => (typeof c === 'string' ? c : c?.slug)).filter(Boolean)).sort();

  const nombreDe = (s) => limpio(idx.get(s)?.name ?? s.replace(/-/g, ' '));
  const grupos = new Map(GRUPOS.map(([t]) => [t, []]));
  const otros = [];
  for (const s of slugs) {
    const tipo = idx.get(s)?.type;
    if (['audience', 'domain'].includes(tipo)) continue;   // se tratan aparte
    (grupos.get(tipo) ?? otros).push(nombreDe(s));
  }

  // Audiencias y dominios: los de las hojas (y los que se hayan etiquetado a mano).
  const audiencias = new Set(), dominios = new Set();
  for (const s of slugs) {
    const c = idx.get(s);
    if (!c) continue;
    if (c.type === 'audience') audiencias.add(s);
    else if (c.type === 'domain') dominios.add(s);
    else {
      for (const a of c.audiences ?? []) audiencias.add(a);
      if (c.domain) dominios.add(c.domain);
    }
  }

  const criterios = (Array.isArray(r.criteria) ? r.criteria : []).map(limpio).filter(Boolean).slice(0, MAX_CRITERIOS);
  const lineas = [`${limpio(r.title)}. ${limpio(r.statement)}`];
  if (criterios.length) lineas.push(`Acceptance criteria: ${criterios.join('; ')}`);
  if (r.kind) lineas.push(`Kind: ${limpio(r.kind)}`);
  for (const [tipo, etiqueta] of GRUPOS) {
    const nombres = unicos(grupos.get(tipo)).sort(porNombre);
    if (nombres.length) lineas.push(`${etiqueta}: ${nombres.join(', ')}`);
  }
  if (otros.length) lineas.push(`Other tags: ${unicos(otros).sort(porNombre).join(', ')}`);
  if (dominios.size) lineas.push(`Domains: ${[...dominios].map(nombreDe).sort(porNombre).join(', ')}`);
  if (audiencias.size) lineas.push(`Audiences: ${[...audiencias].map(nombreDe).sort(porNombre).join(', ')}`);

  return lineas.join('\n').slice(0, MAX_CARACTERES);
}

// Versión del formato del texto: sube si cambia la composición de arriba (el reembebido la usa para
// saber qué requisitos tienen un vector «viejo»). Debe coincidir con el DEFAULT de requisito.embedding_v.
export const VERSION_TEXTO = 2;
