import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapa } from '../lib/handlers/mapa.mjs';
import { rutas } from '../lib/rutas.mjs';
import { resolver } from '../lib/router.mjs';
import { reembeber } from '../scripts/reembeber.mjs';
import { calcularMapa } from '../scripts/mapa_calcular.mjs';
import { embedLoteSimulado, vectorSimulado } from '../scripts/embedding_simulado.mjs';
import { aLiteral } from '../lib/gemini.mjs';
import { textoParaEmbedding } from '../lib/texto_embedding.mjs';

// ── el handler: cupo de lectura como las demás rutas, datos de la base, caché de CDN
function res() {
  return { statusCode: 0, cab: {}, cuerpo: '', headersSent: false,
    setHeader(k, v) { this.cab[k.toLowerCase()] = v; }, end(c = '') { this.cuerpo = String(c); this.headersSent = true; } };
}
// Base «falsa» por fetch: contesta /rpc/…_srv_<verbo>. Sirve para el cupo (entrar) y para el mapa.
function conBase(respuestas) {
  const original = globalThis.fetch;
  const llamadas = [];
  process.env.SUPABASE_URL = 'http://base.invalida.test'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_x'; process.env.IP_SALT = 's';
  globalThis.fetch = async (url) => {
    const verbo = String(url).split('_srv_')[1];
    llamadas.push(verbo);
    const r = respuestas[verbo];
    if (r instanceof Error) return new Response(JSON.stringify({ message: r.message }), { status: 500 });
    return new Response(JSON.stringify(typeof r === 'function' ? r() : r), { status: 200 });
  };
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}
const CUPO_OK = { allowed: true, remaining_minute: 19, remaining_day: 299, scope: 'minute', retry_after: 0 };
const PUNTO = { slug: 'typing-indicator', title: 'Typing indicator', x: 0.1, y: -0.3, priority: 4, kind: 'functional',
  app_type: 'messaging', topics: ['privacy'], copies: 3 };

test('GET /api/v1/map está en la tabla de rutas y solo admite GET', () => {
  assert.equal(resolver(rutas, 'GET', '/api/v1/map').handler, mapa);
  assert.equal(resolver(rutas, 'POST', '/api/v1/map').estado, 405);
});

test('mapa: 200 con los puntos, caché de CDN (s-maxage) y sin enunciados', async () => {
  const b = conBase({ cupo: CUPO_OK, mapa: { count: 1, generated_at: '2026-01-01T00:00:00Z', points: [PUNTO] } });
  try {
    const r = res();
    await mapa({ method: 'GET', headers: { 'x-real-ip': '10.1.1.1' }, query: {} }, r);
    assert.equal(r.statusCode, 200);
    assert.match(r.cab['cache-control'], /public, s-maxage=\d+/);
    const j = JSON.parse(r.cuerpo);
    assert.equal(j.count, 1); assert.equal(j.generated_at, '2026-01-01T00:00:00Z');
    assert.deepEqual(Object.keys(j.points[0]).sort(), ['app_type', 'copies', 'kind', 'priority', 'slug', 'title', 'topics', 'x', 'y']);
    assert.deepEqual(b.llamadas, ['cupo', 'mapa']);   // pasa por el cupo antes de leer
  } finally { b.restaurar(); }
});

test('mapa: sin coordenadas calculadas responde un mapa vacío (200), no un error', async () => {
  const b = conBase({ cupo: CUPO_OK, mapa: { count: 0, generated_at: null, points: [] } });
  try {
    const r = res();
    await mapa({ method: 'GET', headers: {}, query: {} }, r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.cuerpo), { count: 0, generated_at: null, points: [] });
  } finally { b.restaurar(); }
});

test('mapa: respeta el cupo (429) y no toca la base de datos de mapas', async () => {
  const b = conBase({ cupo: { allowed: false, scope: 'minute', retry_after: 30 } });
  try {
    const r = res();
    await mapa({ method: 'GET', headers: {}, query: {} }, r);
    assert.equal(r.statusCode, 429);
    assert.ok(!b.llamadas.includes('mapa'));
  } finally { b.restaurar(); }
});

