// Jurisdicciones en la API: GET /api/v1/jurisdictions y los ayudantes que usa lectura.mjs para
// filtrar por `country` y anotar cada requisito con el matiz de ESE país (y de ningún otro).

import { rpc } from '../bd.mjs';
import { entrar, enviar, error, errorBd } from '../entrada.mjs';
import { cargarJurisdicciones, expandirPaises, anotarJurisdicciones } from '../paises.mjs';

const CACHE_LARGA = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' };

// GET /api/v1/jurisdictions → { count, jurisdictions: [{ code, type, name, parent, requirements }] }
export async function jurisdicciones(req, res) {
  if (!(await entrar(req, res))) return;
  try {
    const lista = await cargarJurisdicciones();
    enviar(res, 200, { count: lista.length, jurisdictions: lista }, CACHE_LARGA);
  } catch (e) { errorBd(res, e); }
}

// Valida los países pedidos (un código que no existe es un 400) y los expande a sus ámbitos
// superiores. Devuelve los filtros con `paisesExpandidos`, o null si ya ha respondido.
export async function conPais(res, f) {
  if (!f.paises?.length) return f;
  const lista = await cargarJurisdicciones();
  const { codigos, desconocidos } = expandirPaises(f.paises, lista);
  if (desconocidos.length) {
    error(res, 400, `unknown country: ${desconocidos.slice(0, 5).join(', ')} (see /api/v1/jurisdictions)`);
    return null;
  }
  return { ...f, paisesExpandidos: codigos, nombresPais: Object.fromEntries(lista.map((j) => [j.code, j.name])) };
}

// Anota los requisitos con sus jurisdicciones; con país pedido, deja fuera los que no aplican.
// → { items, excluidos }
export async function anotarPais(items, f, deps = { rpc }) {
  if (!items.length) return { items, excluidos: [] };
  const mapa = await deps.rpc('jurisdicciones_de', {
    p_slugs: items.map((i) => i.slug), p_paises: f.paisesExpandidos?.length ? f.paisesExpandidos : null });
  const nombres = f.nombresPais ?? Object.fromEntries((await cargarJurisdicciones()).map((j) => [j.code, j.name]));
  return anotarJurisdicciones(items, mapa, { pedidos: f.paises ?? [], soloPais: f.soloPais, nombres });
}
