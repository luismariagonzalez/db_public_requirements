// Cuadro de control (zona admin). Ruta conocida, no enlazada desde la web pública.
// Solo entra quien tenga sesión de Clerk con el sub en ADMIN_SUBS (lo decide la API, no esta página:
// aquí solo se enseña un 403 claro si la API lo dice). Todo el texto de la base se pinta con
// textContent (nunca se monta HTML con datos). Los textos de la interfaz viven en textos-admin-en.js / -es.js.
import { iniciar, idioma } from './i18n.js';
import { entrar, salir, token, usuario, cargarClerk, huboSesion, marcarSesion } from './clerk.js';
import { barras, apiladas, ticksX, resumenGrafica, total, formatoBytes, diaCorto } from './admin_graficas.js';
import en from './textos-admin-en.js';
import es from './textos-admin-es.js';

const D = { en, es };
const T = (k, v = {}) => (D[idioma()]?.[k] ?? D.en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
const $ = (s) => document.querySelector(s);
const BASE = new URL('./', location.href).pathname.replace(/\/$/, '');
const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...hijos.filter((h) => h != null && h !== false));
  return e;
}
function svg(tag, props = {}, ...hijos) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(props)) e.setAttribute(k, String(v));
  e.append(...hijos.filter((h) => h != null));
  return e;
}
const fechaHora = (d) => (d ? new Date(d).toLocaleString(idioma() === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const num = (n) => Number(n ?? 0).toLocaleString(idioma() === 'es' ? 'es-ES' : 'en-GB');

let tAviso;
function avisar(msg, mal = false) {
  const a = $('#aviso'); a.textContent = msg; a.hidden = false; a.classList.toggle('mal', mal);
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 5000);
}

async function api(metodo, ruta, cuerpo) {
  const cab = {};
  if (cuerpo) cab['content-type'] = 'application/json';
  const tk = await token().catch(() => null);
  if (tk) cab.authorization = `Bearer ${tk}`;
  const r = await fetch(BASE + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined, cache: 'no-store' });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(datos?.error ?? `HTTP ${r.status}`); e.status = r.status; throw e; }
  return datos;
}
const msgError = (e) => (e.status === 429 ? T('err.429') : e.status === 403 ? T('err.403') : e.message);
const query = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };

// ── estado
const estado = { tab: 'overview', dias: 30, yo: null,
  aportes: { status: 'needs_human', requirement: '', who: '' }, sug: { status: 'new' }, prop: { status: 'pending' }, minScore: 40, historia: '' };
const TABS = ['overview', 'contributions', 'suggestions', 'split', 'panels', 'history', 'audit'];

// ═════════════════════════════════════════════ puerta (403 claro)
function pintarPuerta(tipo, extra = {}) {
  $('#panel').hidden = true;
  const p = $('#puerta'); p.hidden = false; p.replaceChildren();
  if (tipo === 'checking') { p.append(el('p', { class: 'nota', role: 'status' }, T('gate.checking'))); return; }
  if (tipo === '403') {
    p.append(el('h1', {}, T('gate.403.title')), el('p', {}, T('gate.403.text')));
    const acciones = el('div', { class: 'acciones' });
    if (extra.conSesion) acciones.append(el('button', { type: 'button', class: 'boton', onclick: async () => { await salir().catch(() => {}); marcarSesion(false); location.reload(); } }, T('gate.signout')));
    else acciones.append(el('button', { type: 'button', class: 'boton acento-b', onclick: () => entrar().catch((e) => avisar(e.message, true)) }, T('gate.signin')));
    acciones.append(el('a', { class: 'boton', href: './' }, T('gate.back')));
    p.append(acciones);
    return;
  }
  p.append(el('h1', {}, T(tipo === '429' ? 'gate.429.title' : 'gate.error.title')), el('p', {}, extra.msg ?? ''),
    el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'boton', onclick: () => arrancar() }, T('common.retry'))));
}

