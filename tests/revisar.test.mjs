import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisar } from '../lib/revisar.mjs';

const CATS = [
  { slug: 'messaging', type: 'app_type', name: 'Messaging' },
  { slug: 'security', type: 'cross_cutting', name: 'Security' },
];
const ITEM = {
  title: 'Block users', statement: 'Users can block another user so they cannot message them.',
  criteria: ['Blocked users cannot send messages'], kind: 'functional',
  categories: [{ slug: 'messaging', priority: 2 }],
};

// Base y Gemini simulados: registran qué se llamó. El paso 2 se reconoce porque
// su prompt lleva «Existing:».
function mundo({ paso1, similares = [], paso2 }) {
  const llamadas = [];
  const deps = {
    async rpc(verbo, args) {
      llamadas.push([verbo, args]);
      if (verbo === 'categorias') return CATS;
      if (verbo === 'registrar_aporte') return 7;
      if (verbo === 'similares') return similares;
      if (verbo === 'crear_requisito') return { id: 1, slug: 'block-users', created: true };
      if (verbo === 'fusionar') return { id: similares[0]?.id ?? 1, slug: similares[0]?.slug ?? 'x', version: 2 };
      return null;
    },
    async embed() { return new Array(768).fill(0.01); },
    async generarJson(prompt) { return prompt.includes('Existing:') ? paso2 : paso1; },
  };
  return { deps, llamadas, verbos: () => llamadas.map((l) => l[0]) };
}

const aporte = { autor: 'user_a', texto: 'Quiero poder bloquear a otros usuarios', categoriasSugeridas: ['messaging'] };
const P1 = (extra = {}) => ({ is_requirement: true, reject_reason: '', confidence: 0.9, items: [ITEM], ...extra });
const existente = (sim, extra = {}) => ({
  id: 5, slug: 'block-user', title: 'Block user', statement: 'Users can block.', criteria: [],
  similarity: sim, categories: [{ slug: 'messaging', priority: 2 }], ...extra,
});

test('no es un requisito → rechazado y no toca requisitos', async () => {
  const m = mundo({ paso1: { is_requirement: false, reject_reason: 'spam', confidence: 1, items: [] } });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'rejected');
  assert.ok(!m.verbos().includes('crear_requisito'));
});

test('nuevo (sin parecidos) → se crea y se enlaza con el aporte', async () => {
  const m = mundo({ paso1: P1() });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'created');
  assert.equal(r.items[0].slug, 'block-users');
  const crear = m.llamadas.find((l) => l[0] === 'crear_requisito')[1];
  assert.equal(crear.p_aporte_id, 7);
  assert.equal(crear.p_autor, 'user_a');
});

test('duplicado casi exacto sin categorías nuevas → rechazado diciendo cuál', async () => {
  const m = mundo({ paso1: P1(), similares: [existente(0.97)] });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'rejected');
  assert.equal(r.items[0].duplicate_of, 'block-user');
  assert.ok(!m.verbos().includes('crear_requisito'));
});

test('duplicado que trae categoría nueva → fusiona solo las categorías', async () => {
  const conExtra = { ...ITEM, categories: [{ slug: 'messaging', priority: 2 }, { slug: 'security', priority: 3 }] };
  const m = mundo({ paso1: P1({ items: [conExtra] }), similares: [existente(0.96)] });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'merged');
  const f = m.llamadas.find((l) => l[0] === 'fusionar')[1];
  assert.deepEqual(f.p_categorias, [{ slug: 'security', priority: 3 }]);
  assert.equal(f.p_titulo, 'Block user');   // el texto no cambia
});

test('parecido y la IA dice merge → fusiona con el texto mejorado', async () => {
  const m = mundo({
    paso1: P1(), similares: [existente(0.85)],
    paso2: { decision: 'merge', target_slug: 'block-user', reason: 'adds a criterion',
      merged: { title: 'Block users', statement: 'Users can block another user to stop all contact.',
        criteria: ['Blocked users cannot send messages'] } },
  });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'merged');
  const f = m.llamadas.find((l) => l[0] === 'fusionar')[1];
  assert.match(f.p_enunciado, /stop all contact/);
  assert.equal(f.p_requisito_id, 5);
});

