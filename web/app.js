// La página. Todo el texto de la base se pinta con textContent, nunca con
// innerHTML: los requisitos los escribe la comunidad y son datos no confiables.
import { rutaBusqueda, hayFiltro, urlSegura, CLASES, ORDENES, ESTADOS, categoriasEfectivas, visibles, dominiosDisponibles, MAX_SOFTWARE,
  chipsActivos, quitarFiltro, limpiarFiltros, contarFiltros, flujosPorFamilia } from './consulta.js';
import { entrar, salir, token, usuario, cargarClerk, huboSesion, marcarSesion } from './clerk.js';
import { iniciar, t as T, tn as TN, fecha as FECHA } from './i18n.js';

const $ = (s) => document.querySelector(s);
// Idioma: se fija ya (EN/ES) y, al cambiarlo, se vuelve a pintar todo lo dinámico (renderTodo).
iniciar(() => renderTodo());
// Dónde está montada la app: en la raíz del despliegue ('') o colgando de otra web, p. ej.
// /proyectos/requirements-db/app (la home la sirve con una reescritura). Las rutas de la
// API ('/api/v1/…') se cuelgan de ahí, así que todo es relativo y funciona en los dos sitios.
const BASE = new URL('./', location.href).pathname.replace(/\/$/, '');
const estado = { q: '', prio: 5, cats: [], audiencias: [], dominios: [], filtroCat: '', items: [], sel: new Set(), categorias: [],
  incluirTests: false, incluirAceleradores: false, proyecto: null, ocultarHecho: false, kinds: [], orden: null, recordar: true, tab: 'md', pestana: 'tipos' };
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
const msgError = (e) => e.status === 429 ? T('err.429', { s: e.reintentar ? `${e.reintentar} s` : T('err.429.poco') }) : e.message;

// ── filtros: una barra horizontal con dos paneles desplegables
//   «Qué construyes»: tipo de app (plantillas) o categoría de software (dominio → categoría, que hereda de arquetipos)
//   «Además»: temas transversales (seguridad, privacidad…) y flujos (registro, inicio de sesión, ajustes…)
// Audiencia y dominio son el ÁMBITO: acotan las listas y, al elegirlos, empiezan una selección nueva (se vacían las
// categorías). Lo que se busca son las categorías elegidas o, si no hay ninguna, la audiencia/dominio mismos: la API
// los expande a sus categorías (y a los arquetipos de los que heredan).
const PRIOS = [1, 2, 3, 4, 5];   // nombres y descripciones, en el diccionario: p1.n, p1.d…
const consulta = () => ({ ...estado, cats: categoriasEfectivas(estado) });
const porTipo = (t) => estado.categorias.filter((c) => c.type === t);
const nombreDe = (slug) => estado.categorias.find((c) => c.slug === slug)?.name ?? slug;

function filaCat(texto, activo, nota, alPulsar, titulo = '') {
  return el('button', { type: 'button', class: 'fila-cat', 'aria-pressed': String(activo), title: titulo, onclick: alPulsar },
    el('span', {}, texto), nota != null ? el('span', { class: 'n' }, String(nota)) : null);
}
function alternar(lista, slug) {
  const i = lista.indexOf(slug);
  if (i >= 0) lista.splice(i, 1); else lista.push(slug);
  pintarFiltros(); buscar();
}
const pildora = (texto, activo, alPulsar, titulo = '') =>
  el('button', { type: 'button', class: 'pildora', 'aria-pressed': String(activo), title: titulo, onclick: alPulsar }, texto);

// paneles desplegables: uno abierto como mucho; se cierran con Escape o pulsando fuera
const PANELES = { construyes: ['#btnConstruyes', '#panelConstruyes'], ademas: ['#btnAdemas', '#panelAdemas'] };
function abrirPanel(id) {
  for (const [k, [b, p]] of Object.entries(PANELES)) {
    const abrir = k === id && $(p).hidden;
    $(p).hidden = !abrir; $(b).setAttribute('aria-expanded', String(abrir));
  }
}
for (const [k, [b]] of Object.entries(PANELES)) $(b).addEventListener('click', () => abrirPanel(k));
// (el botón pulsado puede haberse repintado ya: si está desconectado, el clic fue dentro del panel)
document.addEventListener('click', (e) => { if (e.target.isConnected && !e.target.closest('.fb-bloque')) abrirPanel(null); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrirPanel(null); });