async function arrancar() {
  document.title = T('meta.title');
  pintarPuerta('checking');
  if (!huboSesion()) return pintarPuerta('403', { conSesion: false });
  try {
    await cargarClerk();
    window.Clerk.addListener?.(({ user }) => { marcarSesion(!!user); });
    const yo = await api('GET', '/api/admin/me');
    estado.yo = yo;
    $('#puerta').hidden = true; $('#panel').hidden = false;
    $('#yo').textContent = T('me.id', { id: yo.id });
    const hash = location.hash.slice(1);
    mostrarTab(TABS.includes(hash) ? hash : 'overview');
  } catch (e) {
    if (e.status === 403) pintarPuerta('403', { conSesion: !!(await usuario().catch(() => null)) });
    else if (e.status === 429) pintarPuerta('429', { msg: T('err.429') });
    else pintarPuerta('error', { msg: T('gate.error', { msg: e.message }) });
  }
}

// ═════════════════════════════════════════════ pestañas
function pintarPestanas() {
  const nav = $('#pestanas'); nav.replaceChildren();
  for (const id of TABS) {
    nav.append(el('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': String(id === estado.tab), 'aria-controls': 'vista',
      tabindex: id === estado.tab ? '0' : '-1', onclick: () => mostrarTab(id),
      onkeydown: (ev) => {
        const i = TABS.indexOf(estado.tab);
        const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (d) { ev.preventDefault(); mostrarTab(TABS[(i + d + TABS.length) % TABS.length]); $(`#tab-${estado.tab}`).focus(); }
      } }, T(`nav.${id}`)));
  }
}
const VISTAS = { overview: vistaResumen, contributions: vistaAportes, suggestions: vistaSugerencias, split: vistaDividir, panels: vistaPaneles, history: vistaHistorial, audit: vistaAuditoria };
function mostrarTab(id) {
  estado.tab = id;
  history.replaceState(null, '', `#${id}`);
  pintarPestanas();
  const v = $('#vista'); v.setAttribute('aria-labelledby', `tab-${id}`);
  v.replaceChildren(el('p', { class: 'nota', role: 'status' }, T('common.loading')));
  VISTAS[id]().catch((e) => v.replaceChildren(el('p', { class: 'error', role: 'alert' }, msgError(e)), el('button', { type: 'button', class: 'boton', onclick: () => mostrarTab(id) }, T('common.retry'))));
}
const rellenar = (...nodos) => $('#vista').replaceChildren(...nodos);
const estadoSel = (clave, valores, actual, etiqueta, alCambiar) =>
  el('label', { class: 'campo-et' }, el('span', {}, T(clave)),
    el('select', { class: 'campo', onchange: (ev) => alCambiar(ev.target.value) },
      ...valores.map((v) => el('option', { value: v, selected: v === actual ? 'selected' : false }, v === '' ? T('common.all') : etiqueta(v)))));

// ═════════════════════════════════════════════ resumen + gráficas
const METRICAS = [
  { id: 'read', val: (d) => d.counters.read ?? 0 }, { id: 'search', val: (d) => d.counters.search ?? 0 },
  { id: 'list', val: (d) => d.counters.list ?? 0 }, { id: 'copy', val: (d) => d.counters.copy ?? 0 },
  { id: 'export', val: (d) => d.counters.export ?? 0 }, { id: 'api_total', val: (d) => d.counters.api_total ?? 0 },
  { id: 'error_5xx', val: (d) => d.counters.error_5xx ?? 0, malo: true }, { id: 'rate_limited', val: (d) => d.counters.rate_limited ?? 0, malo: true },
  { id: 'suggestions', val: (d) => d.suggestions }, { id: 'keys_created', val: (d) => d.keys_created },
  { id: 'projects_created', val: (d) => d.projects_created }, { id: 'requirements_created', val: (d) => d.requirements_created },
];
const ESTADOS_APORTE = ['created', 'merged', 'rejected', 'needs_human', 'pending'];

