// Embeddings SIMULADOS para ensayos y pruebas (sin Gemini): una bolsa de palabras con hash a 768
// dimensiones, normalizada. Dos textos que comparten palabras (y etiquetas) quedan cerca, así que
// el mapa de prueba tiene estructura de verdad. Determinista. Nunca para producción.

import { createHash } from 'node:crypto';

export const DIMS = 768;

export function vectorSimulado(texto) {
  const v = new Float64Array(DIMS);
  for (const palabra of String(texto).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = createHash('sha256').update(palabra).digest();
    // cada palabra enciende 3 dimensiones con signo, siempre las mismas
    for (let k = 0; k < 3; k++) v[h.readUInt16BE(k * 2) % DIMS] += h[8 + k] % 2 ? 1 : -1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return Array.from(v, (x) => x / n);
}

// Misma firma que lib/gemini.mjs#embedLote
export const embedLoteSimulado = async (textos) => textos.map(vectorSimulado);
