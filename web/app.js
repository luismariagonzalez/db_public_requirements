// La página. Todo el texto de la base se pinta con textContent, nunca con
// innerHTML: los requisitos los escribe la comunidad y son datos no confiables.
import { rutaBusqueda, hayFiltro, urlSegura, GRUPOS, ESTADOS, categoriasEfectivas, visibles, dominiosDisponibles, MAX_SOFTWARE } from './consulta.js';
import { entrar, salir, token, usuario, cargarClerk, huboSesion, marcarSesion } from './clerk.js';

const $ = (s) => document.querySelector(s);
// Dónde está montada la app: en la raíz del despliegue ('') o colgando de otra web, p. ej.
// /proyectos/requirements-db/app (la home la sirve con una reescritura). Las rutas de la
// API ('/api/v1/…') se cuelgan de ahí, así que todo es relativo y funciona en los dos sitios.
const BASE = new URL('./', location.href).pathname.replace(/\/$/, '');
const estado = { q: '', prio: 5, cats: [], audiencias: [], dominios: [], filtroCat: '', items: [], sel: new Set(), categorias: [],
  incluirTests: false, incluirAceleradores: false, proyecto: null, ocultarHecho: false, tab: 'md' };
let sesion = false;
let proyectos = [];

// ── utilidades
function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...hijos.filter((h) => h != null));
  return e;
}
let tAviso;
function avisar(msg) {
  const a = $('#aviso'); a.textContent = msg; a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 3500);
}

async function api(metodo, ruta, cuerpo, conSesion = false) {
  const cab = {};
  if (cuerpo) cab['content-type'] = 'application/json';
  if (conSesion || sesion) {
    const t = await token().catch(() => null);
    if (t) cab.authorization = `Bearer ${t}`;
  }
  const r = await fetch(BASE + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const ct = r.headers.get('content-type') ?? '';
  const datos = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) {
    const e = new Error(datos?.error ?? `HTTP ${r.status}`);
    e.status = r.status; e.reintentar = r.headers.get('retry-after');
    throw e;
  }
  return datos;
}
const msgError = (e) => e.status === 429
  ? `Too many requests. Try again in ${e.reintentar ?? 'a few'} seconds, or sign in for a higher limit.` : e.message;

// ── barra lateral: audiencia → dominio → categoría
const PRIOS = [
  [1, 'essential', 'broken or unsafe without it'],
  [2, 'expected', 'users assume it is there'],
  [3, 'recommended', 'solid apps do this'],
  [4, 'nice to have', 'polish'],
  [5, 'differentiator', 'sets you apart'],
];
// Audiencia y dominio son el ÁMBITO: acotan las categorías que se ven y, al elegirlos, empiezan una
// selección nueva (se vacían las categorías). Lo que se busca son las categorías elegidas o, si no
// hay ninguna, la audiencia/dominio mismos: la API los expande a sus categorías.
const consulta = () => ({ ...estado, cats: categoriasEfectivas(estado) });
const gruposAbiertos = new Set(['audience', 'app_type']);

function filaCat(texto, activo, conteo, alPulsar, titulo = '') {
  return el('button', { type: 'button', class: 'fila-cat' + (conteo === 0 ? ' vacia' : ''), 'aria-pressed': String(activo),
    title: titulo, onclick: alPulsar }, el('span', {}, texto), conteo != null ? el('span', { class: 'n' }, String(conteo)) : null);
}
function alternar(lista, slug) {
  const i = lista.indexOf(slug);
  if (i >= 0) lista.splice(i, 1); else lista.push(slug);
  pintarLateral(); buscar();
}
function subgrupo(id, titulo, filas, n) {
  const d = el('details', { class: 'sub' });
  d.open = gruposAbiertos.has(id);
  d.addEventListener('toggle', () => { if (d.open) gruposAbiertos.add(id); else gruposAbiertos.delete(id); });
  d.append(el('summary', {}, el('span', {}, titulo), el('span', { class: 'n' }, String(n))), ...filas);
  return d;
}

