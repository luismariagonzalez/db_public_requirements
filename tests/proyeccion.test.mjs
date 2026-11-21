import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustar, proyectar, parsearVector } from '../lib/proyeccion.mjs';
import { vectorSimulado } from '../scripts/embedding_simulado.mjs';

// Tres grupos de textos con vocabulario propio: el plano debe separarlos.
const TEMAS = {
  chat: 'message conversation chat typing indicator participants read receipts group',
  pago: 'payment invoice checkout card refund subscription billing tax receipt',
  auth: 'password login session token reset account recovery email verification',
};
function corpus(n = 40) {
  const filas = [];
  for (const [tema, palabras] of Object.entries(TEMAS)) {
    const p = palabras.split(' ');
    for (let i = 0; i < n; i++) filas.push({ tema, i, vec: Float64Array.from(vectorSimulado(`${tema} ${p[i % p.length]} ${p[(i * 3 + 1) % p.length]} ${p[(i * 5 + 2) % p.length]} item${i}`)) });
  }
  return filas;
}
const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centro = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

test('parsearVector: literal de pgvector → Float64Array; lo demás, null', () => {
  assert.deepEqual([...parsearVector('[0.5,-1,2e-3]')], [0.5, -1, 0.002]);
  assert.equal(parsearVector(null), null);
  assert.equal(parsearVector('[1,x]'), null);
});

test('determinista: los mismos datos dan exactamente el mismo modelo y las mismas coordenadas', () => {
  const datos = corpus();
  const a = ajustar(datos.map((d) => d.vec)), b = ajustar(datos.map((d) => d.vec));
  assert.deepEqual(a, b);
  assert.deepEqual(datos.map((d) => proyectar(a, d.vec)), datos.map((d) => proyectar(b, d.vec)));
});

test('los ejes son ortonormales y las coordenadas caen en un rango acotado', () => {
  const m = ajustar(corpus().map((d) => d.vec));
  const punto = (u, v) => u.reduce((s, x, i) => s + x * v[i], 0);
  assert.ok(Math.abs(punto(m.ejes[0], m.ejes[0]) - 1) < 1e-6);
  assert.ok(Math.abs(punto(m.ejes[1], m.ejes[1]) - 1) < 1e-6);
  assert.ok(Math.abs(punto(m.ejes[0], m.ejes[1])) < 1e-6);
  assert.ok(m.varianza[0] >= m.varianza[1] && m.varianza[0] > 0);
  for (const d of corpus()) for (const c of proyectar(m, d.vec)) assert.ok(Math.abs(c) <= 2);
});

test('separa grupos con vocabulario distinto: lo de un tema queda más cerca de su centro que de los otros', () => {
  const datos = corpus();
  const m = ajustar(datos.map((d) => d.vec));
  const pts = datos.map((d) => ({ tema: d.tema, p: proyectar(m, d.vec) }));
  const centros = Object.fromEntries(Object.keys(TEMAS).map((t) => [t, centro(pts.filter((x) => x.tema === t).map((x) => x.p))]));
  let bien = 0;
  for (const x of pts) {
    const mas = Object.keys(centros).sort((u, v) => distancia(x.p, centros[u]) - distancia(x.p, centros[v]))[0];
    if (mas === x.tema) bien++;
  }
  assert.ok(bien / pts.length > 0.9, `solo ${bien}/${pts.length} caen en su grupo`);
});

test('estable al añadir puntos: proyectar uno nuevo con el modelo guardado NO mueve a los demás', () => {
  const datos = corpus();
  const m = ajustar(datos.map((d) => d.vec));
  const antes = datos.map((d) => proyectar(m, d.vec));
  const nuevo = Float64Array.from(vectorSimulado('payment refund invoice brand new requirement'));
  const p = proyectar(m, nuevo);                       // el modelo no se toca
  assert.deepEqual(datos.map((d) => proyectar(m, d.vec)), antes);
  assert.ok(p.every(Number.isFinite));
  // y el nuevo cae cerca de los de pagos
  const pagos = centro(datos.map((d, i) => ({ d, p: antes[i] })).filter((x) => x.d.tema === 'pago').map((x) => x.p));
  const auth = centro(datos.map((d, i) => ({ d, p: antes[i] })).filter((x) => x.d.tema === 'auth').map((x) => x.p));
  assert.ok(distancia(p, pagos) < distancia(p, auth));
});

test('estable al reajustar con unos pocos requisitos más: casi nada se mueve ni se voltea', () => {
  const datos = corpus();
  const m1 = ajustar(datos.map((d) => d.vec));
  const extra = ['chat typing', 'payment tax', 'password token', 'chat group read', 'invoice card'].map((t) => ({ vec: Float64Array.from(vectorSimulado(t + ' extra')) }));
  const todos = [...datos, ...extra];
  const m2 = ajustar(todos.map((d) => d.vec), { previo: m1 });
  const mov = datos.map((d) => distancia(proyectar(m1, d.vec), proyectar(m2, d.vec)));
  const medio = mov.reduce((s, x) => s + x, 0) / mov.length;
  assert.ok(medio < 0.15, `se mueven de media ${medio.toFixed(3)} (rango del mapa ≈ 2)`);
});

test('reajustar alinea signo y orden con el modelo previo (no voltea el mapa)', () => {
  const datos = corpus();
  const m1 = ajustar(datos.map((d) => d.vec));
  // un modelo previo «volteado» (eje 1 en negativo y ejes intercambiados) debe imponerse al signo natural
  const volteado = { ...m1, ejes: [m1.ejes[1].map((x) => -x), m1.ejes[0]] };
  const m2 = ajustar(datos.map((d) => d.vec), { previo: volteado });
  const punto = (u, v) => u.reduce((s, x, i) => s + x * v[i], 0);
  assert.ok(punto(m2.ejes[0], volteado.ejes[0]) > 0.99);
  assert.ok(punto(m2.ejes[1], volteado.ejes[1]) > 0.99);
});

test('casos límite: pocos puntos, puntos idénticos y dimensiones que no casan', () => {
  const uno = ajustar([Float64Array.from(vectorSimulado('solo uno'))]);
  assert.ok(proyectar(uno, Float64Array.from(vectorSimulado('solo uno'))).every(Number.isFinite));
  const iguales = Array.from({ length: 5 }, () => Float64Array.from(vectorSimulado('mismo texto')));
  const m = ajustar(iguales);
  assert.deepEqual(proyectar(m, iguales[0]), [0, 0]);
  assert.throws(() => proyectar(m, new Float64Array(3)), /dimensiones/);
  assert.throws(() => ajustar([]), /vectores/);
});
