import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leyenda, colorDe, claveDe, temaPrincipal, frecuenciaTemas, aPantalla, aMundo, encuadrar, zoomEn, desplazar, radio, palabras, coincide,
  masCercano, ordenDeDibujo, notables, urlAbrir, legible, hayMapa, PALETA, GRIS, MAX_COLORES } from '../web/mapa_logica.js';

const P = (slug, x, y, extra = {}) => ({ slug, title: `Title of ${slug}`, x, y, priority: 2, kind: 'functional', app_type: 'messaging', topics: [], copies: 0, ...extra });
const PUNTOS = [
  P('a', -1, -1, { app_type: 'messaging', topics: ['security', 'privacy'], copies: 9, priority: 1 }),
  P('b', 1, 1, { app_type: 'messaging', topics: ['security'], kind: 'technical', priority: 3 }),
  P('c', 0, 0.5, { app_type: 'crm', topics: ['privacy'], priority: 3 }),
  P('d', 0.5, -0.5, { app_type: null, topics: [], priority: 5 }),
];

test('leyenda por tipo de app: más frecuentes primero, sin dato en «otros» gris', () => {
  const l = leyenda(PUNTOS, 'archetype');
  assert.deepEqual(l.map((x) => [x.clave, x.n]), [['messaging', 2], ['crm', 1], [null, 1]]);
  assert.equal(l[0].color, PALETA[0]); assert.equal(l[1].color, PALETA[1]); assert.equal(l[2].color, GRIS); assert.ok(l[2].otros);
  const color = colorDe(l);
  assert.equal(color('messaging'), PALETA[0]); assert.equal(color(null), GRIS); assert.equal(color('desconocido'), GRIS);
});

test('más categorías que colores: el exceso se funde en «otros» (nunca se repiten colores)', () => {
  const muchos = Array.from({ length: MAX_COLORES + 5 }, (_, i) => P(`p${i}`, i, i, { app_type: `tipo-${String(i).padStart(2, '0')}` }));
  const l = leyenda(muchos, 'archetype');
  assert.equal(l.length, MAX_COLORES + 1);
  assert.equal(l.at(-1).n, 5);
  assert.equal(new Set(l.map((x) => x.color)).size, l.length);
});

test('leyenda por tema usa el tema más frecuente de cada punto; prioridad y clase, orden y colores fijos', () => {
  const frec = frecuenciaTemas(PUNTOS);
  assert.equal(frec.get('security'), 2);
  assert.equal(frec.get('privacy'), 2);
  assert.equal(temaPrincipal(PUNTOS[0], frec), 'privacy');     // empate a 2 → el primero por orden alfabético
  assert.equal(temaPrincipal(PUNTOS[1], frec), 'security');    // sin empate: el único tema que tiene
  assert.deepEqual(leyenda(PUNTOS, 'priority').map((x) => x.clave), ['1', '3', '5']);
  assert.deepEqual(leyenda(PUNTOS, 'kind').map((x) => x.clave), ['functional', 'technical']);
  assert.equal(claveDe(PUNTOS[3], 'topic', frec), null);
  assert.equal(claveDe(PUNTOS[1], 'priority'), '3');
});

test('vista: encuadrar mete todos los puntos con margen y pantalla ↔ mundo son inversas', () => {
  const v = encuadrar(PUNTOS, 800, 500, 40);
  for (const p of PUNTOS) {
    const [sx, sy] = aPantalla(v, 800, 500, p.x, p.y);
    assert.ok(sx >= 39 && sx <= 761 && sy >= 39 && sy <= 461, `${p.slug} fuera: ${sx},${sy}`);
    const [x, y] = aMundo(v, 800, 500, sx, sy);
    assert.ok(Math.abs(x - p.x) < 1e-9 && Math.abs(y - p.y) < 1e-9);
  }
  // y positiva hacia arriba
  assert.ok(aPantalla(v, 800, 500, 0, 1)[1] < aPantalla(v, 800, 500, 0, -1)[1]);
  // con un solo punto no se acerca de más ni da NaN
  const uno = encuadrar([P('x', 0.3, 0.3)], 800, 500);
  assert.ok(Number.isFinite(uno.k) && uno.k < 20000);
  assert.deepEqual(encuadrar([], 800, 500), { cx: 0, cy: 0, k: 100 });
});

