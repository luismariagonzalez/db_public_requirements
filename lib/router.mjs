// Router mínimo y puro. Toda la API cuelga de UNA función de Vercel
// (api/entrada.js): el plan Hobby limita cuántas funciones caben por
// despliegue, y así hay una sola con un solo arranque en frío.
//
//   const rutas = compilar([['GET', '/api/v1/projects/:id', handler], …]);
//   resolver(rutas, 'GET', '/api/v1/projects/7') → { estado: 200, handler, params: { id: '7' } }

export function compilar(tabla) {
  return tabla.map(([metodo, patron, handler]) => ({
    metodo, handler, patron,
    re: new RegExp('^' + patron.replace(/:([a-z_]+)/g, '(?<$1>[^/]+)') + '/?$'),
  }));
}

export function resolver(rutas, metodo, ruta) {
  const candidatas = rutas.filter((r) => r.re.test(ruta));
  if (!candidatas.length) return { estado: 404 };
  const r = candidatas.find((c) => c.metodo === metodo);
  if (!r) return { estado: 405, permitidos: [...new Set(candidatas.map((c) => c.metodo))] };
  const params = {};
  for (const [k, v] of Object.entries(r.re.exec(ruta).groups ?? {})) {
    try { params[k] = decodeURIComponent(v); } catch { return { estado: 400 }; }
  }
  return { estado: 200, handler: r.handler, params };
}

// URLSearchParams → objeto; una clave repetida pasa a array (?category=a&category=b).
export function queryDe(url) {
  const q = {};
  for (const [k, v] of url.searchParams) {
    if (k in q) q[k] = [].concat(q[k], v); else q[k] = v;
  }
  return q;
}