function pintarConstruyes() {
  const nav = { audiencias: estado.audiencias, dominios: estado.dominios };
  $('#audiencias').replaceChildren(...porTipo('audience').map((c) =>
    pildora(c.name, estado.audiencias.includes(c.slug), () => { estado.cats = []; alternar(estado.audiencias, c.slug); }, c.description)));
  for (const b of document.querySelectorAll('[data-pestana]')) b.setAttribute('aria-selected', String(b.dataset.pestana === estado.pestana));
  $('#pestanaTipos').hidden = estado.pestana !== 'tipos'; $('#pestanaSector').hidden = estado.pestana !== 'sector';

  // tipos de app: lo que más requisitos tiene primero
  const tipos = visibles(porTipo('app_type'), { audiencias: estado.audiencias }).sort((a, b) => b.requirements - a.requirements || a.name.localeCompare(b.name));
  $('#pestanaTipos').replaceChildren(...tipos.map((c) =>
    filaCat(c.name, estado.cats.includes(c.slug), c.requirements, () => alternar(estado.cats, c.slug), c.description || c.name)));

  // por sector: dominio (select) → categoría de software, con lo que hereda
  const disp = dominiosDisponibles(porTipo('software_category'), estado.audiencias);
  const dominios = porTipo('domain').filter((d) => !disp || disp.has(d.slug) || estado.dominios.includes(d.slug));
  const sel = $('#selDominio');
  sel.replaceChildren(el('option', { value: '' }, T('pan.todos.dominios')), ...dominios.map((d) => el('option', { value: d.slug }, d.name)));
  sel.value = estado.dominios[0] ?? '';
  const sw = visibles(porTipo('software_category'), { ...nav, texto: estado.filtroCat })
    .sort((a, b) => (estado.cats.includes(b.slug) - estado.cats.includes(a.slug)) || a.name.localeCompare(b.name));
  $('#listaSector').replaceChildren(...sw.slice(0, MAX_SOFTWARE).map((c) =>
    filaCat(c.name, estado.cats.includes(c.slug), null, () => alternar(estado.cats, c.slug), c.description || c.name)),
    ...(sw.length > MAX_SOFTWARE ? [el('div', { class: 'mas' }, T('g.mas', { n: sw.length - MAX_SOFTWARE }))] : []));
  // lo que hereda cada categoría, en pequeño
  [...$('#listaSector').querySelectorAll('.fila-cat')].forEach((fila, i) => {
    const h = (sw[i]?.archetypes ?? []).map(nombreDe);
    if (h.length) fila.append(el('small', { class: 'hereda' }, T('pan.hereda', { a: h.join(', ') })));
  });
}

function pintarAdemas() {
  $('#transversales').replaceChildren(...porTipo('cross_cutting').map((c) =>
    pildora(c.name, estado.cats.includes(c.slug), () => alternar(estado.cats, c.slug), c.description || c.name)));
  const bloques = flujosPorFamilia(estado.categorias).map(([fam, lista]) => el('div', { class: 'pd-fam' },
    el('span', { class: 'etq' }, T(`fam.${fam}`)),
    el('div', { class: 'pildoras' }, ...lista.map((c) => pildora(c.name, estado.cats.includes(c.slug), () => alternar(estado.cats, c.slug), c.description || c.name)))));
  $('#flujos').replaceChildren(el('div', { class: 'pd-fila' }, el('span', { class: 'etq' }, T('pan.flujos'))), ...bloques);
}