test('zoom alrededor del cursor deja quieto el punto que hay debajo, y respeta los límites', () => {
  const v = encuadrar(PUNTOS, 800, 500);
  const [mx, my] = aMundo(v, 800, 500, 600, 120);
  const z = zoomEn(v, 2, 600, 120, 800, 500, v.k * 0.5, v.k * 50);
  const [sx, sy] = aPantalla(z, 800, 500, mx, my);
  assert.ok(Math.abs(sx - 600) < 1e-6 && Math.abs(sy - 120) < 1e-6);
  assert.equal(z.k, v.k * 2);
  assert.equal(zoomEn(v, 1000, 0, 0, 800, 500, v.k * 0.5, v.k * 50).k, v.k * 50);
  assert.equal(zoomEn(v, 0.0001, 0, 0, 800, 500, v.k * 0.5, v.k * 50).k, v.k * 0.5);
});

test('desplazar mueve la vista en el sentido del arrastre', () => {
  const v = { cx: 0, cy: 0, k: 100 };
  const d = desplazar(v, 50, 20);                          // arrastrar 50 px a la derecha, 20 abajo
  assert.deepEqual(aPantalla(d, 800, 500, 0, 0), [450, 270]);   // el origen se movió igual
});

test('radio crece con las copias (sin pasarse) y un poco con el zoom', () => {
  assert.ok(radio(0, 100, 100) < radio(4, 100, 100));
  assert.ok(radio(10_000, 100, 100) <= 9.2 * 1.01);
  assert.ok(radio(1, 400, 100) > radio(1, 100, 100));
  assert.ok(Number.isFinite(radio(undefined, 100, 0)));
});

test('búsqueda: todas las palabras, sin tildes ni mayúsculas, en título, slug, tipo de app y temas', () => {
  const nombres = { messaging: 'Messaging app', security: 'Security', privacy: 'Privacy' };
  const nom = (s) => nombres[s] ?? s;
  assert.deepEqual(palabras('  Título-ÁÉ  b2b '), ['titulo', 'ae', 'b2b']);
  assert.ok(coincide(PUNTOS[0], palabras('messaging security'), nom));
  assert.ok(coincide(PUNTOS[0], palabras('TITLE OF A'), nom));
  assert.ok(!coincide(PUNTOS[2], palabras('messaging'), nom));
  assert.ok(coincide(PUNTOS[2], [], nom), 'sin consulta, todo coincide');
  assert.ok(coincide(PUNTOS[1], palabras('technical'), nom));
});

test('masCercano: acierta dentro del radio, ignora lo que no está activo y no da nada lejos', () => {
  const v = { cx: 0, cy: 0, k: 100 };
  const sx = aPantalla(v, 800, 500, PUNTOS[1].x, PUNTOS[1].y);
  assert.equal(masCercano(PUNTOS, v, 800, 500, sx[0] + 2, sx[1] - 2, 100), 1);
  assert.equal(masCercano(PUNTOS, v, 800, 500, sx[0] + 60, sx[1], 100), -1);
  assert.equal(masCercano(PUNTOS, v, 800, 500, sx[0], sx[1], 100, 4, (p) => p.slug !== 'b'), -1);
});

test('orden de dibujo: lo más copiado primero (queda debajo); notables: copias, luego prioridad', () => {
  assert.equal(ordenDeDibujo(PUNTOS)[0], 0);
  assert.deepEqual(notables(PUNTOS, 2).map((p) => p.slug), ['a', 'b']);   // a (9 copias); b y c y d con 0: prioridad 3 → b por título
  assert.equal(notables(PUNTOS, 100).length, 4);
});

test('enlace a la app: relativo y con el título bien codificado; nombres legibles de reserva', () => {
  const u = urlAbrir(P('x', 0, 0, { title: 'Reset a & b?' }));
  assert.equal(u, './?q=Reset+a+%26+b%3F');
  assert.equal(legible('cross-cutting-thing'), 'Cross cutting thing');
});

test('hay mapa solo con 3 o más puntos con coordenadas finitas', () => {
  assert.equal(hayMapa(PUNTOS), true);
  assert.equal(hayMapa(PUNTOS.slice(0, 2)), false);
  assert.equal(hayMapa([]), false);
  assert.equal(hayMapa(null), false);
  assert.equal(hayMapa([P('a', 0, 0), P('b', NaN, 1), P('c', 1, 1)]), false);
});
