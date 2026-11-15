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
  incluirTests: false, incluirAceleradores: false, proyecto: null, ocultarHecho: false };
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

// ── categorías y chips
// Audiencia → dominio → categoría de software: los dos primeros acotan lo que se ve;
// lo que se busca son las categorías elegidas (o, si no hay ninguna, la audiencia/dominio).
const consulta = () => ({ ...estado, cats: categoriasEfectivas(estado) });

function chip(texto, activo, titulo, alPulsar, extra = '') {
  return el('button', { type: 'button', class: 'chip' + extra, 'aria-pressed': String(activo), title: titulo, onclick: alPulsar }, texto);
}
function alternar(lista, slug) {
  const i = lista.indexOf(slug);
  if (i >= 0) lista.splice(i, 1); else lista.push(slug);
  pintarGrupos(); buscar();
}
const grupo = (titulo, ...contenido) => el('div', { class: 'grupo' }, el('h3', {}, titulo), ...contenido);
const textoCat = (c) => (c.requirements ? `${c.name} · ${c.requirements}` : c.name);

function pintarGrupos() {
  const cont = $('#grupos'); cont.replaceChildren();
  const cs = estado.categorias;
  const porTipo = (t) => cs.filter((c) => c.type === t);

  const audiencias = porTipo('audience');
  if (audiencias.length)
    cont.append(grupo('Audience', el('div', { class: 'chips' }, ...audiencias.map((c) =>
      chip(c.name, estado.audiencias.includes(c.slug), c.description || c.name, () => alternar(estado.audiencias, c.slug))))));

  const disp = dominiosDisponibles(cs.filter((c) => c.type !== 'domain'), estado.audiencias);
  const dominios = porTipo('domain').filter((d) => !disp || disp.has(d.slug) || estado.dominios.includes(d.slug));
  if (dominios.length)
    cont.append(grupo('Domain', el('div', { class: 'chips' }, ...dominios.map((c) =>
      chip(c.name, estado.dominios.includes(c.slug), c.description || c.name, () => alternar(estado.dominios, c.slug))))));

  const nav = { audiencias: estado.audiencias, dominios: estado.dominios };
  const sw = visibles(porTipo('software_category'), { ...nav, texto: estado.filtroCat })
    .sort((a, b) => (estado.cats.includes(b.slug) - estado.cats.includes(a.slug)) || b.requirements - a.requirements || a.name.localeCompare(b.name));
  if (sw.length || estado.filtroCat)
    cont.append(grupo(`Software category (${sw.length})`,
      el('div', { class: 'chips' }, ...sw.slice(0, MAX_SOFTWARE).map((c) =>
        chip(textoCat(c), estado.cats.includes(c.slug), c.description || c.name, () => alternar(estado.cats, c.slug), c.requirements ? '' : ' vacio'))),
      sw.length > MAX_SOFTWARE ? el('p', { class: 'tenue' }, `${sw.length - MAX_SOFTWARE} more: narrow it with the audience, the domain or the filter above.`) : null));

  const tipos = visibles(porTipo('app_type'), nav);
  if (tipos.length)
    cont.append(grupo('App type', el('div', { class: 'chips' }, ...tipos.map((c) =>
      chip(textoCat(c), estado.cats.includes(c.slug), c.description || c.name, () => alternar(estado.cats, c.slug))))));

  for (const [tipo, titulo] of GRUPOS.filter(([t]) => t !== 'app_type')) {
    const lista = porTipo(tipo);
    if (lista.length)
      cont.append(grupo(titulo, el('div', { class: 'chips' }, ...lista.map((c) =>
        chip(textoCat(c), estado.cats.includes(c.slug), c.description || c.name, () => alternar(estado.cats, c.slug))))));
  }
}
$('#filtroCat').addEventListener('input', (e) => { estado.filtroCat = e.target.value; pintarGrupos(); });

// ── búsqueda y resultados
let temporizador, ultima = 0;
function buscarConRetraso() { clearTimeout(temporizador); temporizador = setTimeout(buscar, 350); }

async function buscar() {
  const yo = ++ultima;
  if (!hayFiltro(estado)) {
    estado.items = []; pintarResultados();
    $('#estado').textContent = 'Pick an audience, a software category or an app type, or type what you are looking for.';
    return;
  }
  $('#estado').textContent = 'Searching…';
  try {
    const r = await api('GET', rutaBusqueda(consulta()));
    if (yo !== ultima) return;            // llegó tarde: ya hay otra búsqueda
    estado.items = r.requirements;
    estado.sel = new Set(estado.items.map((i) => i.slug));   // por defecto, todo lo que sale
    pintarResultados();
  } catch (e) { if (yo === ultima) $('#estado').textContent = msgError(e); }
}

const ETQ_ESTADO = { planned: 'planned', in_progress: 'in progress', done: 'done', skipped: 'skipped' };
const insignia = (st) => (st ? el('span', { class: `etq est-${st}` }, ETQ_ESTADO[st]) : null);

function enlaceSugerir(tipo, slug) {
  return el('button', { type: 'button', class: 'enlace', onclick: () => sugerirSobre(tipo, slug) }, 'Suggest');
}