// resúmenes de los dos botones y chips de lo activo
function pintarResumenes() {
  const tipoDe = (slug) => estado.categorias.find((c) => c.slug === slug)?.type;
  const construyes = estado.cats.filter((s) => ['app_type', 'software_category'].includes(tipoDe(s))).map(nombreDe);
  const ambito = [...estado.audiencias, ...estado.dominios].map(nombreDe);
  const lista = construyes.length ? construyes : ambito;
  $('#resConstruyes').textContent = lista.length ? lista.slice(0, 2).join(' · ') + (lista.length > 2 ? ` +${lista.length - 2}` : '') : T('bar.construyes.vacio');
  const extra = estado.cats.filter((s) => ['cross_cutting', 'screen_type'].includes(tipoDe(s)));
  $('#resAdemas').textContent = extra.length ? extra.slice(0, 2).map(nombreDe).join(' · ') + (extra.length > 2 ? ` +${extra.length - 2}` : '') : T('bar.ademas.vacio');
  const n = contarFiltros(estado, estado.categorias);
  $('#btnFiltros').textContent = T('bar.filtros', { n });
  const chips = chipsActivos(estado, estado.categorias).map((c) => ({ ...c, texto: c.tipo === 'clase' ? T(`k.${c.valor}`) : c.tipo === 'orden' ? T(`orden.${c.valor}`) : c.texto }));
  $('#zonaChips').hidden = chips.length === 0;
  $('#chipsActivos').replaceChildren(...chips.map((c) => el('button', { type: 'button', class: 'chip-act', 'aria-label': T('chip.quitar', { texto: c.texto }),
    onclick: () => { quitarFiltro(estado, c); if (c.tipo === 'q') $('#q').value = ''; pintarFiltros(); buscar(); } }, c.texto, el('i', { 'aria-hidden': 'true' }, '×'))));
}
function pintarFiltros() { pintarConstruyes(); pintarAdemas(); pintarKinds(); pintarOrden(); pintarResumenes(); }

$('#borrarFiltros').addEventListener('click', () => { limpiarFiltros(estado); $('#q').value = ''; $('#filtroCat').value = ''; pintarPrio(); pintarFiltros(); buscar(); });
for (const b of document.querySelectorAll('[data-pestana]')) b.addEventListener('click', () => { estado.pestana = b.dataset.pestana; pintarConstruyes(); });
$('#selDominio').addEventListener('change', (e) => { estado.cats = []; estado.dominios = e.target.value ? [e.target.value] : []; pintarFiltros(); buscar(); });
$('#filtroCat').addEventListener('input', (e) => { estado.filtroCat = e.target.value; pintarConstruyes(); });
$('#btnFiltros').addEventListener('click', () => {
  const abierto = $('#fbCuerpo').classList.toggle('abierto'); $('#btnFiltros').setAttribute('aria-expanded', String(abierto));
});
$('#q').addEventListener('input', (e) => { estado.q = e.target.value; pintarResumenes(); buscarConRetraso(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); $('#q').focus(); }
});

function pintarPrio() {
  $('#prio').replaceChildren(...PRIOS.map((p) => el('button', { type: 'button', 'aria-pressed': String(estado.prio === p),
    title: `P${p} · ${T(`p${p}.n`)}: ${T(`p${p}.d`)}`, onclick: () => { estado.prio = p; pintarPrio(); pintarResumenes(); buscar(); } }, `P${p}`)));
  $('#prioDesc').textContent = estado.prio === 5 ? '' : T('prio.hasta', { n: estado.prio, nombre: T(`p${estado.prio}.n`), desc: T(`p${estado.prio}.d`) });
}
function pintarKinds() {
  $('#kinds').replaceChildren(...CLASES.map((k) => pildora(T(`k.${k}`), estado.kinds.includes(k),
    () => { const i = estado.kinds.indexOf(k); if (i >= 0) estado.kinds.splice(i, 1); else estado.kinds.push(k); pintarKinds(); pintarResumenes(); buscar(); }, T(`k.${k}.d`))));
}
function pintarOrden() {
  const sel = $('#orden');
  sel.replaceChildren(el('option', { value: '' }, T('orden.auto')), ...ORDENES.map((o) => el('option', { value: o }, T(`orden.${o}`))));
  sel.value = estado.orden ?? '';
}
$('#orden').addEventListener('change', (e) => { estado.orden = e.target.value || null; pintarResumenes(); buscar(); });
function interruptor(id, clave) {
  const b = $(id);
  b.addEventListener('click', () => { estado[clave] = !estado[clave]; b.setAttribute('aria-checked', String(estado[clave])); buscar(); });
}
interruptor('#incTests', 'incluirTests'); interruptor('#incAcel', 'incluirAceleradores'); interruptor('#ocultarHecho', 'ocultarHecho');
$('#proyecto').addEventListener('change', (e) => { estado.proyecto = e.target.value ? Number(e.target.value) : null; pintarResumenProyecto(); buscar(); });
function pintarLeyenda() {
  $('#leyenda').replaceChildren(...PRIOS.map((p) => el('div', { class: 'fila-l' },
    el('span', { class: 'pb', 'data-p': String(p) }, `P${p}`), el('span', {}, el('b', {}, T(`p${p}.n`)), ` — ${T(`p${p}.d`)}`))));
}
pintarLeyenda();