function grafica({ titulo, dias, vals, filas, claves, malo }) {
  const ancho = 300, alto = 84;
  const g = filas ? apiladas(filas, claves, { ancho, alto }) : barras(vals, { ancho, alto });
  const totales = filas ? filas.map((f) => total(claves.map((k) => Number(f[k] ?? 0)))) : vals;
  const r = resumenGrafica(dias, totales);
  const texto = T('graf.resumen', { titulo, total: num(r.total), max: num(r.max), dia: r.diaMax ?? '—' });
  const s = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': texto, class: 'svg-graf', preserveAspectRatio: 'none' });
  s.append(svg('line', { x1: 0, x2: ancho, y1: alto - 14, y2: alto - 14, class: 'eje' }),
    svg('text', { x: 0, y: 9, class: 'etq' }, `max ${num(g.max)}`));
  for (const b of g.barras) {
    const tip = svg('title', {}, `${dias[b.i]}: ${num(b.v)}`);
    if (filas) {
      const gr = svg('g', {}, tip);
      for (const t of b.trozos) gr.append(svg('rect', { x: b.x, y: t.y, width: b.w, height: t.h, class: `barra-${t.k}` }));
      s.append(gr);
    } else s.append(svg('rect', { x: b.x, y: b.y, width: b.w, height: Math.max(b.h, 0), class: malo ? 'barra-mala' : 'barra-ok' }, tip));
  }
  for (const t of ticksX(dias, 3)) s.append(svg('text', { x: Math.min(Math.max(g.barras[t.i].x, 0), ancho - 24), y: alto - 2, class: 'etq' }, diaCorto(t.dia)));
  const fig = el('figure', { class: 'graf' }, el('figcaption', {}, el('strong', {}, titulo), el('span', { class: 'tenue mono' }, ` ${num(r.total)}`)), s);
  if (filas) fig.append(el('ul', { class: 'leyenda' }, ...claves.filter((k) => filas.some((f) => f[k] > 0)).map((k) => el('li', {}, el('i', { class: `punto barra-${k}` }), T(`ap.${k}`)))));
  return fig;
}

