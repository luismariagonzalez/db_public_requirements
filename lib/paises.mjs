// Jurisdicciones (países, UE, regiones): parseo del parámetro `country`, expansión a los
// ámbitos que lo contienen y anotación de los requisitos con SOLO el matiz de lo pedido.
// Puro salvo la caché de la lista de jurisdicciones (cambia poco).

import { rpc } from './bd.mjs';

const CODIGO = /^(EU|[A-Z]{2}(-[A-Z0-9]{1,3})?)$/;
const MAX_PAISES = 8;

// `country=ES` o `country=ES,PT` (también como lista). Devuelve { paises } o { error }.
export function parsePaises(v) {
  const lista = (Array.isArray(v) ? v : [v]).filter((x) => x != null)
    .flatMap((x) => String(x).split(',')).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (lista.length > MAX_PAISES || lista.some((c) => !CODIGO.test(c)))
    return { error: `country: up to ${MAX_PAISES} codes (ISO 3166-1 alpha-2, EU, or ISO 3166-2 region), comma separated` };
  return { paises: [...new Set(lista)] };
}

// `country_only=1|true|yes`: solo lo específico del país, sin los requisitos genéricos.
export const esVerdadero = (v) => ['1', 'true', 'yes'].includes(String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase());

// Pedir ES-CT incluye ES, y pedir ES incluye EU: se sube por `parent`.
// → { codigos: [pedidos y sus ámbitos superiores], desconocidos: [pedidos que no existen] }
export function expandirPaises(pedidos, jurisdicciones) {
  const por = new Map(jurisdicciones.map((j) => [j.code, j]));
  const desconocidos = pedidos.filter((c) => !por.has(c));
  const codigos = new Set();
  for (const c of pedidos) {
    for (let x = por.get(c), n = 0; x && !codigos.has(x.code) && n < 8; x = por.get(x.parent), n++) codigos.add(x.code);
  }
  return { codigos: [...codigos], desconocidos };
}

// info = { all: [códigos asociados], matches: [{ code, name, note, source, status }] } (de srv_jurisdicciones_de)
// ¿Aplica el requisito al país pedido? Los genéricos (sin ninguna asociación) aplican salvo `soloPais`.
export function aplica(info, { soloPais = false } = {}) {
  if (!info || !info.all?.length) return !soloPais;
  return (info.matches?.length ?? 0) > 0;
}

// Anota cada requisito con sus jurisdicciones:
//   · con país pedido: `jurisdictions` = SOLO las asociaciones de lo pedido (y sus ámbitos superiores), con matiz y fuente
//   · sin país: `jurisdictions` = solo los códigos y nombres (sin matices de nadie)
// Con país pedido, los requisitos que no aplican se excluyen (los devuelve aparte). Los requisitos sin
// ninguna jurisdicción no cambian de forma.
export function anotarJurisdicciones(items, mapa, { pedidos = [], soloPais = false, nombres = {} } = {}) {
  const hayPais = pedidos.length > 0;
  const salida = [], excluidos = [];
  for (const it of items) {
    const info = mapa?.[it.slug];
    if (hayPais && !aplica(info, { soloPais })) { excluidos.push(it.slug); continue; }
    if (!info?.all?.length) { salida.push(it); continue; }
    const jurisdictions = hayPais
      ? info.matches
      : info.all.map((code) => ({ code, name: nombres[code] ?? code }));
    salida.push({ ...it, jurisdictions });
  }
  return { items: salida, excluidos };
}

// ── caché de la lista (5 min), como las categorías
const TTL_MS = 5 * 60_000;
let cache = { hasta: 0, valor: null };
export async function cargarJurisdicciones(deps = { rpc }) {
  if (cache.valor && Date.now() < cache.hasta) return cache.valor;
  cache = { valor: await deps.rpc('jurisdicciones'), hasta: Date.now() + TTL_MS };
  return cache.valor;
}
export const olvidarJurisdicciones = () => { cache = { hasta: 0, valor: null }; };
