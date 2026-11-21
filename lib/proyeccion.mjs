// Proyección de los embeddings (768 dimensiones) a un plano 2D para el mapa de requisitos.
//
// (Ya no genera el mapa: lo hace lib/mapa_tsne.mjs, que usa este PCA solo como inicio determinista.)
// Por qué PCA (componentes principales por iteración de subespacio) y no UMAP/t-SNE:
//   · Determinista: mismos datos → mismas coordenadas, sin semillas ni azar de por medio (la
//     inicialización de la iteración es un vector fijo; con un modelo previo, el suyo).
//   · Estable: es un MODELO (media + 2 ejes + escala) que se guarda. Un requisito nuevo se
//     proyecta con el modelo guardado y NO mueve a los demás. Solo al reajustar (--refit) se
//     recalculan los ejes, y entonces se alinean con los anteriores (mismo signo, mismo orden)
//     para que el mapa no se voltee ni se gire entero.
//   · Barata y sin dependencias: O(n·d) por iteración, sin matriz de n×n (t-SNE exacto es O(n²)).
//   · Fiel: las distancias del plano son proyecciones de distancias reales; UMAP/t-SNE deforman
//     las distancias globales y su resultado cambia con cada pequeño cambio de datos.
// A cambio, los grupos salen menos separados que con t-SNE; el mapa pinta color por categoría
// y tiene buscador, que compensan. Si algún día hace falta más separación, se puede refinar el
// resultado de aquí (como inicialización) con una pasada de t-SNE sin tocar el resto.
//
// Módulo puro: sin red, sin base, sin `document`.

export const VERSION_MODELO = 1;

// Vector fijo de arranque (generador determinista de Numerical Recipes), no `Math.random`.
function arranque(d, semilla) {
  let s = semilla >>> 0;
  const v = new Float64Array(d);
  for (let i = 0; i < d; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; v[i] = s / 4294967296 - 0.5; }
  return v;
}
const punto = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function normalizar(v) {
  const n = Math.sqrt(punto(v, v));
  if (n < 1e-12) return false;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return true;
}
function quitarComponente(v, base) {
  const c = punto(v, base);
  for (let i = 0; i < v.length; i++) v[i] -= c * base[i];
}

// '[0.1,0.2,…]' (el literal de pgvector) → Float64Array. Devuelve null si no es un vector.
export function parsearVector(texto) {
  if (typeof texto !== 'string' || texto[0] !== '[') return null;
  const partes = texto.slice(1, -1).split(',');
  const v = new Float64Array(partes.length);
  for (let i = 0; i < partes.length; i++) { v[i] = Number(partes[i]); if (!Number.isFinite(v[i])) return null; }
  return v;
}

// w = Xᵀ·(X·v): producto con la covarianza SIN formar la matriz (O(n·d)).
function porCovarianza(centrados, d, v) {
  const w = new Float64Array(d);
  for (const x of centrados) {
    const p = punto(x, v);
    if (p !== 0) for (let i = 0; i < d; i++) w[i] += p * x[i];
  }
  return w;
}

// Los dos primeros ejes por ITERACIÓN DE SUBESPACIO (potencia sobre dos vectores a la vez, con
// Gram-Schmidt en cada paso) y un Rayleigh-Ritz final de 2×2. Converge según λ3/λ2 en vez de λ2/λ1:
// cuando los dos primeros autovalores son casi iguales (varios grupos parecidos de grandes) la
// iteración de potencia clásica tardaría una eternidad en fijar el reparto entre ejes, y el mapa
// cambiaría de un cálculo a otro. Así el PLANO queda fijo y el giro dentro de él lo decide el 2×2.
function dosEjes(centrados, d, { inicio, iteraciones, tol }) {
  const base = inicio.map((v) => Float64Array.from(v));
  const ortonormalizar = (Q) => {
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j < k; j++) quitarComponente(Q[k], Q[j]);
      if (!normalizar(Q[k])) {                // dirección sin varianza o paralela a la anterior: otra fija
        Q[k] = arranque(d, 7 + k);
        for (let j = 0; j < k; j++) quitarComponente(Q[k], Q[j]);
        normalizar(Q[k]);
      }
    }
    return Q;
  };
  let Q = ortonormalizar(base);
  for (let it = 0; it < iteraciones; it++) {
    const W = ortonormalizar(Q.map((q) => porCovarianza(centrados, d, q)));
    let cambio = 0;
    for (let k = 0; k < 2; k++) for (let i = 0; i < d; i++) cambio += (W[k][i] - Q[k][i]) ** 2;
    Q = W;
    if (cambio < tol * tol) break;
  }
  // Rayleigh-Ritz: la covarianza restringida al plano es una matriz simétrica 2×2 [[a, b], [b, c]].
  const AQ = Q.map((q) => porCovarianza(centrados, d, q));
  const a = punto(Q[0], AQ[0]), b = punto(Q[0], AQ[1]), c = punto(Q[1], AQ[1]);
  const theta = 0.5 * Math.atan2(2 * b, a - c);
  const co = Math.cos(theta), si = Math.sin(theta);
  const e1 = Float64Array.from(Q[0], (x, i) => co * x + si * Q[1][i]);
  const e2 = Float64Array.from(Q[0], (x, i) => -si * x + co * Q[1][i]);
  const medio = (a + c) / 2, mitad = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  return { ejes: [e1, e2], autovalores: [medio + mitad, medio - mitad] };
}