async function vistaResumen() {
  const [res, act] = await Promise.all([api('GET', '/api/admin/overview'), api('GET', `/api/admin/activity?days=${estado.dias}`)]);
  const kpi = (clave, valor, aviso) => el('div', { class: `kpi${aviso ? ' alerta' : ''}` }, el('div', { class: 'valor mono' }, valor), el('div', { class: 'etq-kpi' }, T(clave)));
  const nh = res.contributions.needs_human ?? 0, sn = res.suggestions.new ?? 0;
  const kpis = el('div', { class: 'kpis' },
    kpi('kpi.published', num(res.requirements.published)), kpi('kpi.archived', num(res.requirements.archived)),
    kpi('kpi.tests', num(res.tests)), kpi('kpi.accelerators', num(res.accelerators)), kpi('kpi.categories', num(res.categories)),
    kpi('kpi.copies', num(res.copies_total)), kpi('kpi.needs_human', num(nh), nh > 0), kpi('kpi.suggestions_new', num(sn), sn > 0),
    kpi('kpi.proposals', num(res.proposals_pending), res.proposals_pending > 0), kpi('kpi.keys', num(res.keys_active)),
    kpi('kpi.projects', num(res.projects)), kpi('kpi.db_size', formatoBytes(res.database_bytes)));

  const dias = act.series.map((d) => d.day);
  const rango = el('div', { class: 'segmentos-adm', role: 'group', 'aria-label': T('range.aria') },
    ...[30, 90].map((n) => el('button', { type: 'button', class: 'boton', 'aria-pressed': String(estado.dias === n), onclick: () => { estado.dias = n; mostrarTab('overview'); } }, T('range.days', { n }))));
  const graficas = el('div', { class: 'graficas' },
    grafica({ titulo: T('graf.contributions'), dias, filas: act.series.map((d) => d.contributions), claves: ESTADOS_APORTE }),
    ...METRICAS.map((m) => grafica({ titulo: T(`m.${m.id}`), dias, vals: act.series.map(m.val), malo: m.malo })));

  const maxBytes = Math.max(1, ...res.tables.map((t) => Number(t.bytes)));
  const tablas = el('div', { class: 'tabla-tablas' }, ...res.tables.map((t) => el('div', { class: 'fila-tabla' },
    el('span', { class: 'mono' }, t.name), el('span', { class: 'mono tenue' }, num(t.rows)),
    el('span', { class: 'barra-peso', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, (t.bytes / maxBytes) * 100).toFixed(1)}%` })),
    el('span', { class: 'mono tenue' }, formatoBytes(t.bytes)))));

  rellenar(kpis, el('div', { class: 'cabecera-sec' }, el('h2', {}, T('sec.activity')), rango),
    el('p', { class: 'nota' }, T('activity.note')), graficas,
    el('h2', {}, T('sec.database')), el('p', { class: 'nota' }, T('db.note', { size: formatoBytes(res.database_bytes) })), tablas);
}

// ═════════════════════════════════════════════ aportes: línea de tiempo y cola
const insignia = (clase, texto) => el('span', { class: `ins s-${clase}` }, texto);

function tarjetaAporte(a, recargar) {
  const items = (a.verdict?.items ?? []).map((it) => el('li', {},
    insignia(it.action, T(`act.${it.action}`)), ' ',
    it.slug ? el('a', { href: `#history`, class: 'mono', onclick: (ev) => { ev.preventDefault(); irAHistorial(it.slug); } }, it.slug) : null,
    it.reason ? el('span', { class: 'tenue' }, ` ${it.reason}`) : null,
    it.item ? el('div', { class: 'propuesto' }, el('strong', {}, it.item.title), el('div', {}, it.item.statement)) : null));
  const admin = a.verdict?.admin;
  const acciones = a.status === 'needs_human' ? el('div', { class: 'acciones' },
    el('button', { type: 'button', class: 'boton acento-b', onclick: (ev) => decidirAporte(a, 'approve', ev.currentTarget, recargar) }, T('common.approve')),
    el('button', { type: 'button', class: 'boton peligro', onclick: (ev) => decidirAporte(a, 'reject', ev.currentTarget, recargar) }, T('common.reject'))) : null;
  return el('li', { class: 'tarj', id: `aporte-${a.id}` },
    el('div', { class: 'meta' }, el('span', { class: 'mono' }, `#${a.id}`), insignia(a.status, T(`ap.${a.status}`)),
      el('button', { type: 'button', class: 'enlace mono', title: T('c.filter.who'), onclick: () => { estado.aportes.who = a.who; mostrarTab('contributions'); } }, a.who ?? '—'),
      el('span', { class: 'tenue' }, fechaHora(a.created_at)), a.resolved_at ? el('span', { class: 'tenue' }, T('c.resolved', { d: fechaHora(a.resolved_at) })) : null,
      a.requirement ? el('a', { href: '#history', class: 'mono', onclick: (ev) => { ev.preventDefault(); irAHistorial(a.requirement); } }, a.requirement) : null),
    el('p', { class: 'texto' }, a.text),
    a.categories?.length ? el('div', { class: 'tenue mono' }, a.categories.join(', ')) : null,
    items.length ? el('ul', { class: 'veredicto' }, ...items) : null,
    admin ? el('div', { class: 'nota' }, T('c.admin', { d: T(`c.admin.${admin.decision}`), by: admin.by, reason: admin.reason ?? '' })) : null,
    acciones);
}

async function decidirAporte(a, accion, boton, recargar) {
  const cuerpo = {};
  if (accion === 'approve' && !confirm(T('c.approve.confirm'))) return;
  if (accion === 'reject') { const m = prompt(T('c.reject.prompt'), ''); if (m === null) return; cuerpo.reason = m; }
  boton.disabled = true;
  try { await api('POST', `/api/admin/contributions/${a.id}/${accion}`, cuerpo); avisar(T(accion === 'approve' ? 'c.approved' : 'c.rejected', { id: a.id })); recargar(); }
  catch (e) { avisar(msgError(e), true); boton.disabled = false; }
}

async function vistaAportes() {
  const f = estado.aportes;
  const lista = el('ul', { class: 'lista', 'aria-live': 'polite' });
  const mas = el('button', { type: 'button', class: 'boton', hidden: 'hidden' }, T('common.more'));
  const cuenta = el('p', { class: 'nota', role: 'status' });
  let siguiente = null;

  async function cargar(reiniciar) {
    if (reiniciar) { lista.replaceChildren(); siguiente = null; }
    const r = await api('GET', `/api/admin/contributions${query({ status: f.status, requirement: f.requirement, who: f.who, before: siguiente, limit: 20 })}`);
    for (const a of r.items) lista.append(tarjetaAporte(a, () => cargar(true).catch((e) => avisar(msgError(e), true))));
    siguiente = r.next; mas.hidden = !r.next;
    cuenta.textContent = lista.children.length ? '' : T('common.empty');
  }
  mas.addEventListener('click', () => cargar(false).catch((e) => avisar(msgError(e), true)));
  const aplicar = (ev) => { ev?.preventDefault(); mostrarTab('contributions'); };
  const form = el('form', { class: 'filtros', onsubmit: aplicar },
    estadoSel('c.status', ['', ...ESTADOS_APORTE], f.status, (v) => T(`ap.${v}`), (v) => { f.status = v; }),
    el('label', { class: 'campo-et' }, el('span', {}, T('c.requirement')), el('input', { class: 'campo', type: 'text', value: f.requirement, maxlength: '120', placeholder: 'slug',
      oninput: (ev) => { f.requirement = ev.target.value.trim(); } })),
    el('label', { class: 'campo-et' }, el('span', {}, T('c.who')), el('input', { class: 'campo mono', type: 'text', value: f.who, maxlength: '10', placeholder: 'a1b2c3d4e5',
      oninput: (ev) => { f.who = ev.target.value.trim(); } })),
    el('button', { type: 'submit', class: 'boton acento-b' }, T('common.apply')),
    el('button', { type: 'button', class: 'boton', onclick: () => { Object.assign(f, { status: 'needs_human', requirement: '', who: '' }); mostrarTab('contributions'); } }, T('common.reset')));
  rellenar(el('h2', {}, T('sec.contributions')), el('p', { class: 'nota' }, T('c.note')), form, cuenta, lista, mas);
  await cargar(true);
}

// ═════════════════════════════════════════════ sugerencias
async function vistaSugerencias() {
  const f = estado.sug;
  const r = await api('GET', `/api/admin/suggestions${query({ status: f.status, limit: 50 })}`);
  const filtro = estadoSel('c.status', ['', 'new', 'accepted', 'dismissed'], f.status, (v) => T(`sug.${v}`), (v) => { f.status = v; mostrarTab('suggestions'); });
  const tarjetas = r.suggestions.map((s) => {
    const cambiar = (nuevo) => async (ev) => {
      ev.currentTarget.disabled = true;
      try { await api('POST', `/api/admin/suggestions/${s.id}/status`, { status: nuevo }); avisar(T('s.changed', { id: s.id, s: T(`sug.${nuevo}`) })); mostrarTab('suggestions'); }
      catch (e) { avisar(msgError(e), true); ev.target.disabled = false; }
    };
    const btns = ['accepted', 'dismissed', 'new'].filter((x) => x !== s.status).map((x) =>
      el('button', { type: 'button', class: `boton${x === 'accepted' ? ' acento-b' : ''}`, onclick: cambiar(x) }, T(`s.set.${x}`)));
    return el('li', { class: 'tarj' },
      el('div', { class: 'meta' }, el('span', { class: 'mono' }, `#${s.id}`), insignia(s.status, T(`sug.${s.status}`)), el('span', {}, T(`kind.${s.kind}`)),
        s.target ? el('a', { href: '#history', class: 'mono', onclick: (ev) => { ev.preventDefault(); irAHistorial(s.target); } }, `${s.target_type}:${s.target}`) : el('span', { class: 'tenue' }, T(`target.${s.target_type}`)),
        el('span', { class: 'mono tenue' }, s.who ?? '—'), el('span', { class: 'tenue' }, fechaHora(s.created_at))),
      el('p', { class: 'texto' }, s.text), el('div', { class: 'acciones' }, ...btns));
  });
  rellenar(el('h2', {}, T('sec.suggestions')), el('div', { class: 'filtros' }, filtro),
    tarjetas.length ? el('ul', { class: 'lista' }, ...tarjetas) : el('p', { class: 'nota' }, T('common.empty')));
}

// ═════════════════════════════════════════════ requisitos largos / partibles
async function vistaDividir() {
  const [cand, props] = await Promise.all([api('GET', `/api/admin/split/candidates?min_score=${estado.minScore}`),
    api('GET', `/api/admin/split/proposals${query({ status: estado.prop.status })}`)]);

  const filtroMin = el('label', { class: 'campo-et' }, el('span', {}, T('d.min')),
    el('input', { class: 'campo', type: 'number', min: '0', max: '100', value: String(estado.minScore),
      onchange: (ev) => { estado.minScore = Math.min(100, Math.max(0, Number(ev.target.value) || 0)); mostrarTab('split'); } }));

  const filas = cand.candidates.map((c) => {
    const m = c.metrics;
    const proponer = el('button', { type: 'button', class: 'boton acento-b', onclick: async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = T('d.proposing');
      try { await api('POST', '/api/admin/split/propose', { slug: c.slug }); avisar(T('d.proposed', { slug: c.slug })); estado.prop.status = 'pending'; mostrarTab('split'); }
      catch (e) { avisar(msgError(e), true); b.disabled = false; b.textContent = T('d.propose'); }
    } }, c.proposal ? T('d.repropose') : T('d.propose'));
    return el('li', { class: 'tarj candidato' },
      el('div', { class: 'meta' }, el('span', { class: `puntos nivel-${c.level}`, title: T('d.score.title') }, String(c.score)), insignia(c.level, T(`level.${c.level}`)),
        el('a', { href: '#history', class: 'mono', onclick: (ev) => { ev.preventDefault(); irAHistorial(c.slug); } }, c.slug),
        c.proposal ? insignia('pending', T('d.has_proposal')) : null),
      el('div', { class: 'titulo' }, c.title),
      el('div', { class: 'metricas mono' }, T('d.m.chars', { n: num(m.chars) }), T('d.m.criteria', { n: m.criteria }), T('d.m.categories', { n: m.categories }),
        T('d.m.tests', { n: m.tests }), T('d.m.verbs', { n: m.verbs.length }), T('d.m.copies', { n: num(c.copies) })),
      m.verbs.length ? el('div', { class: 'tenue mono' }, m.verbs.join(' · ')) : null,
      c.reasons.length ? el('div', { class: 'razones' }, ...c.reasons.map((r) => el('span', { class: 'ins' }, T(`why.${r}`)))) : null,
      el('div', { class: 'acciones' }, proponer));
  });

  const filtroProp = estadoSel('c.status', ['pending', 'accepted', 'dismissed', ''], estado.prop.status, (v) => T(`d.status.${v}`),
    (v) => { estado.prop.status = v; mostrarTab('split'); });
  const propuestas = props.proposals.map((p) => tarjetaPropuesta(p));

  rellenar(el('h2', {}, T('sec.split')), el('p', { class: 'nota' }, T('d.note')),
    el('div', { class: 'filtros' }, filtroMin), cand.candidates.length ? el('ul', { class: 'lista' }, ...filas) : el('p', { class: 'nota' }, T('d.none')),
    el('h2', {}, T('sec.proposals')), el('p', { class: 'nota' }, T('d.proposals.note')), el('div', { class: 'filtros' }, filtroProp),
    propuestas.length ? el('ul', { class: 'lista' }, ...propuestas) : el('p', { class: 'nota' }, T('common.empty')));
}

