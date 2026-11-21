// Convierte requisitos en el Markdown que se le pega al agente. Puro y sin
// dependencias: lo usan la API (format=md y /export) y la web lo pide a ese
// endpoint, así que el Markdown es idéntico en los dos sitios.

import { mensajeAgente } from './mensaje_agente.mjs';

export const ESCALA = [
  'P1 = essential: without it the app is broken or unsafe',
  'P2 = expected: users will notice it is missing',
  'P3 = recommended',
  'P4 = nice to have',
  'P5 = differentiator / extra',
];

const CABECERA = [
  'These requirements describe **what** the app must do, not **where** or **how** it is shown.',
  'Decisions about screens, layout, placement and UI are yours.',
  'Priority scale: ' + ESCALA.join('; ') + '.',
];

const MODELO = { open_source: 'open source', proprietary: 'proprietary', saas: 'SaaS' };
const COSTE = { free: 'free', freemium: 'freemium', paid: 'paid' };

// Cada requisito va bajo UNA categoría: la que le da su mejor prioridad entre
// las pedidas (o entre todas, si no se pidió ninguna). Así no se repite.
function categoriaDe(item, pedidas) {
  const cats = (item.categories ?? []).filter((c) => !pedidas.length || pedidas.includes(c.slug));
  const orden = [...cats].sort((a, b) =>
    a.priority - b.priority
    || (pedidas.length ? pedidas.indexOf(a.slug) - pedidas.indexOf(b.slug) : a.slug.localeCompare(b.slug)));
  return orden[0]?.slug ?? 'other';
}

const sl = (x) => (x.slug ? '  `' + x.slug + '`' : '');
const caja = (estado) => (estado === 'done' ? '[x]' : '[ ]');
const etiquetaEstado = (estado) => (estado && estado !== 'done' ? ` _(project: ${estado.replace('_', ' ')})_` : '');

// opciones:
//   nombres      slug de categoría → nombre
//   categorias   las categorías pedidas (para ordenar y agrupar)
//   proyecto     { id, name } si la petición va ligada a un proyecto
//   base         URL base de la API, para el mensaje al agente
//   sinMensaje   true para omitir las instrucciones al agente
//   paises       países pedidos (['ES']): cada requisito lleva SOLO los matices de lo que trae en `jurisdictions`
//   paisesNombres código → nombre (para la cabecera)
export const AVISO_LEGAL = 'Legal duties listed here are informational guidance, not legal advice: always verify the current text of each cited norm in the official source.';

// Una línea por jurisdicción: matiz (qué cambia allí) y fuente (norma, URL, fecha de la versión, entrada en vigor).
export function lineaJurisdiccion(j) {
  const fuente = j.source ?? {};
  const partes = [fuente.norm, fuente.url, fuente.date ? `text as of ${fuente.date}` : null].filter(Boolean);
  const pendiente = j.status === 'upcoming' && fuente.in_force_from ? ` Not yet in force: applies from ${fuente.in_force_from}.` : '';
  const texto = j.note ?? 'Applies as stated above.';
  return `  - **${j.code}${j.name ? ` (${j.name})` : ''}:** ${texto}${pendiente}${partes.length ? ` _Source: ${partes.join('; ')}._` : ''}`;
}

export function renderMarkdown(items, { nombres = {}, categorias = [], titulo = 'Requirements for your agent',
  proyecto = null, base, sinMensaje = false, paises = [], paisesNombres = {} } = {}) {
  const grupos = new Map();
  for (const it of items) {
    const g = categoriaDe(it, categorias);
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(it);
  }
  const orden = [...grupos.keys()].sort((a, b) => {
    const ia = categorias.indexOf(a), ib = categorias.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const hayJurisdiccion = items.some((it) => it.jurisdictions?.length);
  const cab = [...CABECERA];
  if (paises.length) cab.push(`Jurisdiction: ${paises.map((c) => (paisesNombres[c] ? `${c} (${paisesNombres[c]})` : c)).join(', ')}. Country notes appear only for the jurisdiction(s) requested.`);
  if (hayJurisdiccion) cab.push(AVISO_LEGAL);
  const out = [`# ${titulo}`, '', ...cab.map((l) => `> ${l}`), ''];
  const aceleradores = new Map();   // slug → { acc, ayuda: [títulos] }

  for (const g of orden) {
    out.push(`## ${nombres[g] ?? g}`, '');
    const lista = grupos.get(g).sort((a, b) => a.priority - b.priority || (b.copies ?? 0) - (a.copies ?? 0) || a.title.localeCompare(b.title));
    for (const it of lista) {
      out.push(`- ${caja(it.project_status)} **(P${it.priority}) ${it.title}**: ${it.statement}${etiquetaEstado(it.project_status)}${sl(it)}`);
      for (const c of it.criteria ?? []) out.push(`  - ${c}`);
      // Sin país pedido no hay matices: `jurisdictions` trae solo códigos y nombres, y no se pinta nada.
      for (const j of it.jurisdictions ?? []) if (j.note || j.source) out.push(lineaJurisdiccion(j));
      if (!paises.length && it.jurisdictions?.length)
        out.push(`  - _Jurisdictions: ${it.jurisdictions.map((j) => j.code).join(', ')}. Ask for a country to get its specific note._`);
      for (const t of it.tests ?? [])
        out.push(`  - ${caja(t.project_status)} **Test (P${t.priority} · ${t.type}):** ${t.title}: ${t.scenario}`
          + `${etiquetaEstado(t.project_status)}${sl(t)}`);
      for (const a of it.accelerators ?? []) {
        if (!aceleradores.has(a.slug)) aceleradores.set(a.slug, { acc: a, ayuda: [] });
        aceleradores.get(a.slug).ayuda.push(it.title);
      }
    }
    out.push('');
  }

  if (aceleradores.size) {
    out.push('## Accelerators (optional: libraries and services to implement this faster)', '');
    for (const { acc, ayuda } of aceleradores.values()) {
      out.push(`- ${caja(acc.project_status)} **${acc.name}** (${MODELO[acc.model] ?? acc.model} · ${COSTE[acc.cost] ?? acc.cost}) ${acc.url}`
        + `${etiquetaEstado(acc.project_status)}${sl(acc)}`);
      out.push(`  - helps with: ${[...new Set(ayuda)].join('; ')}`);
    }
    out.push('');
  }

  if (!sinMensaje) out.push(mensajeAgente({ base, proyecto }));
  out.push(`<!-- ${items.length} requirement(s). Content: Requirements DB${base ? ', ' + base + '/terms.html' : ''} -->`, '');
  return out.join('\n');
}