function pintarResultados() {
  const ul = $('#lista'); ul.replaceChildren();
  $('#acciones').hidden = !estado.items.length;
  $('#accionesProyecto').hidden = !(estado.items.length && estado.proyecto);
  if (estado.items.length) $('#estado').textContent = '';
  else if (hayFiltro(estado)) $('#estado').textContent = 'No requirements for this selection yet. Try cross-cutting concerns (security, privacy…), fewer filters, or contribute one!';
  for (const it of estado.items) {
    const cb = el('input', { type: 'checkbox', 'aria-label': `Include ${it.title}`, onchange: (ev) => {
      ev.target.checked ? estado.sel.add(it.slug) : estado.sel.delete(it.slug); actualizarCuenta();
    } });
    cb.checked = estado.sel.has(it.slug);

    const tests = (it.tests ?? []).map((t) => el('li', { class: 'anidado' },
      el('span', { class: `p p${t.priority}` }, `P${t.priority}`), ' ',
      el('span', { class: 'etq' }, `test · ${t.type}`), ' ', insignia(t.project_status), ' ',
      el('strong', {}, t.title), ': ', t.scenario, ' ', enlaceSugerir('test', t.slug)));
    const acel = (it.accelerators ?? []).map((a) => {
      const href = urlSegura(a.url);
      return el('li', { class: 'anidado' },
        el('span', { class: 'etq' }, `${a.model.replace('_', ' ')} · ${a.cost}`), ' ', insignia(a.project_status), ' ',
        href ? el('a', { href, rel: 'noopener noreferrer', target: '_blank' }, a.name) : el('strong', {}, a.name),
        ` (${a.coverage} coverage) `, enlaceSugerir('accelerator', a.slug));
    });

    ul.append(el('li', { class: 'item' }, cb, el('div', {},
      el('h4', {}, it.title, ' ', insignia(it.project_status)),
      el('p', {}, it.statement),
      it.criteria?.length ? el('ul', {}, ...it.criteria.map((c) => el('li', {}, c))) : null,
      tests.length ? el('ul', { class: 'rel' }, ...tests) : null,
      acel.length ? el('ul', { class: 'rel' }, ...acel) : null,
      el('div', { class: 'meta' },
        el('span', { class: `p p${it.priority}` }, `P${it.priority}`),
        el('span', { class: 'etq' }, it.kind),
        ...it.categories.slice(0, 6).map((c) => el('span', { class: 'etq' }, `${c.slug} · P${c.priority}`)),
        enlaceSugerir('requirement', it.slug)))));
  }
  actualizarCuenta();
}
function actualizarCuenta() {
  const n = estado.sel.size;
  $('#cuenta').textContent = `${n} of ${estado.items.length} selected`;
  $('#copiarMd').disabled = n === 0;
  $('#marcar').disabled = n === 0;
}

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); avisar('Copied'); }
  catch { avisar('Could not copy: select the text manually'); }
}
$('#selTodo').addEventListener('click', () => { estado.sel = new Set(estado.items.map((i) => i.slug)); pintarResultados(); });
$('#selNada').addEventListener('click', () => { estado.sel.clear(); pintarResultados(); });
$('#copiarMd').addEventListener('click', async () => {
  try {
    // El Markdown lo genera el servidor: así el de la web y el de la API son idénticos,
    // con tests, aceleradores y las instrucciones al agente para marcar el proyecto.
    const include = [estado.incluirTests && 'tests', estado.incluirAceleradores && 'accelerators'].filter(Boolean);
    const md = await api('POST', '/api/v1/export', { slugs: [...estado.sel], format: 'md', include,
      tests_max_priority: estado.prio, project: estado.proyecto ?? undefined });
    await copiar(md);
  } catch (e) { avisar(msgError(e)); }
});
$('#copiarUrl').addEventListener('click', () =>
  copiar(location.origin + BASE + rutaBusqueda({ ...consulta(), formato: 'md' })));
$('#q').addEventListener('input', (e) => { estado.q = e.target.value; buscarConRetraso(); });
$('#prio').addEventListener('change', (e) => { estado.prio = Number(e.target.value); buscar(); });
$('#incTests').addEventListener('change', (e) => { estado.incluirTests = e.target.checked; buscar(); });
$('#incAcel').addEventListener('change', (e) => { estado.incluirAceleradores = e.target.checked; buscar(); });
$('#proyecto').addEventListener('change', (e) => { estado.proyecto = e.target.value ? Number(e.target.value) : null; buscar(); });
$('#ocultarHecho').addEventListener('change', (e) => { estado.ocultarHecho = e.target.checked; buscar(); });

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
    const detalle = el('div', { class: 'detalle' });
    const abrir = el('button', { type: 'button', onclick: () => alternarProyecto(p, detalle, abrir) }, 'Open');
    ul.append(el('li', {},
      el('div', { class: 'fila' },
        el('strong', {}, p.name),
        el('span', { class: 'tenue' }, `${c.done} done · ${c.in_progress} in progress · ${c.planned} planned · ${c.skipped} skipped`),
        abrir,
        el('button', { type: 'button', class: 'peligro', onclick: () => borrarProyecto(p) }, 'Delete')),
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
      detalle.append(el('div', { class: 'fila item-proy' }, el('span', { class: 'etq' }, it.type), el('span', {}, it.title),
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
        k.revoked ? null : el('button', { type: 'button', class: 'peligro', onclick: () => revocar(k.id) }, 'Revoke')));
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
(async () => {
  try {
    estado.categorias = (await api('GET', '/api/v1/categories')).categories;
    pintarGrupos();
  } catch (e) { $('#estado').textContent = msgError(e); }
  await buscar();
  iniciarSesion();
})();