function tarjetaPropuesta(p) {
  const partes = p.parts.map((x, i) => el('li', { class: 'parte' }, el('strong', {}, `${i + 1}. ${x.title}`), el('div', {}, x.statement),
    x.criteria?.length ? el('ul', { class: 'criterios' }, ...x.criteria.map((c) => el('li', {}, c))) : null));
  const acciones = p.status === 'pending' ? el('div', { class: 'acciones' },
    el('button', { type: 'button', class: 'boton acento-b', onclick: async (ev) => {
      if (!confirm(T('d.accept.confirm', { slug: p.requirement }))) return;
      ev.currentTarget.disabled = true;
      try { const r = await api('POST', `/api/admin/split/proposals/${p.id}/accept`, {}); avisar(T('d.accepted', { n: r.created.length })); mostrarTab('split'); }
      catch (e) { avisar(msgError(e), true); ev.target.disabled = false; }
    } }, T('common.accept')),
    el('button', { type: 'button', class: 'boton', onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try { await api('POST', `/api/admin/split/proposals/${p.id}/dismiss`, {}); avisar(T('d.dismissed')); mostrarTab('split'); }
      catch (e) { avisar(msgError(e), true); ev.target.disabled = false; }
    } }, T('common.dismiss'))) : null;
  return el('li', { class: 'tarj' },
    el('div', { class: 'meta' }, el('span', { class: 'mono' }, `#${p.id}`), insignia(p.status === 'pending' ? 'needs_human' : p.status === 'accepted' ? 'created' : 'rejected', T(`d.status.${p.status}`)),
      el('span', { class: 'mono' }, p.requirement), el('span', { class: 'tenue' }, fechaHora(p.created_at)), p.score != null ? el('span', { class: 'tenue mono' }, T('d.score', { n: p.score })) : null),
    el('div', { class: 'titulo' }, p.title), el('p', { class: 'texto original' }, p.statement),
    p.reason ? el('p', { class: 'nota' }, T('d.reason', { r: p.reason })) : null,
    el('ol', { class: 'partes' }, ...partes),
    p.result ? el('div', { class: 'nota mono' }, T('d.result', { slugs: (p.result.created ?? []).join(', ') })) : null, acciones);
}

