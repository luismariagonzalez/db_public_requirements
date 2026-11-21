// Coordenadas 2D del mapa por vecindad: t-SNE exacto (van der Maaten y Hinton, 2008) sobre la
// similitud coseno de los embeddings. Sustituye al PCA de lib/proyeccion.mjs, que solo proyectaba
// sobre los dos ejes de más varianza y dejaba los temas apelmazados unos sobre otros: aquí lo que
// es parecido en significado queda junto y los temas distintos se separan en islas.
//
// Determinista (sin azar): el inicio es la proyección PCA de proyeccion.mjs (reducida a escala
// pequeña), así que los mismos vectores dan las mismas coordenadas. Exacto es O(n²) por iteración:
// con ~2.000 requisitos son unos 20-40 s en Node, aceptable para un script de mantenimiento
// (mapa_calcular.mjs); la petición web nunca lo ejecuta.
//
// Módulo puro: sin red, sin base.

import { ajustar, proyectar } from './proyeccion.mjs';

export const VERSION_TSNE = 2;
export const MAX_PUNTOS = 6000;   // la matriz n×n de Float32 con 6.000 puntos ya pesa 144 MB

const LIMITE = 2;                 // fuera de ±2 (en unidades de escala) se recorta, como en el PCA
const redondear5 = (x) => Number(x.toFixed(5)) + 0;

// Distancias euclídeas² entre vectores normalizados (= 2 − 2·coseno). Devuelve Float32Array n×n.
function distancias(vectores) {
  const n = vectores.length, d = vectores[0].length;
  const unit = vectores.map((v) => {
    let s = 0; for (let i = 0; i < d; i++) s += v[i] * v[i];
    const k = 1 / (Math.sqrt(s) || 1);
    return Float64Array.from(v, (x) => x * k);
  });
  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const a = unit[i];
    for (let j = i + 1; j < n; j++) {
      const b = unit[j];
      let p = 0; for (let k = 0; k < d; k++) p += a[k] * b[k];
      const dd = Math.max(0, 2 - 2 * p);
      D[i * n + j] = dd; D[j * n + i] = dd;
    }
  }
  return D;
}

// Afinidades P simétricas: por búsqueda binaria de la precisión de cada punto hasta la perplejidad pedida.
function afinidades(D, n, perplejidad) {
  const P = new Float32Array(n * n);
  const objetivo = Math.log(perplejidad);
  const fila = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let beta = 1, lo = 0, hi = Infinity;
    for (let it = 0; it < 60; it++) {
      let suma = 0, sumaD = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) { fila[j] = 0; continue; }
        const e = Math.exp(-D[i * n + j] * beta);
        fila[j] = e; suma += e; sumaD += D[i * n + j] * e;
      }
      if (suma < 1e-300) { hi = beta; beta = (lo + hi) / 2; continue; }
      const H = Math.log(suma) + beta * sumaD / suma;
      const dif = H - objetivo;
      if (Math.abs(dif) < 1e-5) break;
      if (dif > 0) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; }
      else { hi = beta; beta = (beta + lo) / 2; }
    }
    let suma = 0; for (let j = 0; j < n; j++) suma += fila[j];
    suma = suma || 1;
    for (let j = 0; j < n; j++) P[i * n + j] = fila[j] / suma;
  }
  // simetrizar y normalizar: p_ij = (p_j|i + p_i|j) / 2n
  const k = 1 / (2 * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = (P[i * n + j] + P[j * n + i]) * k;
    P[i * n + j] = v; P[j * n + i] = v;
  }
  return P;
}

// Inicio determinista: PCA a 2D, centrado y reducido a desviación típica `escala`.
function inicioPCA(vectores, escala) {
  const modelo = ajustar(vectores);
  const Y = new Float64Array(vectores.length * 2);
  vectores.forEach((v, i) => { const [x, y] = proyectar(modelo, v); Y[2 * i] = x; Y[2 * i + 1] = y; });
  const n = vectores.length;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += Y[2 * i]; my += Y[2 * i + 1]; }
  mx /= n; my /= n;
  let s = 0; for (let i = 0; i < n; i++) { Y[2 * i] -= mx; Y[2 * i + 1] -= my; s += Y[2 * i] ** 2 + Y[2 * i + 1] ** 2; }
  const sd = Math.sqrt(s / (2 * n)) || 1;
  for (let i = 0; i < Y.length; i++) Y[i] *= escala / sd;
  return Y;
}

// vectores: Float64Array[] → [[x, y], …] (cerca de [-1, 1]; mismo orden que la entrada).
export function disponer(vectores, { perplejidad = 30, iteraciones = 600, exageracion = 12, iterExageracion = 200 } = {}) {
  const n = vectores.length;
  if (n < 3) throw new Error('hacen falta al menos 3 vectores');
  if (n > MAX_PUNTOS) throw new Error(`demasiados puntos para t-SNE exacto (${n} > ${MAX_PUNTOS})`);
  const perp = Math.max(2, Math.min(perplejidad, (n - 1) / 3));
  const D = distancias(vectores);
  const P = afinidades(D, n, perp);

  const Y = inicioPCA(vectores, 0.1);
  const dY = new Float64Array(2 * n), ganancia = new Float64Array(2 * n).fill(1), grad = new Float64Array(2 * n);
  const lr = Math.max(200, n / 12);
  const num = new Float32Array(n * n);

  for (let it = 0; it < iteraciones; it++) {
    const ex = it < iterExageracion ? exageracion : 1;
    const momento = it < iterExageracion ? 0.5 : 0.8;
    // numeradores 1/(1+d²) y su suma
    let Z = 0;
    for (let i = 0; i < n; i++) {
      const xi = Y[2 * i], yi = Y[2 * i + 1];
      for (let j = i + 1; j < n; j++) {
        const dx = xi - Y[2 * j], dy = yi - Y[2 * j + 1];
        const q = 1 / (1 + dx * dx + dy * dy);
        num[i * n + j] = q; num[j * n + i] = q; Z += 2 * q;
      }
    }
    grad.fill(0);
    const invZ = 1 / Z;
    for (let i = 0; i < n; i++) {
      const xi = Y[2 * i], yi = Y[2 * i + 1];
      let gx = 0, gy = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const q = num[i * n + j];
        const m = (ex * P[i * n + j] - q * invZ) * q;
        gx += m * (xi - Y[2 * j]); gy += m * (yi - Y[2 * j + 1]);
      }
      grad[2 * i] = 4 * gx; grad[2 * i + 1] = 4 * gy;
    }
    for (let k = 0; k < 2 * n; k++) {
      ganancia[k] = (Math.sign(grad[k]) !== Math.sign(dY[k])) ? ganancia[k] + 0.2 : ganancia[k] * 0.8;
      if (ganancia[k] < 0.01) ganancia[k] = 0.01;
      dY[k] = momento * dY[k] - lr * ganancia[k] * grad[k];
      Y[k] += dY[k];
    }
    // centrar
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += Y[2 * i]; my += Y[2 * i + 1]; }
    mx /= n; my /= n;
    for (let i = 0; i < n; i++) { Y[2 * i] -= mx; Y[2 * i + 1] -= my; }
  }

  // escala común (percentil 99 del valor absoluto) para que el rango sea ≈ [-1, 1], con recorte en ±2
  const abs = Array.from(Y, Math.abs).sort((a, b) => a - b);
  const p99 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.99))] || 1;
  const f = (v) => redondear5(Math.max(-LIMITE, Math.min(LIMITE, v / p99)));
  return Array.from({ length: n }, (_, i) => [f(Y[2 * i]), f(Y[2 * i + 1])]);
}