function pintarLateral() {
  const cont = $('#cats'); cont.replaceChildren();
  const cs = estado.categorias;
  const porTipo = (t) => cs.filter((c) => c.type === t);
  const nav = { audiencias: estado.audiencias, dominios: estado.dominios };
  const hoja = (c) => filaCat(c.name, estado.cats.includes(c.slug), c.requirements, () => alternar(estado.cats, c.slug), c.description || c.name);
  if (estado.filtroCat) gruposAbiertos.add('software_category');

  const aud = porTipo('audience');
  if (aud.length) cont.append(subgrupo('audience', 'Audience', aud.map((c) =>
    filaCat(c.name, estado.audiencias.includes(c.slug), null, () => { estado.cats = []; alternar(estado.audiencias, c.slug); }, c.description || c.name)), aud.length));

  const disp = dominiosDisponibles(cs.filter((c) => c.type !== 'domain'), estado.audiencias);
  const dom = porTipo('domain').filter((d) => !disp || disp.has(d.slug) || estado.dominios.includes(d.slug));
  if (dom.length) cont.append(subgrupo('domain', 'Domain', dom.map((c) =>
    filaCat(c.name, estado.dominios.includes(c.slug), null, () => { estado.cats = []; alternar(estado.dominios, c.slug); }, c.description || c.name)), dom.length));

  const sw = visibles(porTipo('software_category'), { ...nav, texto: estado.filtroCat })
    .sort((a, b) => (estado.cats.includes(b.slug) - estado.cats.includes(a.slug)) || b.requirements - a.requirements || a.name.localeCompare(b.name));
  if (sw.length || estado.filtroCat) cont.append(subgrupo('software_category', 'Software category',
    [...sw.slice(0, MAX_SOFTWARE).map(hoja),
      sw.length > MAX_SOFTWARE ? el('div', { class: 'mas' }, `${sw.length - MAX_SOFTWARE} more: narrow it with the filter above.`) : null].filter(Boolean), sw.length));

  const tipos = visibles(porTipo('app_type'), nav);
  if (tipos.length) cont.append(subgrupo('app_type', 'App type', tipos.map(hoja), tipos.length));
  for (const [tipo, titulo] of GRUPOS.filter(([t]) => t !== 'app_type')) {
    const lista = porTipo(tipo);
    if (lista.length) cont.append(subgrupo(tipo, titulo, lista.map(hoja), lista.length));
  }
}
$('#filtroCat').addEventListener('input', (e) => { estado.filtroCat = e.target.value; pintarLateral(); });
$('#q').addEventListener('input', (e) => { estado.q = e.target.value; buscarConRetraso(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); $('#q').focus(); }
});

function pintarPrio() {
  $('#prio').replaceChildren(...PRIOS.map(([p, n, d]) => el('button', { type: 'button', 'aria-pressed': String(estado.prio === p),
    title: `P${p} · ${n}: ${d}`, onclick: () => { estado.prio = p; pintarPrio(); buscar(); } }, `P${p}`)));
  const [, n, d] = PRIOS[estado.prio - 1];
  $('#prioDesc').textContent = estado.prio === 5 ? 'Everything, from essential to differentiators.' : `P1 to P${estado.prio}, down to “${n}” — ${d}.`;
}
function interruptor(id, clave) {
  const b = $(id);
  b.addEventListener('click', () => { estado[clave] = !estado[clave]; b.setAttribute('aria-checked', String(estado[clave])); buscar(); });
}
interruptor('#incTests', 'incluirTests'); interruptor('#incAcel', 'incluirAceleradores'); interruptor('#ocultarHecho', 'ocultarHecho');
$('#proyecto').addEventListener('change', (e) => { estado.proyecto = e.target.value ? Number(e.target.value) : null; buscar(); });
$('#leyenda').replaceChildren(...PRIOS.map(([p, n, d]) => el('div', { class: 'fila-l' },
  el('span', { class: 'pb', 'data-p': String(p) }, `P${p}`), el('span', {}, el('b', {}, n), ` — ${d}`))));

// ── búsqueda y lista
let temporizador, ultima = 0;
function buscarConRetraso() { clearTimeout(temporizador); temporizador = setTimeout(buscar, 350); }