// ═════════════════════════════════════════════ paneles baratos
function listaPanel(titulo, nota, cuerpo, items, fila) {
  return el('section', { class: 'tarj panel' }, el('h3', {}, titulo, el('span', { class: 'tenue mono' }, ` ${num(cuerpo)}`)), el('p', { class: 'nota' }, nota),
    items.length ? el('ol', { class: 'compacta' }, ...items.map(fila)) : el('p', { class: 'nota' }, T('common.empty')));
}
async function vistaPaneles() {
  const p = await api('GET', '/api/admin/panels');
  const fila = (x) => el('li', {}, el('a', { href: '#history', class: 'mono', onclick: (ev) => { ev.preventDefault(); irAHistorial(x.slug); } }, x.slug),
    el('span', { class: 'tenue' }, ` ${x.title}`), x.copies ? el('span', { class: 'mono tenue' }, ` · ${T('d.m.copies', { n: num(x.copies) })}`) : null);
  rellenar(el('h2', {}, T('sec.panels')), el('div', { class: 'paneles' },
    listaPanel(T('p.top'), T('p.top.note'), p.top_copied.length, p.top_copied, fila),
    listaPanel(T('p.notests'), T('p.notests.note'), p.without_tests.count, p.without_tests.items, fila),
    listaPanel(T('p.noacc'), T('p.noacc.note'), p.without_accelerators.count, p.without_accelerators.items, fila),
    listaPanel(T('p.emptycat'), T('p.emptycat.note'), p.empty_categories.count, p.empty_categories.items,
      (x) => el('li', {}, el('span', { class: 'mono' }, x.slug), el('span', { class: 'tenue' }, ` ${x.name} · ${x.type}`)))));
}