test('parecido y la IA dice new → se crea', async () => {
  const m = mundo({ paso1: P1(), similares: [existente(0.82)],
    paso2: { decision: 'new', target_slug: '', reason: 'different' } });
  assert.equal((await revisar(aporte, m.deps)).status, 'created');
});

test('discutir un P1 existente → a una persona, sin fusionar', async () => {
  const discute = { ...ITEM, categories: [{ slug: 'messaging', priority: 4 }] };
  const m = mundo({
    paso1: P1({ items: [discute] }),
    similares: [existente(0.85, { categories: [{ slug: 'messaging', priority: 1 }] })],
    paso2: { decision: 'merge', target_slug: 'block-user', reason: 'x',
      merged: { title: 'Block user', statement: 'Users can block another user.', criteria: [] } },
  });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'needs_human');
  assert.ok(!m.verbos().includes('fusionar'));
});

test('confianza baja → a una persona, no se crea nada', async () => {
  const m = mundo({ paso1: P1({ confidence: 0.3 }) });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'needs_human');
  assert.ok(!m.verbos().includes('crear_requisito'));
});

test('Gemini caído → a una persona, el aporte queda registrado', async () => {
  const m = mundo({ paso1: null });
  m.deps.generarJson = async () => { throw new Error('boom'); };
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'needs_human');
  assert.ok(m.verbos().includes('registrar_aporte'));
});

test('categorías inventadas por la IA: el ítem se rechaza', async () => {
  const m = mundo({ paso1: P1({ items: [{ ...ITEM, categories: [{ slug: 'inventada', priority: 1 }] }] }) });
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'rejected');
  assert.ok(!m.verbos().includes('crear_requisito'));
});

test('máximo 3 ítems por aporte', async () => {
  const seis = Array.from({ length: 6 }, (_, i) => ({ ...ITEM, title: `Block users ${i}` }));
  const m = mundo({ paso1: P1({ items: seis }) });
  await revisar(aporte, m.deps);
  assert.equal(m.verbos().filter((v) => v === 'crear_requisito').length, 3);
});

// ── el embedding de un requisito lleva todas sus etiquetas
test('el embedding del requisito nuevo se calcula con título, criterios, clase y categorías con nombre', async () => {
  const m = mundo({ paso1: P1() });
  const textos = [];
  m.deps.embed = async (t) => { textos.push(t); return new Array(768).fill(0.01); };
  await revisar(aporte, m.deps);
  assert.equal(textos.length, 1);
  assert.match(textos[0], /^Block users\. Users can block another user/);
  assert.match(textos[0], /Acceptance criteria: Blocked users cannot send messages/);
  assert.match(textos[0], /Kind: functional/);
  assert.match(textos[0], /App types: Messaging/);
});

test('fusionar con categoría nueva recalcula el vector con TODAS las etiquetas (las viejas y la nueva)', async () => {
  const conExtra = { ...ITEM, categories: [{ slug: 'messaging', priority: 2 }, { slug: 'security', priority: 3 }] };
  const m = mundo({ paso1: P1({ items: [conExtra] }), similares: [existente(0.96)] });
  const textos = [];
  m.deps.embed = async (t) => { textos.push(t); return new Array(768).fill(0.02); };
  await revisar(aporte, m.deps);
  const f = m.llamadas.find((l) => l[0] === 'fusionar')[1];
  assert.ok(f.p_vec?.startsWith('['), 'ya no se deja el vector viejo');
  assert.match(textos.at(-1), /^Block user\. Users can block\./);
  assert.match(textos.at(-1), /App types: Messaging/);
  assert.match(textos.at(-1), /Cross-cutting concerns: Security/);
});

test('fusionar con categoría nueva sigue adelante si Gemini falla al recalcular el vector', async () => {
  const conExtra = { ...ITEM, categories: [{ slug: 'messaging', priority: 2 }, { slug: 'security', priority: 3 }] };
  const m = mundo({ paso1: P1({ items: [conExtra] }), similares: [existente(0.96)] });
  let n = 0;
  m.deps.embed = async () => { if (++n > 1) throw new Error('cupo'); return new Array(768).fill(0.02); };
  const r = await revisar(aporte, m.deps);
  assert.equal(r.status, 'merged');
  assert.equal(m.llamadas.find((l) => l[0] === 'fusionar')[1].p_vec, null);
});