function pintarTitulo() {
  const efectivas = categoriasEfectivas(estado);
  const nombres = efectivas.map((s) => estado.categorias.find((c) => c.slug === s)?.name ?? s);
  $('#tituloCat').textContent = nombres.length ? nombres.slice(0, 3).join(' · ') + (nombres.length > 3 ? ` +${nombres.length - 3}` : '') : 'Requirements';
  $('#slugCat').textContent = efectivas.length ? `category=${efectivas.join(',')}` : (estado.q ? `q=${estado.q.slice(0, 40)}` : '');
  const unica = efectivas.length === 1 ? estado.categorias.find((c) => c.slug === efectivas[0]) : null;
  $('#descCat').textContent = unica?.description ?? '';
}

async function buscar() {
  const yo = ++ultima;
  pintarTitulo();
  if (!hayFiltro(estado)) {
    estado.items = []; pintarLista();
    $('#estado').textContent = 'Pick an audience, a category or an app type — or search by meaning.';
    return;
  }
  $('#estado').textContent = 'Searching…';
  try {
    const r = await api('GET', rutaBusqueda(consulta()));
    if (yo !== ultima) return;            // llegó tarde: ya hay otra búsqueda
    estado.items = r.requirements;
    estado.sel = new Set(estado.items.map((i) => i.slug));   // por defecto, todo lo que sale
    pintarLista();
  } catch (e) { if (yo === ultima) $('#estado').textContent = msgError(e); }
}

const ETQ_ESTADO = { planned: 'planned', in_progress: 'in progress', done: 'done', skipped: 'skipped' };
const insignia = (st) => (st ? el('span', { class: `est est-${st}` }, ETQ_ESTADO[st]) : null);
const enlaceSugerir = (tipo, slug) => el('button', { type: 'button', class: 'enlace', onclick: () => sugerirSobre(tipo, slug) }, 'Suggest');

function detalleDe(it) {
  const partes = [el('p', {}, it.statement)];
  if (it.criteria?.length) partes.push(el('ul', {}, ...it.criteria.map((c) => el('li', {}, c))));
  if (it.tests?.length) partes.push(el('div', { class: 'sec-det' }, el('div', { class: 'etq-lat' }, 'Tests'),
    ...it.tests.map((t) => el('div', { class: 'test' }, el('span', { class: 'pb', 'data-p': String(t.priority) }, `P${t.priority}`),
      el('span', {}, el('b', {}, t.title), ` · ${t.type} — ${t.scenario} `, insignia(t.project_status), ' ', enlaceSugerir('test', t.slug))))));
  if (it.accelerators?.length) partes.push(el('div', { class: 'sec-det' }, el('div', { class: 'etq-lat' }, 'Accelerators'),
    el('div', { class: 'chips' }, ...it.accelerators.map((a) => {
      const href = urlSegura(a.url);
      const txt = [a.name, el('small', {}, `${a.model.replace('_', ' ')} · ${a.cost} · ${a.coverage}`)];
      return href ? el('a', { class: 'chip', href, rel: 'noopener noreferrer', target: '_blank' }, ...txt) : el('span', { class: 'chip' }, ...txt);
    }))));
  partes.push(el('div', { class: 'chips' }, ...it.categories.slice(0, 8).map((c) => el('span', { class: 'tag' }, `${c.slug} · P${c.priority}`)),
    enlaceSugerir('requirement', it.slug)));
  return el('div', { class: 'detalle' }, ...partes);
}

