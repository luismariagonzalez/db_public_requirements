// El mapa 2D de requisitos: un lienzo con zoom y arrastre, puntos coloreados por una dimensión,
// buscador que resalta y tarjeta con el detalle. Todo el texto de la base se pinta con textContent
// (los requisitos los escribe la comunidad: datos no confiables). La lógica pura está en mapa_logica.js.
import { iniciar, t as T, tn as TN, fecha as FECHA } from './i18n.js';
import { DIMENSIONES, leyenda, colorDe, claveDe, frecuenciaTemas, aPantalla, encuadrar, zoomEn, desplazar, radio, palabras,
  coincide, ordenDeDibujo, notables, urlAbrir, legible, hayMapa, GRIS } from './mapa_logica.js';

const $ = (s) => document.querySelector(s);
const BASE = new URL('./', location.href).pathname.replace(/\/$/, '');   // la app puede colgar de otra ruta
const MAX_LISTA = 30;

const est = {
  puntos: [], nombres: new Map(), generado: null,
  dim: 'archetype', q: '', ws: [],
  ley: [], colorDe: () => GRIS, aislado: null,           // aislado: un color de la leyenda, o null
  frec: new Map(), claves: [], colores: [], activos: [], orden: [],
  vista: { cx: 0, cy: 0, k: 100 }, ajuste: { cx: 0, cy: 0, k: 100 },
  ancho: 0, alto: 0, dpr: 1, sel: -1, hover: -1, sucio: true, listo: false,
};

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

const nombreDe = (slug) => est.nombres.get(slug) ?? legible(slug);
const nombreClave = (clave, dim) => {
  if (clave === null) return T('mapa.leyenda.otros');
  if (dim === 'kind') return T(`mapa.kind.${clave}`);
  if (dim === 'priority') return `${T('mapa.prio', { n: clave })} · ${T(`p${clave}.n`)}`;
  return nombreDe(clave);
};

// ── datos
async function pedir(ruta) {
  const r = await fetch(BASE + ruta);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j;
}