// Ajusta el modelo a los vectores (Float64Array[]). `previo` (modelo anterior) sirve de inicio y para
// alinear signos y orden, de modo que reajustar con datos casi iguales da casi el mismo mapa.
export function ajustar(vectores, { previo = null, iteraciones = 300, tol = 1e-10 } = {}) {
  const n = vectores.length;
  if (n < 1) throw new Error('hacen falta vectores para ajustar la proyección');
  const d = vectores[0].length;
  const media = new Float64Array(d);
  for (const v of vectores) for (let i = 0; i < d; i++) media[i] += v[i] / n;
  const centrados = vectores.map((v) => { const c = new Float64Array(d); for (let i = 0; i < d; i++) c[i] = v[i] - media[i]; return c; });

  const previoOk = previo && previo.dims === d && previo.ejes?.length === 2;
  const inicio = previoOk ? previo.ejes : [arranque(d, 12345), arranque(d, 12346)];
  const r = dosEjes(centrados, d, { inicio, iteraciones, tol });
  let ejes = r.ejes, autovalores = r.autovalores;

  if (previoOk) {                              // mismo orden y mismo signo que el mapa anterior
    const prev = previo.ejes.map((e) => Float64Array.from(e));
    const cruzado = Math.abs(punto(ejes[0], prev[1])) + Math.abs(punto(ejes[1], prev[0]));
    const directo = Math.abs(punto(ejes[0], prev[0])) + Math.abs(punto(ejes[1], prev[1]));
    if (cruzado > directo) { ejes = [ejes[1], ejes[0]]; autovalores = [autovalores[1], autovalores[0]]; }
    ejes = ejes.map((e, k) => (punto(e, prev[k]) < 0 ? e.map((x) => -x) : e));
  } else {                                     // sin previo: signo fijado por la coordenada de mayor valor absoluto
    ejes = ejes.map((e) => {
      let m = 0; for (let i = 1; i < d; i++) if (Math.abs(e[i]) > Math.abs(e[m])) m = i;
      return e[m] < 0 ? e.map((x) => -x) : e;
    });
  }

  // Escala común (conserva las proporciones): el percentil 99 del valor absoluto de ambas proyecciones.
  // Con la escala guardada, los puntos nuevos caen en el mismo rango sin mover a los viejos.
  const abs = [];
  for (const c of centrados) { abs.push(Math.abs(punto(c, ejes[0])), Math.abs(punto(c, ejes[1]))); }
  abs.sort((x, y) => x - y);
  const p99 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.99))] || 1;
  const escala = p99 > 1e-12 ? p99 : 1;

  let total = 0; for (const c of centrados) total += punto(c, c);
  return {
    version: VERSION_MODELO, dims: d, n,
    media: Array.from(media, redondear),
    ejes: ejes.map((e) => Array.from(e, redondear)),
    escala: redondear(escala),
    // fracción de la varianza total que explica cada eje (para saber cuánto «ve» el mapa)
    varianza: autovalores.map((l) => (total > 0 ? redondear(l / total) : 0)),
  };
}

const redondear = (x) => Number(x.toPrecision(10));
const LIMITE = 2;   // fuera de ±2 (en unidades de escala) se recorta: un punto lejano no debe aplastar el resto

// Proyecta un vector con un modelo ya ajustado → [x, y] (cerca de [-1, 1]).
export function proyectar(modelo, vector) {
  const { media, ejes, escala } = modelo;
  if (vector.length !== media.length) throw new Error('el vector no tiene las dimensiones del modelo');
  let x = 0, y = 0;
  for (let i = 0; i < vector.length; i++) { const c = vector[i] - media[i]; x += c * ejes[0][i]; y += c * ejes[1][i]; }
  const f = (p) => Math.max(-LIMITE, Math.min(LIMITE, p / escala));
  return [Number(f(x).toFixed(5)) + 0, Number(f(y).toFixed(5)) + 0];   // «+ 0» quita el -0
}