// ═════════════════════════════════════════════ historial de versiones
function irAHistorial(slug) { estado.historia = slug; mostrarTab('history'); }
async function vistaHistorial() {
  const entrada = el('input', { class: 'campo mono', type: 'text', value: estado.historia, maxlength: '120', placeholder: 'slug', 'aria-label': T('h.slug') });
  const form = el('form', { class: 'filtros', onsubmit: (ev) => { ev.preventDefault(); estado.historia = entrada.value.trim(); mostrarTab('history'); } },
    el('label', { class: 'campo-et' }, el('span', {}, T('h.slug')), entrada), el('button', { type: 'submit', class: 'boton acento-b' }, T('h.show')));
  if (!estado.historia) return rellenar(el('h2', {}, T('sec.history')), el('p', { class: 'nota' }, T('h.note')), form);
  let r;
  try { r = await api('GET', `/api/admin/requirements/${encodeURIComponent(estado.historia)}/history`); }
  catch (e) { return rellenar(el('h2', {}, T('sec.history')), form, el('p', { class: 'error', role: 'alert' }, e.status === 404 ? T('h.notfound') : msgError(e))); }
  const bloque = (v, actual) => el('li', { class: `tarj${actual ? ' actual' : ''}` },
    el('div', { class: 'meta' }, insignia(actual ? 'created' : 'pending', actual ? T('h.current') : T('h.old')), el('span', { class: 'mono' }, T('common.version', { n: v.version })),
      el('span', { class: 'tenue' }, fechaHora(actual ? v.updated_at : v.created_at)), v.contribution ? el('span', { class: 'mono tenue' }, `#${v.contribution}`) : null),
    el('div', { class: 'titulo' }, v.title), el('p', { class: 'texto' }, v.statement),
    v.criteria?.length ? el('ul', { class: 'criterios' }, ...v.criteria.map((c) => el('li', {}, c))) : null);
  rellenar(el('h2', {}, T('sec.history')), form,
    el('p', {}, el('span', { class: 'mono' }, r.slug), ' ', insignia(r.status === 'published' ? 'created' : 'rejected', T(`h.status.${r.status}`))),
    el('ol', { class: 'lista' }, bloque(r.current, true), ...r.versions.map((v) => bloque(v, false))));
}