async function cargar() {
  mostrarEstado('cargando');
  const [mapa, cats] = await Promise.allSettled([pedir('/api/v1/map'), pedir('/api/v1/categories')]);
  if (mapa.status === 'rejected') return mostrarEstado('error', mapa.reason?.message ?? '');
  if (cats.status === 'fulfilled') est.nombres = new Map((cats.value.categories ?? []).map((c) => [c.slug, c.name]));
  est.puntos = (mapa.value.points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  est.generado = mapa.value.generated_at ?? null;
  if (!hayMapa(est.puntos)) return mostrarEstado('vacio');

  est.frec = frecuenciaTemas(est.puntos);
  est.orden = ordenDeDibujo(est.puntos);
  est.listo = true;
  mostrarEstado(null);
  $('#mapaApp').hidden = false;
  recalcularColores();
  redimensionar(true);
  renderTodo();
}

// ── estados (cargando, error, vacío)
function mostrarEstado(tipo, detalle = '') {
  const caja = $('#mapaEstado');
  caja.hidden = !tipo;
  if (!tipo) return;
  $('#mapaApp').hidden = true;
  if (tipo === 'cargando') caja.replaceChildren(el('p', {}, T('mapa.estado.cargando')));
  else if (tipo === 'error') caja.replaceChildren(el('p', {}, T('mapa.estado.error', { msg: detalle })),
    el('button', { type: 'button', class: 'boton', onclick: cargar }, T('mapa.reintentar')));
  else caja.replaceChildren(el('h2', {}, T('mapa.estado.vacio.t')), el('p', {}, T('mapa.estado.vacio.p')),
    el('a', { class: 'boton', href: './' }, T('mapa.estado.vacio.enlace')));
  caja.dataset.tipo = tipo; caja.dataset.detalle = detalle;
}

// ── color y búsqueda
function recalcularColores() {
  est.ley = leyenda(est.puntos, est.dim);
  est.colorDe = colorDe(est.ley);
  est.claves = est.puntos.map((p) => claveDe(p, est.dim, est.frec));
  est.colores = est.claves.map((c) => est.colorDe(c));
  if (est.aislado && !est.ley.some((l) => l.color === est.aislado)) est.aislado = null;
  recalcularActivos();
}

function recalcularActivos() {
  est.activos = est.puntos.map((p, i) => (!est.aislado || est.colores[i] === est.aislado) && coincide(p, est.ws, nombreDe));
  est.sucio = true;
}

const hayFiltro = () => est.ws.length > 0 || est.aislado !== null;
const coinciden = () => est.puntos.filter((_, i) => est.activos[i]);

// ── pintado de la parte HTML
function pintarLeyenda() {
  $('#mapaLeyenda').replaceChildren(...est.ley.map((l) => el('li', {},
    el('button', { type: 'button', class: 'mapa-ley', 'aria-pressed': String(est.aislado === l.color),
      onclick: () => { est.aislado = est.aislado === l.color ? null : l.color; recalcularActivos(); renderTodo(); } },
    el('span', { class: 'mapa-muestra', 'aria-hidden': 'true' }),
    el('span', {}, nombreClave(l.clave, est.dim)), el('span', { class: 'n' }, String(l.n))))));
  [...$('#mapaLeyenda').querySelectorAll('.mapa-muestra')].forEach((m, i) => { m.style.background = est.ley[i].color; });
}

function pintarCuenta() {
  const n = coinciden().length;
  $('#mapaCuenta').textContent = hayFiltro() ? TN('mapa.coinciden', n) : TN('mapa.cuenta', est.puntos.length);
  const sin = hayFiltro() && n === 0;
  $('#mapaSinCoincidencias').hidden = !sin;
  if (sin) $('#mapaSinCoincidencias').textContent = T('mapa.sin.coincidencias', { q: est.q.trim() || '…' });
}

function pintarLista() {
  const lista = hayFiltro() ? notables(coinciden(), MAX_LISTA) : notables(est.puntos, MAX_LISTA);
  $('#mapaListaT').textContent = T(hayFiltro() ? 'mapa.lista.coinciden' : 'mapa.lista.notables');
  $('#mapaLista').replaceChildren(...lista.map((p) => el('li', {},
    el('button', { type: 'button', class: 'mapa-item', onclick: () => seleccionar(est.puntos.indexOf(p), true) },
      el('span', {}, p.title), el('span', { class: 'mono tenue' }, T('mapa.prio', { n: p.priority ?? '?' }))))));
}

function pintarTarjeta() {
  const caja = $('#mapaCard');
  const p = est.puntos[est.sel];
  caja.hidden = !p;
  if (!p) return;
  const dl = el('dl', { class: 'mapa-datos' },
    el('dt', {}, T('mapa.card.clase')), el('dd', {}, p.kind ? T(`mapa.kind.${p.kind}`) : '—'),
    el('dt', {}, T('mapa.card.tipo')), el('dd', {}, p.app_type ? nombreDe(p.app_type) : T('mapa.card.ninguno')),
    el('dt', {}, T('mapa.card.temas')), el('dd', {}, (p.topics ?? []).length ? p.topics.map(nombreDe).join(', ') : T('mapa.card.ninguno')));
  const prio = el('span', { class: `chip p${p.priority}` }, `${T('mapa.prio', { n: p.priority ?? '?' })} · ${T(`p${p.priority}.n`)}`);
  caja.replaceChildren(
    el('button', { type: 'button', class: 'mapa-cerrar', 'aria-label': T('mapa.card.cerrar'), onclick: () => seleccionar(-1) }, '×'),
    el('h2', { id: 'mapaCardT' }, p.title),
    el('div', { class: 'mapa-chips' }, prio, el('span', { class: 'chip' }, TN('mapa.card.copias', p.copies ?? 0))),
    dl,
    el('a', { class: 'boton acento-b', href: urlAbrir(p) }, T('mapa.card.abrir')));
}

function pintarPie() {
  $('#mapaGenerado').textContent = est.generado ? T('mapa.generado', { fecha: FECHA(est.generado) }) : '';
  $('#mapaCanvas').setAttribute('aria-label', T('mapa.canvas.aria', { n: est.puntos.length }));
}

function renderTodo() {
  document.title = T('mapa.meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', T('mapa.meta.description'));
  if ($('#mapaEstado').dataset.tipo && !$('#mapaEstado').hidden) return mostrarEstado($('#mapaEstado').dataset.tipo, $('#mapaEstado').dataset.detalle);
  if (!est.listo) return;
  pintarLeyenda(); pintarCuenta(); pintarLista(); pintarTarjeta(); pintarPie();
  est.sucio = true;
}

// ── selección
function seleccionar(i, centrar = false) {
  est.sel = i;
  if (i >= 0 && centrar) {
    const p = est.puntos[i];
    est.vista = { cx: p.x, cy: p.y, k: Math.max(est.vista.k, est.ajuste.k * 4) };
  }
  pintarTarjeta();
  est.sucio = true;
  if (i >= 0 && centrar) $('#mapaCanvas').focus({ preventScroll: true });
}

// ── dibujo
const canvas = $('#mapaCanvas');
const ctx = canvas.getContext('2d');

function redimensionar(encajar = false) {
  const r = $('#mapaLienzo').getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  est.dpr = Math.min(3, window.devicePixelRatio || 1);
  const cambio = Math.round(r.width) !== est.ancho || Math.round(r.height) !== est.alto;
  est.ancho = Math.round(r.width); est.alto = Math.round(r.height);
  canvas.width = Math.round(est.ancho * est.dpr); canvas.height = Math.round(est.alto * est.dpr);
  if (encajar || !est.listo || (cambio && !est.movido)) { est.ajuste = encuadrar(est.puntos, est.ancho, est.alto); est.vista = { ...est.ajuste }; }
  else est.ajuste = encuadrar(est.puntos, est.ancho, est.alto);
  est.sucio = true;
}

function dibujar() {
  est.sucio = false;
  ctx.setTransform(est.dpr, 0, 0, est.dpr, 0, 0);
  ctx.clearRect(0, 0, est.ancho, est.alto);
  if (!est.listo) return;
  const { vista, ancho, alto } = est;
  const filtrando = hayFiltro();
  for (const pasada of filtrando ? [false, true] : [true]) {
    ctx.globalAlpha = pasada ? 0.9 : 0.14;
    for (const i of est.orden) {
      if (filtrando && est.activos[i] !== pasada) continue;
      const p = est.puntos[i];
      const [x, y] = aPantalla(vista, ancho, alto, p.x, p.y);
      const r = radio(p.copies, vista.k, est.ajuste.k);
      if (x < -r || y < -r || x > ancho + r || y > alto + r) continue;
      ctx.fillStyle = est.colores[i];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  for (const [i, ancho2, color] of [[est.hover, 1.5, 'rgba(232,233,236,.7)'], [est.sel, 2.5, '#e8e9ec']]) {
    if (i < 0 || !est.puntos[i]) continue;
    const p = est.puntos[i];
    const [x, y] = aPantalla(vista, ancho, alto, p.x, p.y);
    ctx.lineWidth = ancho2; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(x, y, radio(p.copies, vista.k, est.ajuste.k) + 4, 0, Math.PI * 2); ctx.stroke();
  }
}
(function bucle() { if (est.sucio) dibujar(); requestAnimationFrame(bucle); })();

// ── interacción: arrastre, rueda, pellizco, clic, teclado
const kMin = () => est.ajuste.k * 0.6, kMax = () => est.ajuste.k * 80;
const punteros = new Map();
let arrastre = null, pellizco = null;

const posicion = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function bajoElPuntero(sx, sy) {
  let mejor = -1, mejorD = Infinity;
  const { vista, ancho, alto } = est;
  for (let i = 0; i < est.puntos.length; i++) {
    if (!est.activos[i]) continue;
    const p = est.puntos[i];
    const [px, py] = aPantalla(vista, ancho, alto, p.x, p.y);
    const d = Math.hypot(px - sx, py - sy);
    if (d <= radio(p.copies, vista.k, est.ajuste.k) + 4 && d < mejorD) { mejor = i; mejorD = d; }
  }
  return mejor;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  punteros.set(e.pointerId, posicion(e));
  if (punteros.size === 1) arrastre = { x: e.clientX, y: e.clientY, movido: false };
  if (punteros.size === 2) {
    arrastre = null;
    const [a, b] = [...punteros.values()];
    pellizco = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  }
});
canvas.addEventListener('pointermove', (e) => {
  const [sx, sy] = posicion(e);
  if (punteros.has(e.pointerId)) punteros.set(e.pointerId, [sx, sy]);
  if (pellizco && punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pellizco.d > 0) { est.vista = zoomEn(est.vista, d / pellizco.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, est.ancho, est.alto, kMin(), kMax()); est.movido = true; est.sucio = true; }
    pellizco.d = d;
    return;
  }
  if (arrastre && punteros.size === 1) {
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (arrastre.movido || Math.hypot(dx, dy) > 4) {
      arrastre.movido = true; est.movido = true;
      est.vista = desplazar(est.vista, dx, dy);
      arrastre.x = e.clientX; arrastre.y = e.clientY;
      canvas.classList.add('arrastrando'); ocultarPista(); est.sucio = true;
    }
    return;
  }
  if (e.pointerType === 'mouse') {                      // pasar el ratón: tarjeta corta con el título
    const i = bajoElPuntero(sx, sy);
    if (i !== est.hover) { est.hover = i; est.sucio = true; canvas.style.cursor = i >= 0 ? 'pointer' : ''; }
    if (i >= 0) mostrarPista(est.puntos[i], sx, sy); else ocultarPista();
  }
});
const soltar = (e) => {
  const era = punteros.has(e.pointerId);
  punteros.delete(e.pointerId);
  if (punteros.size < 2) pellizco = null;
  canvas.classList.remove('arrastrando');
  if (era && arrastre && !arrastre.movido && punteros.size === 0 && e.type === 'pointerup') {   // un clic, no un arrastre
    const [sx, sy] = posicion(e);
    seleccionar(bajoElPuntero(sx, sy));
  }
  if (punteros.size === 0) arrastre = null;
};
canvas.addEventListener('pointerup', soltar);
canvas.addEventListener('pointercancel', soltar);
canvas.addEventListener('pointerleave', () => { if (est.hover !== -1) { est.hover = -1; est.sucio = true; } ocultarPista(); });
canvas.addEventListener('dblclick', (e) => { const [sx, sy] = posicion(e); est.vista = zoomEn(est.vista, 2, sx, sy, est.ancho, est.alto, kMin(), kMax()); est.movido = true; est.sucio = true; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [sx, sy] = posicion(e);
  est.vista = zoomEn(est.vista, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), sx, sy, est.ancho, est.alto, kMin(), kMax());
  est.movido = true; est.sucio = true;
}, { passive: false });

