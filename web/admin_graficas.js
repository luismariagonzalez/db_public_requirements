// Geometría de las gráficas del cuadro de control (SVG propio, sin librerías). Puro: sin `document`,
// así se prueba con node:test (tests/admin_graficas.test.mjs). admin.js solo convierte esto en elementos SVG.

// Máximo «redondo» para el eje: 1, 2, 5, 10, 20, 50, 100…
export function maxRedondo(m) {
  if (!(m > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(m));
  const f = m / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

export const total = (vals) => vals.reduce((a, b) => a + b, 0);

// Una barra por valor. Devuelve { max, barras: [{ i, v, x, y, w, h }] } en coordenadas del viewBox.
export function barras(vals, { ancho = 300, alto = 80, arriba = 12, abajo = 14, hueco = 1 } = {}) {
  const max = maxRedondo(Math.max(0, ...vals));
  const n = Math.max(vals.length, 1);
  const w = Math.max(ancho / n - hueco, 0.5);
  const util = alto - arriba - abajo;
  return {
    max,
    barras: vals.map((v, i) => {
      const h = v > 0 ? Math.max((v / max) * util, 1) : 0;
      return { i, v, x: +(i * (ancho / n)).toFixed(2), y: +(alto - abajo - h).toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
    }),
  };
}

// Barras apiladas: filas = [{ clave: n, … }], claves = orden de apilado de abajo arriba.
export function apiladas(filas, claves, { ancho = 300, alto = 80, arriba = 12, abajo = 14, hueco = 1 } = {}) {
  const totales = filas.map((f) => total(claves.map((k) => Number(f[k] ?? 0))));
  const max = maxRedondo(Math.max(0, ...totales));
  const n = Math.max(filas.length, 1);
  const w = Math.max(ancho / n - hueco, 0.5);
  const util = alto - arriba - abajo;
  return {
    max,
    barras: filas.map((f, i) => {
      let base = alto - abajo;
      const trozos = [];
      for (const k of claves) {
        const v = Number(f[k] ?? 0);
        if (!(v > 0)) continue;
        const h = Math.max((v / max) * util, 1);
        base -= h;
        trozos.push({ k, v, y: +base.toFixed(2), h: +h.toFixed(2) });
      }
      return { i, v: totales[i], x: +(i * (ancho / n)).toFixed(2), w: +w.toFixed(2), trozos };
    }),
  };
}

// Etiquetas del eje X: la primera, la última y algunas intermedias (como mucho n).
export function ticksX(dias, n = 4) {
  if (!dias.length) return [];
  if (dias.length <= n) return dias.map((d, i) => ({ i, dia: d }));
  const salida = [];
  for (let k = 0; k < n; k++) {
    const i = Math.round((k * (dias.length - 1)) / (n - 1));
    if (!salida.some((s) => s.i === i)) salida.push({ i, dia: dias[i] });
  }
  return salida;
}

// Datos para el texto accesible de la gráfica.
export function resumenGrafica(dias, vals) {
  const t = total(vals);
  const max = Math.max(0, ...vals);
  return { total: t, max, diaMax: max > 0 ? dias[vals.indexOf(max)] : null };
}

export function formatoBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = x / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

// «2026-11-03» → «03/11» (corto, para el eje).
export const diaCorto = (dia) => String(dia).slice(5).split('-').reverse().join('/');