// ── búsqueda y lista
let temporizador, ultima = 0;
function buscarConRetraso() { clearTimeout(temporizador); temporizador = setTimeout(buscar, 350); }

function pintarTitulo() {
  const efectivas = categoriasEfectivas(estado);
  const nombres = efectivas.map((s) => estado.categorias.find((c) => c.slug === s)?.name ?? s);
  $('#tituloCat').textContent = nombres.length ? nombres.slice(0, 3).join(' · ') + (nombres.length > 3 ? ` +${nombres.length - 3}` : '') : T('lista.titulo');
  $('#slugCat').textContent = efectivas.length ? `category=${efectivas.join(',')}` : (estado.q ? `q=${estado.q.slice(0, 40)}` : '');
  const unica = efectivas.length === 1 ? estado.categorias.find((c) => c.slug === efectivas[0]) : null;
  $('#descCat').textContent = unica?.description ?? '';
}

async function buscar() {
  const yo = ++ultima;
  pintarTitulo();
  if (!hayFiltro(estado)) {
    estado.items = []; pintarLista();
    const rapidos = porTipo('app_type').sort((a, b) => b.requirements - a.requirements).slice(0, 6);
    $('#estado').replaceChildren(T('estado.elige'), ...(rapidos.length ? [el('div', { class: 'rapidos' }, el('span', { class: 'tenue' }, T('estado.prueba')),
      ...rapidos.map((c) => pildora(c.name, false, () => { estado.cats = [c.slug]; pintarFiltros(); buscar(); })))] : []));
    return;
  }
  $('#estado').textContent = T('estado.buscando');
  try {
    const r = await api('GET', rutaBusqueda(consulta()));
    if (yo !== ultima) return;            // llegó tarde: ya hay otra búsqueda
    estado.items = r.requirements;
    estado.sel = new Set(estado.items.map((i) => i.slug));   // por defecto, todo lo que sale
    pintarLista();
  } catch (e) { if (yo === ultima) $('#estado').textContent = msgError(e); }
}

const insignia = (st) => (st ? el('span', { class: `est est-${st}` }, T(`est.${st}`)) : null);
const enlaceSugerir = (tipo, slug) => el('button', { type: 'button', class: 'enlace', onclick: () => sugerirSobre(tipo, slug) }, T('det.sugerir'));