function zoomCentro(f) { est.vista = zoomEn(est.vista, f, est.ancho / 2, est.alto / 2, est.ancho, est.alto, kMin(), kMax()); est.movido = true; est.sucio = true; }
function encajarTodo(puntos = est.puntos) { est.vista = encuadrar(puntos, est.ancho, est.alto); est.movido = true; est.sucio = true; }
canvas.addEventListener('keydown', (e) => {
  const paso = e.shiftKey ? 160 : 48;
  const mover = { ArrowLeft: [paso, 0], ArrowRight: [-paso, 0], ArrowUp: [0, paso], ArrowDown: [0, -paso] }[e.key];
  if (mover) { e.preventDefault(); est.vista = desplazar(est.vista, ...mover); est.movido = true; est.sucio = true; }
  else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCentro(1.4); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCentro(1 / 1.4); }
  else if (e.key === '0') { e.preventDefault(); encajarTodo(); }
  else if (e.key === 'Escape') seleccionar(-1);
  else if (e.key === 'Enter' || e.key === ' ') {         // el requisito más cercano al centro
    e.preventDefault();
    const i = bajoElPuntero(est.ancho / 2, est.alto / 2) >= 0 ? bajoElPuntero(est.ancho / 2, est.alto / 2) : cercanoAlCentro();
    if (i >= 0) seleccionar(i);
  }
});
function cercanoAlCentro() {
  let mejor = -1, mejorD = Infinity;
  est.puntos.forEach((p, i) => { if (!est.activos[i]) return; const d = Math.hypot(p.x - est.vista.cx, p.y - est.vista.cy); if (d < mejorD) { mejor = i; mejorD = d; } });
  return mejor;
}