test('mapa: si la base falla, 502 sin filtrar el detalle', async () => {
  const b = conBase({ cupo: CUPO_OK, mapa: new Error('relation mapa_requisito does not exist') });
  try {
    const r = res();
    await mapa({ method: 'GET', headers: {}, query: {} }, r);
    assert.equal(r.statusCode, 502);
    assert.doesNotMatch(r.cuerpo, /mapa_requisito/);
  } finally { b.restaurar(); }
});

// ── reembeber, con una base en memoria y vectores simulados
function baseEnMemoria(n) {
  const cats = [{ slug: 'messaging', type: 'app_type', name: 'Messaging app' }, { slug: 'security', type: 'cross_cutting', name: 'Security' }];
  const reqs = Array.from({ length: n }, (_, i) => ({ id: i + 1, slug: `req-${i + 1}`, title: `Requirement ${i + 1}`,
    statement: `The product must do thing number ${i + 1} reliably.`, criteria: ['works'], kind: 'functional',
    categories: [{ slug: 'messaging', priority: 2 }, ...(i % 2 ? [{ slug: 'security', priority: 1 }] : [])], embedding_v: 1, embedding: null }));
  const llamadas = [];
  const rpc = async (verbo, a = {}) => {
    llamadas.push(verbo);
    if (verbo === 'categorias') return cats;
    if (verbo === 'requisitos_para_embeber') {
      const falta = reqs.filter((r) => r.embedding_v < a.p_version);
      return { pending: falta.length, items: falta.filter((r) => r.id > a.p_despues).slice(0, a.p_limite) };
    }
    if (verbo === 'guardar_embedding') { const r = reqs.find((x) => x.id === a.p_id); r.embedding = a.p_vec; r.embedding_v = a.p_version; return null; }
    throw new Error('verbo inesperado ' + verbo);
  };
  return { reqs, rpc, llamadas };
}
const mudo = () => {};

test('reembeber --dry: cuenta y enseña un ejemplo, sin llamar a Gemini ni escribir', async () => {
  const m = baseEnMemoria(7);
  let gemini = 0;
  const salida = [];
  const r = await reembeber({ rpc: m.rpc, embedLote: async () => { gemini++; return []; }, dry: true, log: (s) => salida.push(s) });
  assert.equal(r.pendientes, 7); assert.equal(gemini, 0);
  assert.ok(!m.llamadas.includes('guardar_embedding'));
  assert.match(salida.join('\n'), /Cross-cutting concerns|App types: Messaging app/);
});

test('reembeber: recalcula por lotes con el texto etiquetado y marca la versión', async () => {
  const m = baseEnMemoria(7);
  const textos = [];
  const r = await reembeber({ rpc: m.rpc, lote: 3, log: mudo,
    embedLote: async (t) => { textos.push(...t); return embedLoteSimulado(t); } });
  assert.equal(r.hechos, 7);
  assert.ok(m.reqs.every((x) => x.embedding_v === 2 && x.embedding.startsWith('[')));
  assert.ok(textos.every((t) => /App types: Messaging app/.test(t) && /Kind: functional/.test(t)));
  assert.equal(m.reqs[1].embedding, aLiteral(vectorSimulado(textoParaEmbedding(m.reqs[1], m.reqs[1] && [
    { slug: 'messaging', type: 'app_type', name: 'Messaging app' }, { slug: 'security', type: 'cross_cutting', name: 'Security' }]))));
});

test('reembeber es reanudable: si Gemini falla a mitad, lo hecho se conserva y repetirlo sigue donde iba', async () => {
  const m = baseEnMemoria(7);
  let n = 0;
  const flojo = async (t) => { if (++n === 2) throw new Error('cupo de Gemini'); return embedLoteSimulado(t); };
  await assert.rejects(reembeber({ rpc: m.rpc, lote: 3, embedLote: flojo, log: mudo }), /cupo de Gemini/);
  assert.equal(m.reqs.filter((x) => x.embedding_v === 2).length, 3);
  const r = await reembeber({ rpc: m.rpc, lote: 3, embedLote: embedLoteSimulado, log: mudo });
  assert.equal(r.hechos, 4);                                        // solo los 4 que faltaban
  assert.ok(m.reqs.every((x) => x.embedding_v === 2));
  assert.equal((await reembeber({ rpc: m.rpc, embedLote: embedLoteSimulado, log: mudo })).hechos, 0);   // ya no queda nada
});