function detalleDe(it) {
  const partes = [el('p', {}, it.statement)];
  if (it.criteria?.length) partes.push(el('ul', {}, ...it.criteria.map((c) => el('li', {}, c))));
  if (it.tests?.length) partes.push(el('div', { class: 'sec-det' }, el('div', { class: 'etq-lat' }, T('det.tests')),
    ...it.tests.map((t) => el('div', { class: 'test' }, el('span', { class: 'pb', 'data-p': String(t.priority) }, `P${t.priority}`),
      el('span', {}, el('b', {}, t.title), ` · ${t.type} — ${t.scenario} `, insignia(t.project_status), ' ', enlaceSugerir('test', t.slug))))));
  if (it.accelerators?.length) partes.push(el('div', { class: 'sec-det' }, el('div', { class: 'etq-lat' }, T('det.acel')),
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
  const marca = el('button', { type: 'button', class: 'marca', 'aria-label': T('item.incluir', { titulo: it.title }), onclick: (ev) => {
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
      el('div', { class: 'item-meta' }, el('span', {}, it.slug), it.copies ? el('span', { title: T('item.copias.t') }, `⧉ ${it.copies}`) : null, nT ? el('span', {}, TN('n.test', nT)) : null,
        nA ? el('span', {}, TN('n.acel', nA)) : null, insignia(it.project_status))),
    el('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  mostrar();
  return li;
}

function pintarLista() {
  const ul = $('#lista'); ul.replaceChildren();
  if (estado.items.length) $('#estado').textContent = '';
  else if (hayFiltro(estado)) $('#estado').textContent = T('estado.vacio');
  for (const it of estado.items) ul.append(filaReq(it));
  actualizarCuenta();
}
function actualizarCuenta() {
  const n = estado.sel.size;
  $('#acciones').hidden = !estado.items.length;
  $('#accionesProyecto').hidden = !(estado.items.length && estado.proyecto);
  $('#franjaProyecto').hidden = !estado.proyecto;
  $('#cuenta').textContent = T('sel.cuenta', { n, total: estado.items.length });
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
    el('span', { class: 'txt' }, T('codigo.mas', { n: ls.length - CODIGO_MAX }))));
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
    texto = T('codigo.vacio');
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
  $('#pieIzq').textContent = TN('n.req', sel.length) + (estado.incluirTests ? T('pie.tests', { n: nT }) : '');
  $('#pieDer').textContent = estado.tab === 'curl' ? T('pie.get') : T('pie.chars', { n: texto.length.toLocaleString(document.documentElement.lang) });
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  estado.tab = b.dataset.tab;
  for (const x of $('#tabs').querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
  cargarSalida();
});
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); avisar(T('copiado')); }
  catch { avisar(T('copiar.fallo')); }
}
$('#copiarCodigo').addEventListener('click', async () => {
  await copiar(textoActual);
  if (estado.tab !== 'curl' && estado.sel.size) api('POST', '/api/v1/copied', { slugs: [...estado.sel].slice(0, 200) }).catch(() => {});   // contador global de copias
  if (sesion && estado.proyecto && estado.recordar && estado.tab !== 'curl') await recordarEntregado();
});
// Lo que se copia para el agente queda anotado en el proyecto como «planeado» (no pisa lo que ya tenga estado).
async function recordarEntregado() {
  const items = [], tocados = [];
  const nuevo = (obj, tipo, tiene) => { if (!tiene) { items.push({ type: tipo, slug: obj.slug, status: 'planned' }); tocados.push(obj); } };
  for (const it of estado.items) {
    if (!estado.sel.has(it.slug)) continue;
    nuevo(it, 'requirement', it.project_status);
    if (estado.incluirTests) for (const t of it.tests ?? []) nuevo(t, 'test', t.project_status);
    if (estado.incluirAceleradores) for (const a of it.accelerators ?? []) nuevo(a, 'accelerator', a.project_status);
  }
  if (!items.length) return;
  try {
    for (let i = 0; i < items.length; i += 200) await api('PUT', `/api/v1/projects/${estado.proyecto}/items`, { items: items.slice(i, i + 200) });
    for (const o of tocados) o.project_status = 'planned';
    pintarLista(); cargarProyectos();
    avisar(T('proy.recordado', { n: items.length, proyecto: proyectos.find((p) => p.id === estado.proyecto)?.name ?? '' }));
  } catch (e) { avisar(msgError(e)); }
}
$('#recordarCopia').addEventListener('click', () => { estado.recordar = !estado.recordar; $('#recordarCopia').setAttribute('aria-checked', String(estado.recordar)); });

// Marcar lo seleccionado en el proyecto (los requisitos marcados y, si se muestran, sus tests y aceleradores).
function pintarEstadosProyecto() { const v = $('#estadoProyecto').value; $('#estadoProyecto').replaceChildren(...ESTADOS.map(([x]) => el('option', { value: x }, T(`estl.${x}`)))); if (v) $('#estadoProyecto').value = v; }
pintarEstadosProyecto();
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
    avisar(T('marcar.ok', { n: items.length, estado: T(`est.${st}`) }));
    cargarProyectos(); buscar();
  } catch (e) { avisar(msgError(e)); }
});

// ── cuenta
function pintarSesion(user) {
  sesion = !!user;
  marcarSesion(sesion);
  $('#btnCuenta').textContent = T(user ? 'cuenta.salir' : 'cuenta.entrar');
  for (const id of ['#aportar', '#claves', '#proyectos', '#sugerencias']) $(id).hidden = !user;
  $('#proyEntrar').hidden = !!user; $('#proyecto').hidden = !user; $('#proyNuevo').hidden = !user;
  if (!user) $('#proyNuevoForm').hidden = true;
  if (!user) { estado.proyecto = null; proyectos = []; }
  if (user) { cargarAportes(); cargarClaves(); cargarProyectos(); cargarSugerencias(); }
}
// Proyectos y claves están siempre en el menú: sin sesión llevan a entrar.
for (const id of ['#navProy', '#navClaves', '#proyEntrar'])
  $(id).addEventListener('click', async (e) => { if (!sesion) { e.preventDefault(); try { await entrar(); } catch (err) { avisar(err.message); } } });
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
    sel.replaceChildren(el('option', { value: '' }, T('proy.ninguno')),
      ...proyectos.map((p) => el('option', { value: String(p.id) }, p.name)));
    sel.value = estado.proyecto && proyectos.some((p) => p.id === estado.proyecto) ? String(estado.proyecto) : '';
    if (!sel.value) estado.proyecto = null;
    pintarProyectos(); pintarResumenProyecto();
  } catch (e) { avisar(msgError(e)); }
}
function pintarResumenProyecto() {
  const p = proyectos.find((x) => x.id === estado.proyecto);
  $('#resumenProyecto').textContent = p ? T('proy.cuentas', p.counts) : '';
}