const abiertos = new Set();
function filaReq(it) {
  const marca = el('button', { type: 'button', class: 'marca', 'aria-label': `Include ${it.title}`, onclick: (ev) => {
    ev.stopPropagation();
    if (estado.sel.has(it.slug)) estado.sel.delete(it.slug); else estado.sel.add(it.slug);
    marca.setAttribute('aria-pressed', String(estado.sel.has(it.slug))); marca.textContent = estado.sel.has(it.slug) ? '✓' : '';
    actualizarCuenta();
  } });
  marca.setAttribute('aria-pressed', String(estado.sel.has(it.slug))); marca.textContent = estado.sel.has(it.slug) ? '✓' : '';
  const nT = it.tests?.length, nA = it.accelerators?.length;
  const li = el('li', { class: 'item', 'data-abierto': String(abiertos.has(it.slug)) });
  let detalle = null;
  const mostrar = () => {
    const abierto = abiertos.has(it.slug);
    li.setAttribute('data-abierto', String(abierto));
    if (abierto && !detalle) { detalle = detalleDe(it); li.append(detalle); }
    if (detalle) detalle.hidden = !abierto;
  };
  li.append(el('div', { class: 'item-cab', onclick: () => { if (abiertos.has(it.slug)) abiertos.delete(it.slug); else abiertos.add(it.slug); mostrar(); } },
    marca, el('span', { class: 'pb', 'data-p': String(it.priority) }, `P${it.priority}`),
    el('div', { class: 'item-txt' }, el('div', { class: 'item-tit' }, it.title),
      el('div', { class: 'item-meta' }, el('span', {}, it.slug), nT ? el('span', {}, `${nT} test${nT > 1 ? 's' : ''}`) : null,
        nA ? el('span', {}, `${nA} accelerator${nA > 1 ? 's' : ''}`) : null, insignia(it.project_status))),
    el('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  mostrar();
  return li;
}

function pintarLista() {
  const ul = $('#lista'); ul.replaceChildren();
  if (estado.items.length) $('#estado').textContent = '';
  else if (hayFiltro(estado)) $('#estado').textContent = 'No requirements for this selection yet. Try the cross-cutting concerns (security, privacy…), fewer filters, or contribute one.';
  for (const it of estado.items) ul.append(filaReq(it));
  actualizarCuenta();
}
function actualizarCuenta() {
  const n = estado.sel.size;
  $('#acciones').hidden = !estado.items.length;
  $('#accionesProyecto').hidden = !(estado.items.length && estado.proyecto);
  $('#cuenta').textContent = `${n}/${estado.items.length} selected`;
  $('#marcar').disabled = n === 0;
  actualizarSalida();
}
$('#selTodo').addEventListener('click', () => { estado.sel = new Set(estado.items.map((i) => i.slug)); pintarLista(); });
$('#selNada').addEventListener('click', () => { estado.sel.clear(); pintarLista(); });

// ── panel de salida: lo que recibe el agente (Markdown), el curl y el JSON
const CODIGO_MAX = 700;
const claseLinea = (l) => (/^#{1,3} /.test(l) ? 'h' : /^(>|<!--|```|\/\/)/.test(l) ? 'q' : /^\s*- \[[ x]\] \*\*/.test(l) ? 'k' : '');
function pintarCodigo(texto) {
  const c = $('#codigo'); c.replaceChildren();
  const ls = texto.split('\n');
  ls.slice(0, CODIGO_MAX).forEach((l, i) => c.append(el('div', { class: `ln ${claseLinea(l)}` },
    el('span', { class: 'num' }, String(i + 1)), el('span', { class: 'txt' }, l || ' '))));
  if (ls.length > CODIGO_MAX) c.append(el('div', { class: 'ln q' }, el('span', { class: 'num' }, '…'),
    el('span', { class: 'txt' }, `${ls.length - CODIGO_MAX} more lines: Copy takes them all`)));
}
let tSalida, secuencia = 0, textoActual = '';
function actualizarSalida() { clearTimeout(tSalida); tSalida = setTimeout(cargarSalida, 250); }
async function cargarSalida() {
  const yo = ++secuencia;
  const slugs = [...estado.sel];
  let texto;
  if (estado.tab === 'curl') {
    const url = location.origin + BASE + rutaBusqueda({ ...consulta(), formato: 'md' });
    texto = `curl -s${estado.proyecto ? ' -H "Authorization: Bearer $REQDB_KEY"' : ''} "${url}"`;
  } else if (!slugs.length) {
    texto = '// select requirements to preview what your agent will receive';
  } else {
    const cuerpo = { slugs, format: estado.tab === 'json' ? 'json' : 'md', tests_max_priority: estado.prio,
      include: [estado.incluirTests && 'tests', estado.incluirAceleradores && 'accelerators'].filter(Boolean),
      project: estado.proyecto ?? undefined, hide: estado.proyecto && estado.ocultarHecho ? 'done' : undefined };
    try {
      const r = await api('POST', '/api/v1/export', cuerpo);
      texto = estado.tab === 'json' ? JSON.stringify(r, null, 2) : r;
    } catch (e) { texto = `// ${msgError(e)}`; }
  }
  if (yo !== secuencia) return;
  textoActual = texto;
  pintarCodigo(texto);
  const sel = estado.items.filter((i) => estado.sel.has(i.slug));
  const nT = sel.reduce((s, i) => s + (i.tests?.length ?? 0), 0);
  $('#pieIzq').textContent = `${sel.length} requirement${sel.length === 1 ? '' : 's'}${estado.incluirTests ? ` · ${nT} tests` : ''}`;
  $('#pieDer').textContent = estado.tab === 'curl' ? 'GET · public' : `${texto.length.toLocaleString('en')} chars`;
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  estado.tab = b.dataset.tab;
  for (const x of $('#tabs').querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
  cargarSalida();
});
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); avisar('Copied'); }
  catch { avisar('Could not copy: select the text manually'); }
}
$('#copiarCodigo').addEventListener('click', () => copiar(textoActual));

// Marcar lo seleccionado en el proyecto (los requisitos marcados y, si se muestran, sus tests y aceleradores).
$('#estadoProyecto').replaceChildren(...ESTADOS.map(([v, t]) => el('option', { value: v }, t)));
$('#marcar').addEventListener('click', async () => {
  const st = $('#estadoProyecto').value;
  const items = [];
  for (const it of estado.items) {
    if (!estado.sel.has(it.slug)) continue;
    items.push({ type: 'requirement', slug: it.slug, status: st });
    for (const t of it.tests ?? []) items.push({ type: 'test', slug: t.slug, status: st });
    for (const a of it.accelerators ?? []) items.push({ type: 'accelerator', slug: a.slug, status: st });
  }
  try {
    for (let i = 0; i < items.length; i += 200)
      await api('PUT', `/api/v1/projects/${estado.proyecto}/items`, { items: items.slice(i, i + 200) });
    avisar(`${items.length} item(s) marked as ${st.replace('_', ' ')}`);
    cargarProyectos(); buscar();
  } catch (e) { avisar(msgError(e)); }
});

// ── cuenta
function pintarSesion(user) {
  sesion = !!user;
  marcarSesion(sesion);
  $('#btnCuenta').textContent = user ? 'Sign out' : 'Sign in';
  for (const id of ['#aportar', '#claves', '#proyectos', '#sugerencias']) $(id).hidden = !user;
  $('#barraProyecto').hidden = !user;
  $('#navCuenta').hidden = !user;
  if (!user) { estado.proyecto = null; proyectos = []; }
  if (user) { cargarAportes(); cargarClaves(); cargarProyectos(); cargarSugerencias(); }
}
$('#btnCuenta').addEventListener('click', async () => {
  try {
    if (sesion) { await salir(); pintarSesion(null); buscar(); } else await entrar();
  } catch (e) { avisar(e.message); }
});

async function iniciarSesion() {
  if (!huboSesion() && !/^#\/(sso-callback|continue)/.test(location.hash)) return;
  try {
    const c = await cargarClerk();
    pintarSesion(await usuario());
    c.addListener(({ user }) => { if (!!user !== sesion) pintarSesion(user); });
  } catch { /* sin sesión: la web funciona igual */ }
}

// ── proyectos
async function cargarProyectos() {
  try {
    proyectos = (await api('GET', '/api/v1/projects', null, true)).projects;
    const sel = $('#proyecto');
    sel.replaceChildren(el('option', { value: '' }, '— none —'),
      ...proyectos.map((p) => el('option', { value: String(p.id) }, p.name)));
    sel.value = estado.proyecto && proyectos.some((p) => p.id === estado.proyecto) ? String(estado.proyecto) : '';
    if (!sel.value) estado.proyecto = null;
    pintarProyectos();
  } catch (e) { avisar(msgError(e)); }
}

function pintarProyectos() {
  const ul = $('#listaProyectos'); ul.replaceChildren();
  if (!proyectos.length) ul.append(el('li', { class: 'tenue' }, 'No projects yet. Create one to start tracking.'));
  for (const p of proyectos) {
    const c = p.counts;
    const detalle = el('div', { class: 'detalle-proy' });
    const abrir = el('button', { type: 'button', class: 'mini', onclick: () => alternarProyecto(p, detalle, abrir) }, 'Open');
    ul.append(el('li', {},
      el('div', { class: 'fila' },
        el('strong', {}, p.name),
        el('span', { class: 'tenue' }, `${c.done} done · ${c.in_progress} in progress · ${c.planned} planned · ${c.skipped} skipped`),
        abrir,
        el('button', { type: 'button', class: 'mini peligro', onclick: () => borrarProyecto(p) }, 'Delete')),
      detalle));
  }
}
async function alternarProyecto(p, detalle, boton) {
  if (detalle.childElementCount) { detalle.replaceChildren(); boton.textContent = 'Open'; return; }
  try {
    const d = await api('GET', `/api/v1/projects/${p.id}`, null, true);
    boton.textContent = 'Close';
    if (!d.items.length) { detalle.append(el('p', { class: 'tenue' }, 'Nothing tracked yet.')); return; }
    for (const it of d.items) {
      const sel = el('select', { 'aria-label': `Status of ${it.title}`, onchange: async (ev) => {
        try { await api('PUT', `/api/v1/projects/${p.id}/items`, { items: [{ type: it.type, slug: it.slug, status: ev.target.value }] }); cargarProyectos(); }
        catch (e) { avisar(msgError(e)); }
      } }, ...ESTADOS.map(([v, t]) => el('option', { value: v }, t)));
      sel.value = it.status;
      detalle.append(el('div', { class: 'fila item-proy' }, el('span', { class: 'tag' }, it.type), el('span', {}, it.title),
        it.note ? el('span', { class: 'tenue' }, `“${it.note}”`) : null, sel));
    }
  } catch (e) { avisar(msgError(e)); }
}
async function borrarProyecto(p) {
  if (!confirm(`Delete the project “${p.name}” and its tracked items?`)) return;
  try { await api('DELETE', `/api/v1/projects/${p.id}`, null, true); cargarProyectos(); }
  catch (e) { avisar(msgError(e)); }
}
$('#proyCrear').addEventListener('click', async () => {
  const nombre = $('#proyNombre').value.trim();
  if (!nombre) return avisar('Give the project a name.');
  try {
    const r = await api('POST', '/api/v1/projects', { name: nombre, categories: estado.cats }, true);
    $('#proyNombre').value = '';
    estado.proyecto = r.id;
    await cargarProyectos(); buscar();
    avisar('Project created and selected');
  } catch (e) { avisar(msgError(e)); }
});

// ── sugerencias
function sugerirSobre(tipo, slug) {
  $('#sugObjetivoTipo').value = tipo; $('#sugObjetivo').value = slug;
  if (!sesion) { avisar('Sign in to send suggestions'); return; }
  $('#sugerencias').scrollIntoView({ behavior: 'smooth' });
  $('#sugTexto').focus();
}
async function cargarSugerencias() {
  try {
    const r = await api('GET', '/api/v1/suggestions', null, true);
    const ul = $('#misSugerencias'); ul.replaceChildren();
    if (!r.suggestions.length) ul.append(el('li', { class: 'tenue' }, 'Nothing yet.'));
    for (const s of r.suggestions)
      ul.append(el('li', {}, el('strong', {}, s.status), ' · ', s.target ? `${s.target_type} ${s.target}: ` : '', s.text.slice(0, 200)));
  } catch (e) { avisar(msgError(e)); }
}
$('#sugEnviar').addEventListener('click', async () => {
  const texto = $('#sugTexto').value.trim();
  if (texto.length < 10) return avisar('Write at least a sentence (10 characters).');
  const objetivo = $('#sugObjetivo').value.trim();
  const tipo = $('#sugObjetivoTipo').value;
  try {
    await api('POST', '/api/v1/suggestions', { kind: $('#sugTipo').value, text: texto,
      target_type: objetivo ? (tipo === 'general' ? 'requirement' : tipo) : 'general', target: objetivo || undefined }, true);
    $('#sugTexto').value = ''; avisar('Thanks! A person will review it.'); cargarSugerencias();
  } catch (e) { avisar(msgError(e)); }
});

// ── aportes
const ESTADOS_APORTE = { created: 'Created', merged: 'Merged', rejected: 'Not added', needs_human: 'Needs a human look', pending: 'Pending' };
async function cargarAportes() {
  try {
    const r = await api('GET', '/api/me/contributions', null, true);
    const ul = $('#misAportes'); ul.replaceChildren();
    if (!r.contributions.length) ul.append(el('li', { class: 'tenue' }, 'Nothing yet.'));
    for (const a of r.contributions) {
      const razones = (a.verdict?.items ?? []).map((i) => i.reason).filter(Boolean).join(' · ') || a.verdict?.reason || '';
      ul.append(el('li', {}, el('strong', {}, ESTADOS_APORTE[a.status] ?? a.status), ' · ', a.text.slice(0, 160),
        razones ? el('div', { class: 'tenue' }, razones) : null));
    }
  } catch (e) { avisar(msgError(e)); }
}
$('#aporteEnviar').addEventListener('click', async () => {
  const texto = $('#aporteTexto').value.trim();
  const caja = $('#aporteResultado');
  if (texto.length < 10) return avisar('Write at least a sentence (10 characters).');
  if (!$('#aporteLicencia').checked) return avisar('Please accept the Content Terms.');
  $('#aporteEnviar').disabled = true; caja.hidden = false; caja.textContent = 'Reviewing…';
  try {
    const r = await api('POST', '/api/contribute', { text: texto, accept_terms: true, categories: estado.cats }, true);
    const lineas = [`${ESTADOS_APORTE[r.status] ?? r.status}`];
    for (const i of r.items ?? []) lineas.push(`• ${i.reason ?? i.action}${i.slug ? ` (${i.slug})` : ''}${i.duplicate_of ? ` — already exists as ${i.duplicate_of}` : ''}`);
    if (r.reason) lineas.push(r.reason);
    caja.textContent = lineas.join('\n');
    if (r.status === 'created' || r.status === 'merged') $('#aporteTexto').value = '';
    cargarAportes();
  } catch (e) { caja.textContent = msgError(e); }
  finally { $('#aporteEnviar').disabled = false; }
});

// ── API keys
async function cargarClaves() {
  try {
    const r = await api('GET', '/api/me/keys', null, true);
    const ul = $('#listaClaves'); ul.replaceChildren();
    if (!r.keys.length) ul.append(el('li', { class: 'tenue' }, 'No keys yet.'));
    for (const k of r.keys) {
      ul.append(el('li', { class: 'fila' },
        el('span', {}, `${k.name} · ${k.prefix}… · ${k.revoked ? 'revoked' : k.last_used ? 'used ' + new Date(k.last_used).toLocaleDateString() : 'never used'}`),
        k.revoked ? null : el('button', { type: 'button', class: 'mini peligro', onclick: () => revocar(k.id) }, 'Revoke')));
    }
  } catch (e) { avisar(msgError(e)); }
}
async function revocar(id) {
  try { await api('DELETE', `/api/me/keys?id=${id}`, null, true); cargarClaves(); }
  catch (e) { avisar(msgError(e)); }
}
$('#claveCrear').addEventListener('click', async () => {
  const nombre = $('#claveNombre').value.trim();
  if (!nombre) return avisar('Give the key a name.');
  try {
    const r = await api('POST', '/api/me/keys', { name: nombre }, true);
    const caja = $('#claveNueva'); caja.hidden = false;
    caja.replaceChildren(el('div', {}, 'Copy it now, it will not be shown again:'), el('code', {}, r.key),
      ' ', el('button', { type: 'button', onclick: () => copiar(r.key) }, 'Copy'));
    $('#claveNombre').value = '';
    cargarClaves();
  } catch (e) { avisar(msgError(e)); }
});
$('#borrarTodo').addEventListener('click', async () => {
  if (!confirm('This deletes your API keys, contributions, projects and suggestions, and anonymises content you authored. Continue?')) return;
  try {
    await api('DELETE', '/api/me', null, true);
    avisar('Your data was deleted.');
    cargarAportes(); cargarClaves(); cargarProyectos(); cargarSugerencias();
  } catch (e) { avisar(msgError(e)); }
});

// ── arranque
$('#ejemploCurl').textContent =
  `curl "${location.origin}${BASE}/api/v1/requirements?category=messaging&max_priority=2&include=tests,accelerators&format=md"`;
pintarPrio(); pintarTitulo();
(async () => {
  try {
    estado.categorias = (await api('GET', '/api/v1/categories')).categories;
    // Punto de partida: lo transversal que casi toda app necesita (seguridad), como en el diseño.
    if (!estado.cats.length && estado.categorias.some((c) => c.slug === 'security')) estado.cats = ['security'];
    pintarLateral();
  } catch (e) { $('#estado').textContent = msgError(e); }
  await buscar();
  iniciarSesion();
})();