// ═════════════════════════════════════════════ auditoría
async function vistaAuditoria() {
  const r = await api('GET', '/api/admin/audit?limit=100');
  rellenar(el('h2', {}, T('sec.audit')), el('p', { class: 'nota' }, T('a.note')),
    r.audit.length ? el('ul', { class: 'lista compacta' }, ...r.audit.map((a) => el('li', { class: 'tarj fila-aud' },
      el('span', { class: 'tenue' }, fechaHora(a.at)), el('span', { class: 'mono' }, a.admin), insignia('pending', T(`aud.${a.action}`)),
      el('span', { class: 'mono' }, a.target ?? ''), el('span', { class: 'tenue mono' }, Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : '')))) : el('p', { class: 'nota' }, T('common.empty')));
}

// ═════════════════════════════════════════════ arranque
iniciar(() => { document.title = T('meta.title'); pintarFijo(); if (!$('#panel').hidden) mostrarTab(estado.tab); else arrancar(); });
function pintarFijo() {
  $('#logoTxt').textContent = 'airedb';
  $('#etiquetaAdmin').textContent = T('chrome.admin');
  $('#refrescar').textContent = T('common.refresh');
  $('#refrescar').onclick = () => mostrarTab(estado.tab);
  $('#pestanas').setAttribute('aria-label', T('nav.aria'));
}
pintarFijo();
arrancar();