function pintarProyectos() {
  const ul = $('#listaProyectos'); ul.replaceChildren();
  if (!proyectos.length) ul.append(el('li', { class: 'tenue' }, T('proy.vacio')));
  for (const p of proyectos) {
    const c = p.counts;
    const detalle = el('div', { class: 'detalle-proy' });
    const abrir = el('button', { type: 'button', class: 'mini', onclick: () => alternarProyecto(p, detalle, abrir) }, T('proy.abrir'));
    ul.append(el('li', {},
      el('div', { class: 'fila' },
        el('strong', {}, p.name),
        el('span', { class: 'tenue' }, T('proy.cuentas', c)),
        abrir,
        el('button', { type: 'button', class: 'mini peligro', onclick: () => borrarProyecto(p) }, T('proy.borrar'))),
      detalle));
  }
}
async function alternarProyecto(p, detalle, boton) {
  if (detalle.childElementCount) { detalle.replaceChildren(); boton.textContent = T('proy.abrir'); return; }
  try {
    const d = await api('GET', `/api/v1/projects/${p.id}`, null, true);
    boton.textContent = T('proy.cerrar');
    if (!d.items.length) { detalle.append(el('p', { class: 'tenue' }, T('proy.nada'))); return; }
    for (const it of d.items) {
      const sel = el('select', { 'aria-label': T('proy.estado.de', { titulo: it.title }), onchange: async (ev) => {
        try { await api('PUT', `/api/v1/projects/${p.id}/items`, { items: [{ type: it.type, slug: it.slug, status: ev.target.value }] }); cargarProyectos(); }
        catch (e) { avisar(msgError(e)); }
      } }, ...ESTADOS.map(([x]) => el('option', { value: x }, T(`estl.${x}`))));
      sel.value = it.status;
      detalle.append(el('div', { class: 'fila item-proy' }, el('span', { class: 'tag' }, it.type), el('span', {}, it.title),
        it.note ? el('span', { class: 'tenue' }, `“${it.note}”`) : null, sel));
    }
  } catch (e) { avisar(msgError(e)); }
}
async function borrarProyecto(p) {
  if (!confirm(T('proy.confirmar', { nombre: p.name }))) return;
  try { await api('DELETE', `/api/v1/projects/${p.id}`, null, true); cargarProyectos(); }
  catch (e) { avisar(msgError(e)); }
}
async function crearProyecto(campo) {
  const nombre = campo.value.trim();
  if (!nombre) return avisar(T('proy.dale.nombre'));
  try {
    const r = await api('POST', '/api/v1/projects', { name: nombre, categories: estado.cats }, true);
    campo.value = '';
    $('#proyNuevoForm').hidden = true;
    estado.proyecto = r.id;
    await cargarProyectos(); buscar();
    avisar(T('proy.creado'));
  } catch (e) { avisar(msgError(e)); }
}
$('#proyCrear').addEventListener('click', () => crearProyecto($('#proyNombre')));
$('#proyCrearRapido').addEventListener('click', () => crearProyecto($('#proyNombreRapido')));
$('#proyNombreRapido').addEventListener('keydown', (e) => { if (e.key === 'Enter') crearProyecto($('#proyNombreRapido')); });
$('#proyNuevo').addEventListener('click', () => { const f = $('#proyNuevoForm'); f.hidden = !f.hidden; if (!f.hidden) $('#proyNombreRapido').focus(); });