// tarjeta corta al pasar el ratón
function mostrarPista(p, sx, sy) {
  const t = $('#mapaPista');
  t.textContent = `${p.title} · ${T('mapa.prio', { n: p.priority ?? '?' })}`;
  t.hidden = false;
  const ancho = t.offsetWidth;
  t.style.left = `${Math.max(4, Math.min(est.ancho - ancho - 4, sx + 14))}px`;
  t.style.top = `${Math.max(4, sy - 34)}px`;
}
function ocultarPista() { $('#mapaPista').hidden = true; }

// ── controles
$('#mapaZoomMas').addEventListener('click', () => zoomCentro(1.5));
$('#mapaZoomMenos').addEventListener('click', () => zoomCentro(1 / 1.5));
$('#mapaZoomTodo').addEventListener('click', () => { est.movido = false; encajarTodo(); });
$('#mapaColor').addEventListener('change', (e) => {
  est.dim = DIMENSIONES.includes(e.target.value) ? e.target.value : 'archetype';
  est.aislado = null; recalcularColores(); renderTodo();
});
let temporizador;
$('#mapaQ').addEventListener('input', (e) => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { est.q = e.target.value; est.ws = palabras(est.q); recalcularActivos(); renderTodo(); }, 120);
});
$('#mapaQ').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(temporizador);
  est.q = e.target.value; est.ws = palabras(est.q); recalcularActivos(); renderTodo();
  const acertados = coinciden();
  if (acertados.length) { encajarTodo(acertados); if (acertados.length === 1) seleccionar(est.puntos.indexOf(acertados[0])); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); $('#mapaQ').focus(); }
});
new ResizeObserver(() => redimensionar()).observe($('#mapaLienzo'));

// ── arranque
iniciar(() => renderTodo());
document.title = T('mapa.meta.title');
cargar();
