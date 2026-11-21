// Lógica pura del mapa (sin document ni fetch): colores por dimensión, vista (zoom y desplazamiento),
// búsqueda y selección de puntos. Se prueba en tests/mapa_logica.test.mjs. El dibujo vive en mapa.js.

export const DIMENSIONES = ['archetype', 'topic', 'kind', 'priority'];

// Paleta categórica para fondo oscuro (luminosidad alta, tonos repartidos). El gris es «otros / sin dato».
export const PALETA = [
  'hsl(152 62% 62%)', 'hsl(208 78% 68%)', 'hsl(28 88% 64%)', 'hsl(286 56% 72%)', 'hsl(48 86% 62%)',
  'hsl(350 74% 68%)', 'hsl(184 62% 58%)', 'hsl(98 52% 62%)', 'hsl(236 66% 74%)', 'hsl(12 70% 66%)',
];
export const GRIS = 'hsl(220 8% 58%)';
export const MAX_COLORES = PALETA.length;
// Prioridad: los mismos tonos que --p1…--p5 de estilo.css (rojo = imprescindible … violeta = diferenciador).
const COLOR_PRIORIDAD = { 1: 'hsl(8 78% 68%)', 2: 'hsl(40 86% 62%)', 3: 'hsl(208 78% 68%)', 4: 'hsl(174 56% 56%)', 5: 'hsl(280 60% 74%)' };
const COLOR_CLASE = { functional: PALETA[0], technical: PALETA[1] };

// El tema «principal» de un punto: de los suyos, el más frecuente en todo el mapa (así los colores
// agrupan por temas que de verdad se ven). `frecuencias`: Map tema → nº de puntos.
export function temaPrincipal(punto, frecuencias) {
  let mejor = null;
  for (const t of punto.topics ?? []) {
    if (mejor === null || (frecuencias.get(t) ?? 0) > (frecuencias.get(mejor) ?? 0)
        || ((frecuencias.get(t) ?? 0) === (frecuencias.get(mejor) ?? 0) && t < mejor)) mejor = t;
  }
  return mejor;
}

export function frecuenciaTemas(puntos) {
  const f = new Map();
  for (const p of puntos) for (const t of p.topics ?? []) f.set(t, (f.get(t) ?? 0) + 1);
  return f;
}

// La clave de color de un punto según la dimensión (null = sin dato → gris).
export function claveDe(punto, dim, frecuencias = new Map()) {
  if (dim === 'archetype') return punto.app_type ?? null;
  if (dim === 'topic') return temaPrincipal(punto, frecuencias);
  if (dim === 'kind') return punto.kind ?? null;
  if (dim === 'priority') return punto.priority != null ? String(punto.priority) : null;
  return null;
}

// La leyenda: [{ clave, n, color }] (las que no caben en la paleta se funden en «otros», clave null).
// Prioridad y clase tienen colores y orden fijos; archetype y topic, los más frecuentes primero.
export function leyenda(puntos, dim) {
  const frec = frecuenciaTemas(puntos);
  const cuenta = new Map();
  for (const p of puntos) { const c = claveDe(p, dim, frec); cuenta.set(c, (cuenta.get(c) ?? 0) + 1); }

  if (dim === 'priority')
    return ['1', '2', '3', '4', '5'].filter((c) => cuenta.has(c)).map((c) => ({ clave: c, n: cuenta.get(c), color: COLOR_PRIORIDAD[c] }))
      .concat(cuenta.has(null) ? [{ clave: null, n: cuenta.get(null), color: GRIS }] : []);
  if (dim === 'kind') {
    const fijas = ['functional', 'technical'].filter((c) => cuenta.has(c)).map((c) => ({ clave: c, n: cuenta.get(c), color: COLOR_CLASE[c] }));
    const otros = [...cuenta].filter(([c]) => !(c in COLOR_CLASE)).reduce((s, [, n]) => s + n, 0);
    return otros ? [...fijas, { clave: null, n: otros, color: GRIS, otros: true }] : fijas;
  }

  const ordenadas = [...cuenta].filter(([c]) => c !== null)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const filas = ordenadas.slice(0, MAX_COLORES).map(([clave, n], i) => ({ clave, n, color: PALETA[i] }));
  const resto = ordenadas.slice(MAX_COLORES).reduce((s, [, n]) => s + n, 0) + (cuenta.get(null) ?? 0);
  if (resto) filas.push({ clave: null, n: resto, color: GRIS, otros: true });
  return filas;
}

// Mapa clave → color; todo lo que no esté (más allá de la paleta, o sin dato) es gris.
export function colorDe(filas) {
  const m = new Map(filas.filter((f) => f.clave !== null).map((f) => [f.clave, f.color]));
  return (clave) => m.get(clave) ?? GRIS;
}