// ── sugerencias
function sugerirSobre(tipo, slug) {
  $('#sugObjetivoTipo').value = tipo; $('#sugObjetivo').value = slug;
  if (!sesion) { avisar(T('sug.entra')); return; }
  $('#sugerencias').scrollIntoView({ behavior: 'smooth' });
  $('#sugTexto').focus();
}
async function cargarSugerencias() {
  try {
    const r = await api('GET', '/api/v1/suggestions', null, true);
    const ul = $('#misSugerencias'); ul.replaceChildren();
    if (!r.suggestions.length) ul.append(el('li', { class: 'tenue' }, T('nada.todavia')));
    for (const s of r.suggestions)
      ul.append(el('li', {}, el('strong', {}, T(`sug.estado.${s.status}`)), ' · ', s.target ? `${s.target_type} ${s.target}: ` : '', s.text.slice(0, 200)));
  } catch (e) { avisar(msgError(e)); }
}
$('#sugEnviar').addEventListener('click', async () => {
  const texto = $('#sugTexto').value.trim();
  if (texto.length < 10) return avisar(T('aporte.corto'));
  const objetivo = $('#sugObjetivo').value.trim();
  const tipo = $('#sugObjetivoTipo').value;
  try {
    await api('POST', '/api/v1/suggestions', { kind: $('#sugTipo').value, text: texto,
      target_type: objetivo ? (tipo === 'general' ? 'requirement' : tipo) : 'general', target: objetivo || undefined }, true);
    $('#sugTexto').value = ''; avisar(T('sug.gracias')); cargarSugerencias();
  } catch (e) { avisar(msgError(e)); }
});

// ── aportes (requisito, test o acelerador)
const estadoAporte = (s) => T(`ap.${s}`);
const razonDe = (v) => [...(v?.items ?? []).map((i) => i.reason), v?.reason].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join(' · ');
async function cargarAportes() {
  try {
    const r = await api('GET', '/api/me/contributions', null, true);
    const ul = $('#misAportes'); ul.replaceChildren();
    if (!r.contributions.length) ul.append(el('li', { class: 'tenue' }, T('nada.todavia')));
    for (const a of r.contributions) {
      const razones = razonDe(a.verdict);
      ul.append(el('li', {}, el('strong', {}, estadoAporte(a.status)), ` · ${T(`ap.tipo.${a.type ?? 'requirement'}`)} · `, a.text.replace(/\s+/g, ' ').slice(0, 160),
        razones ? el('div', { class: 'tenue' }, razones) : null));
    }
  } catch (e) { avisar(msgError(e)); }
}
const slugsDe = (txt) => txt.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
function cuerpoAporte() {
  const tipo = $('#aporteTipo').value;
  if (tipo === 'test') {
    const reqs = slugsDe($('#apTestReqs').value);
    const c = { type: 'test', title: $('#apTestTitulo').value.trim(), scenario: $('#apTestEscenario').value.trim(),
      test_type: $('#apTestTipo').value, priority: Number($('#apTestPrioridad').value), requirements: reqs };
    return c.title.length < 5 || c.scenario.length < 10 || !reqs.length ? { falta: 'aporte.faltan.test' } : { c };
  }
  if (tipo === 'accelerator') {
    const reqs = slugsDe($('#apAcReqs').value).map((x) => { const [slug, cob] = x.split(':'); return { slug, coverage: cob === 'full' ? 'full' : 'partial' }; });
    const c = { type: 'accelerator', name: $('#apAcName').value.trim(), url: $('#apAcUrl').value.trim(), description: $('#apAcDesc').value.trim(),
      model: $('#apAcModelo').value, cost: $('#apAcCoste').value, requirements: reqs };
    return c.name.length < 2 || !/^https:\/\//i.test(c.url) || c.description.length < 10 || !reqs.length ? { falta: 'aporte.faltan.ac' } : { c };
  }
  const texto = $('#aporteTexto').value.trim();
  return texto.length < 10 ? { falta: 'aporte.corto' } : { c: { type: 'requirement', text: texto, categories: estado.cats } };
}
function mostrarCamposAporte() {
  const tipo = $('#aporteTipo').value;
  $('#aporteReq').hidden = tipo !== 'requirement'; $('#aporteTest').hidden = tipo !== 'test'; $('#aporteAcel').hidden = tipo !== 'accelerator';
}
$('#aporteTipo').addEventListener('change', mostrarCamposAporte);
$('#aporteEnviar').addEventListener('click', async () => {
  const caja = $('#aporteResultado');
  const { c, falta } = cuerpoAporte();
  if (falta) return avisar(T(falta));
  if (!$('#aporteLicencia').checked) return avisar(T('aporte.acepta'));
  $('#aporteEnviar').disabled = true; caja.hidden = false; caja.textContent = T('aporte.revisando');
  try {
    const r = await api('POST', '/api/contribute', { ...c, accept_terms: true }, true);
    const lineas = [estadoAporte(r.status)];
    for (const i of r.items ?? []) lineas.push(`• ${i.reason ?? i.action}${i.slug ? ` (${i.slug})` : ''}${i.duplicate_of ? T('aporte.duplicado', { slug: i.duplicate_of }) : ''}`);
    if (r.reason && !(r.items ?? []).some((i) => i.reason === r.reason)) lineas.push(r.reason);
    caja.textContent = lineas.join('\n');
    if (r.status === 'created' || r.status === 'merged')
      for (const id of ['aporteTexto', 'apTestTitulo', 'apTestEscenario', 'apTestReqs', 'apAcName', 'apAcUrl', 'apAcDesc', 'apAcReqs']) $(`#${id}`).value = '';
    cargarAportes();
  } catch (e) { caja.textContent = msgError(e); }
  finally { $('#aporteEnviar').disabled = false; }
});

