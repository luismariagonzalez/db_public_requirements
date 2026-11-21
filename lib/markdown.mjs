// Convierte requisitos en el Markdown que se le pega al agente. Puro y sin
// dependencias: lo usan la API (format=md y /export) y la web lo pide a ese
// endpoint, así que el Markdown es idéntico en los dos sitios.

import { mensajeAgente } from './mensaje_agente.mjs';
import { textoCompacto } from '../web/metricas.js';   // puro; vive en web/ porque la web lo publica tal cual

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
export function renderMarkdown(items, { nombres = {}, categorias = [], titulo = 'Requirements for your agent',
  proyecto = null, base, sinMensaje = false } = {}) {
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

  const out = [`# ${titulo}`, '', ...CABECERA.map((l) => `> ${l}`), ''];
  const aceleradores = new Map();   // slug → { acc, ayuda: [títulos] }

  for (const g of orden) {
    out.push(`## ${nombres[g] ?? g}`, '');
    const lista = grupos.get(g).sort((a, b) => a.priority - b.priority || (b.copies ?? 0) - (a.copies ?? 0) || a.title.localeCompare(b.title));
    for (const it of lista) {
      out.push(`- ${caja(it.project_status)} **(P${it.priority}) ${it.title}**: ${it.statement}${etiquetaEstado(it.project_status)}${sl(it)}`);
      for (const c of it.criteria ?? []) out.push(`  - ${c}`);
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
      const pop = textoCompacto(acc);
      out.push(`- ${caja(acc.project_status)} **${acc.name}** (${MODELO[acc.model] ?? acc.model} · ${COSTE[acc.cost] ?? acc.cost}${pop ? ' · ' + pop : ''}) ${acc.url}`
        + `${etiquetaEstado(acc.project_status)}${sl(acc)}`);
      out.push(`  - helps with: ${[...new Set(ayuda)].join('; ')}`);
    }
    out.push('');
  }

  if (!sinMensaje) out.push(mensajeAgente({ base, proyecto }));
  out.push(`<!-- ${items.length} requirement(s). Content: Requirements DB${base ? ', ' + base + '/terms.html' : ''} -->`, '');
  return out.join('\n');
}