test('reembeber --limite corta y dice cuánto queda', async () => {
  const m = baseEnMemoria(7);
  const salida = [];
  const r = await reembeber({ rpc: m.rpc, lote: 3, limite: 4, embedLote: embedLoteSimulado, log: (s) => salida.push(s) });
  assert.equal(r.hechos, 4);
  assert.match(salida.join('\n'), /quedan 3/);
});

// ── mapa_calcular, con una base en memoria
function baseMapa(textos) {
  const filas = textos.map((t, i) => ({ id: i + 1, vec: aLiteral(vectorSimulado(t)) }));
  const estado = { modelo: null, puntos: new Map(), escrituras: 0 };
  const rpc = async (verbo, a = {}) => {
    if (verbo === 'mapa_modelo') return estado.modelo;
    if (verbo === 'mapa_para_calcular') {
      const lista = filas.filter((f) => f.id > a.p_despues && (!a.p_solo_nuevos || !estado.puntos.has(f.id)));
      return { total: lista.length, items: lista.slice(0, a.p_limite) };
    }
    if (verbo === 'guardar_mapa') {
      estado.escrituras++;
      for (const p of a.p_puntos) estado.puntos.set(p.id, [p.x, p.y]);
      if (a.p_modelo) estado.modelo = a.p_modelo;
      return a.p_puntos.length;
    }
    throw new Error('verbo inesperado ' + verbo);
  };
  return { filas, estado, rpc };
}
const TEXTOS = Array.from({ length: 30 }, (_, i) => `${['chat message typing', 'payment invoice card', 'password login token'][i % 3]} item ${i}`);

test('mapa_calcular: escribe todos los puntos con t-SNE y guarda la descripción del método', async () => {
  const b = baseMapa(TEXTOS);
  const r = await calcularMapa({ rpc: b.rpc, log: mudo });
  assert.equal(r.modo, 'completo'); assert.equal(r.escritos, 30);
  assert.equal(b.estado.puntos.size, 30);
  assert.equal(b.estado.modelo.metodo, 'tsne'); assert.equal(b.estado.modelo.dims, 768);
  for (const [x, y] of b.estado.puntos.values()) assert.ok(Math.abs(x) <= 2 && Math.abs(y) <= 2);
});

test('mapa_calcular es determinista, agrupa lo parecido y --dry no escribe', async () => {
  const b = baseMapa(TEXTOS);
  await calcularMapa({ rpc: b.rpc, log: mudo });
  const antes = new Map(b.estado.puntos);
  const dry = await calcularMapa({ rpc: b.rpc, dry: true, log: mudo });
  assert.equal(dry.escritos, 0); assert.deepEqual(b.estado.puntos, antes);
  await calcularMapa({ rpc: b.rpc, log: mudo });
  assert.deepEqual(b.estado.puntos, antes, 'los mismos datos dan las mismas coordenadas');
  // los tres temas de TEXTOS (i % 3) quedan más cerca dentro del tema que entre temas
  const d = (i, j) => Math.hypot(...antes.get(i).map((v, k) => v - antes.get(j)[k]));
  let dentro = 0, fuera = 0, nd = 0, nf = 0;
  for (let i = 1; i <= 30; i++) for (let j = i + 1; j <= 30; j++) { if ((i - 1) % 3 === (j - 1) % 3) { dentro += d(i, j); nd++; } else { fuera += d(i, j); nf++; } }
  assert.ok(dentro / nd < fuera / nf, 'lo parecido queda junto');
});

test('mapa_calcular: con menos de 3 requisitos no escribe nada', async () => {
  const b = baseMapa(['uno solo', 'otro más']);
  const r = await calcularMapa({ rpc: b.rpc, log: mudo });
  assert.equal(r.escritos, 0); assert.equal(b.estado.escrituras, 0);
});