// ── API keys
async function cargarClaves() {
  try {
    const r = await api('GET', '/api/me/keys', null, true);
    const ul = $('#listaClaves'); ul.replaceChildren();
    if (!r.keys.length) ul.append(el('li', { class: 'tenue' }, T('claves.vacio')));
    for (const k of r.keys) {
      ul.append(el('li', { class: 'fila' },
        el('span', {}, `${k.name} · ${k.prefix}… · ${k.revoked ? T('claves.revocada') : k.last_used ? T('claves.usada', { fecha: FECHA(k.last_used) }) : T('claves.nunca')}`),
        k.revoked ? null : el('button', { type: 'button', class: 'mini peligro', onclick: () => revocar(k.id) }, T('claves.revocar'))));
    }
  } catch (e) { avisar(msgError(e)); }
}
async function revocar(id) {
  try { await api('DELETE', `/api/me/keys?id=${id}`, null, true); cargarClaves(); }
  catch (e) { avisar(msgError(e)); }
}
$('#claveCrear').addEventListener('click', async () => {
  const nombre = $('#claveNombre').value.trim();
  if (!nombre) return avisar(T('claves.dale.nombre'));
  try {
    const r = await api('POST', '/api/me/keys', { name: nombre }, true);
    const caja = $('#claveNueva'); caja.hidden = false;
    caja.replaceChildren(el('div', {}, T('claves.nueva')), el('code', {}, r.key),
      ' ', el('button', { type: 'button', class: 'mini', onclick: () => copiar(r.key) }, T('copiar')));
    $('#claveNombre').value = '';
    cargarClaves();
  } catch (e) { avisar(msgError(e)); }
});
$('#borrarTodo').addEventListener('click', async () => {
  if (!confirm(T('datos.confirmar'))) return;
  try {
    await api('DELETE', '/api/me', null, true);
    avisar(T('datos.borrados'));
    cargarAportes(); cargarClaves(); cargarProyectos(); cargarSugerencias();
  } catch (e) { avisar(msgError(e)); }
});

// ── arranque
$('#ejemploCurl').textContent =
  `curl "${location.origin}${BASE}/api/v1/requirements?category=messaging&max_priority=2&include=tests,accelerators&format=md"`;
$('#ejemploCli').textContent =
  `curl -fsSL ${location.origin}${BASE}/reqdb.mjs -o reqdb.mjs\nnode reqdb.mjs pull --category messaging --max-priority 2`;
pintarPrio(); pintarKinds(); pintarOrden(); pintarTitulo();

// Al cambiar de idioma se vuelve a pintar todo lo que genera este script (lo estático lo hace i18n.js).
function renderTodo() {
  pintarPrio(); pintarLeyenda(); pintarTitulo(); pintarFiltros(); pintarEstadosProyecto(); pintarLista();
  $('#btnCuenta').textContent = T(sesion ? 'cuenta.salir' : 'cuenta.entrar');
  if (sesion) { cargarProyectos(); cargarAportes(); cargarClaves(); cargarSugerencias(); }
}
(async () => {
  try {
    estado.categorias = (await api('GET', '/api/v1/categories')).categories;
    // Enlaces desde el mapa (mapa.html): ?q=<texto> lanza esa búsqueda.
    const qUrl = new URLSearchParams(location.search).get('q')?.trim().slice(0, 200);
    if (qUrl) { estado.q = qUrl; $('#q').value = qUrl; pintarResumenes(); }
    pintarFiltros();
  } catch (e) { $('#estado').textContent = msgError(e); }
  await buscar();
  iniciarSesion();
})();