// ── la vista: { cx, cy, k } = centro en coordenadas del mapa y píxeles por unidad.
// Pantalla: sx = ancho/2 + (x - cx)·k ; sy = alto/2 - (y - cy)·k   (y positiva hacia arriba)
export const aPantalla = (v, ancho, alto, x, y) => [ancho / 2 + (x - v.cx) * v.k, alto / 2 - (y - v.cy) * v.k];
export const aMundo = (v, ancho, alto, sx, sy) => [v.cx + (sx - ancho / 2) / v.k, v.cy - (sy - alto / 2) / v.k];

export function limites(puntos) {
  if (!puntos.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of puntos) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, x1, y0, y1 };
}

// Encuadra los puntos dados en el lienzo, con margen en píxeles. Con un solo punto (o todos iguales) no se acerca de más.
export function encuadrar(puntos, ancho, alto, margen = 36) {
  const b = limites(puntos);
  if (!b || ancho <= 0 || alto <= 0) return { cx: 0, cy: 0, k: 100 };
  const bw = Math.max(b.x1 - b.x0, 0.05), bh = Math.max(b.y1 - b.y0, 0.05);
  const k = Math.min((ancho - 2 * margen) / bw, (alto - 2 * margen) / bh);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, k: Math.max(k, 1) };
}

// Zoom por un factor alrededor de un punto de pantalla (la rueda y el pellizco), dentro de [kMin, kMax].
export function zoomEn(v, factor, sx, sy, ancho, alto, kMin, kMax) {
  const k = Math.min(kMax, Math.max(kMin, v.k * factor));
  if (k === v.k) return v;
  const [mx, my] = aMundo(v, ancho, alto, sx, sy);
  return { k, cx: mx - (sx - ancho / 2) / k, cy: my + (sy - alto / 2) / k };
}

// Desplaza la vista un número de píxeles de pantalla (arrastrar con el dedo o el ratón, flechas).
export const desplazar = (v, dx, dy) => ({ ...v, cx: v.cx - dx / v.k, cy: v.cy + dy / v.k });

// Radio del punto en píxeles: crece con las copias (raíz, para que un popular no tape a los demás) y un poco con el zoom.
export function radio(copias, k, kAjuste) {
  const base = 3.2 + Math.min(6, 1.6 * Math.sqrt(Math.max(0, copias ?? 0)));
  const zoom = Math.min(1.7, Math.max(1, Math.pow(k / (kAjuste || k), 0.25)));
  return base * zoom;
}

// ── búsqueda: todas las palabras han de aparecer en el título, el slug o los nombres de sus categorías.
const normalizar = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const palabras = (q) => normalizar(q).split(/[^a-z0-9]+/).filter(Boolean);

export function coincide(punto, ws, nombreDe = (s) => s) {
  if (!ws.length) return true;
  const pajar = normalizar(`${punto.title} ${punto.slug} ${nombreDe(punto.app_type ?? '')} ${(punto.topics ?? []).map(nombreDe).join(' ')} ${punto.kind ?? ''}`);
  return ws.every((w) => pajar.includes(w));
}

// El punto más cercano al píxel (sx, sy), dentro de su radio + tolerancia. Devuelve el índice o -1.
// Si dos solapan, gana el más cercano al centro del círculo y, en empate, el más pequeño (el de encima al dibujar).
export function masCercano(puntos, v, ancho, alto, sx, sy, kAjuste, tolerancia = 4, visible = () => true) {
  let mejor = -1, mejorD = Infinity;
  for (let i = 0; i < puntos.length; i++) {
    if (!visible(puntos[i])) continue;
    const [px, py] = aPantalla(v, ancho, alto, puntos[i].x, puntos[i].y);
    const d = Math.hypot(px - sx, py - sy);
    if (d <= radio(puntos[i].copies, v.k, kAjuste) + tolerancia && d < mejorD) { mejor = i; mejorD = d; }
  }
  return mejor;
}

// Orden de dibujo: lo grande primero y lo pequeño encima; así un punto con muchas copias no tapa a los demás.
export const ordenDeDibujo = (puntos) => puntos.map((_, i) => i).sort((a, b) => (puntos[b].copies ?? 0) - (puntos[a].copies ?? 0) || a - b);

// «Notables»: lo que se lista sin búsqueda (más copiados, luego mejor prioridad), para navegar con teclado y lector de pantalla.
export const notables = (puntos, n = 30) => [...puntos]
  .sort((a, b) => (b.copies ?? 0) - (a.copies ?? 0) || (a.priority ?? 9) - (b.priority ?? 9) || a.title.localeCompare(b.title)).slice(0, n);

// Enlace para abrir el requisito en la app (la portada lee ?q= y lanza la búsqueda). Relativo: la app puede colgar de otra ruta.
export const urlAbrir = (punto) => `./?${new URLSearchParams({ q: punto.title })}`;

// Un nombre legible cuando la API de categorías no ha respondido.
export const legible = (slug) => String(slug ?? '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ¿Hay mapa que enseñar? Hacen falta al menos 3 puntos con coordenadas finitas para que un plano tenga sentido.
export const hayMapa = (puntos) => Array.isArray(puntos) && puntos.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).length >= 3;
