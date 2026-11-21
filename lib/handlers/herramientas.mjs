// GET /api/v1/tools: el catálogo de herramientas (software con código o documentación
// públicos) que una persona o su agente pueden estudiar para aportar requisitos y
// aceleradores. Público, con caché; filtros opcionales ?q= y ?category=.

import { rpc } from '../bd.mjs';
import { entrar, enviar, errorBd } from '../entrada.mjs';

const CACHE = { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' };

export async function listar(req, res) {
  if (!(await entrar(req, res))) return;
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 80);
  const cat = String(req.query.category ?? '').trim().toLowerCase().slice(0, 40);
  try {
    let tools = await rpc('herramientas');
    if (cat) tools = tools.filter((t) => t.category === cat);
    if (q) tools = tools.filter((t) => `${t.name} ${t.slug} ${t.description} ${t.category}`.toLowerCase().includes(q));
    enviar(res, 200, { count: tools.length, tools }, CACHE);
  } catch (e) { errorBd(res, e); }
}
