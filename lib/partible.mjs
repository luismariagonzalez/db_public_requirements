// «¿Este requisito es demasiado largo y se puede partir?» Puntuación pura, sin red ni base.
//
// Un requisito dice UN comportamiento. Se sospecha que son varios cuando el enunciado es largo,
// tiene muchos criterios de aceptación, encadena varios verbos de acción, cuelga de muchísimas
// categorías o tiene muchos tests (cada test suele comprobar un comportamiento distinto).
// Pesos (suman 100): enunciado 35 · criterios 25 · verbos 25 · categorías 10 · tests 5.

export const UMBRAL_CANDIDATO = 40;   // desde aquí es «candidato a partir»
export const UMBRAL_ALTO = 60;

// Raíces de verbos de acción de producto (se reconocen sus formas: create, creates, created, creating).
const VERBOS = ['create', 'add', 'edit', 'update', 'modify', 'change', 'delete', 'remove', 'archive', 'restore', 'view', 'see',
  'browse', 'search', 'filter', 'sort', 'export', 'import', 'download', 'upload', 'share', 'invite', 'send', 'receive', 'reply',
  'comment', 'react', 'follow', 'block', 'report', 'approve', 'reject', 'assign', 'schedule', 'cancel', 'pay', 'refund', 'subscribe',
  'unsubscribe', 'sign', 'log', 'reset', 'verify', 'authenticate', 'authorize', 'configure', 'customize', 'enable', 'disable',
  'pin', 'tag', 'label', 'rate', 'review', 'book', 'order', 'track', 'notify', 'sync', 'merge', 'split', 'duplicate', 'rename',
  'save', 'publish', 'moderate', 'record', 'stream', 'transfer', 'select', 'attach', 'print', 'translate', 'recover'];

const IRREGULARES = { see: ['see', 'sees', 'saw', 'seen', 'seeing'], send: ['send', 'sends', 'sent', 'sending'],
  pay: ['pay', 'pays', 'paid', 'paying'], log: ['log', 'logs', 'logged', 'logging'], sign: ['sign', 'signs', 'signed', 'signing'],
  split: ['split', 'splits', 'splitting'], pin: ['pin', 'pins', 'pinned', 'pinning'], tag: ['tag', 'tags', 'tagged', 'tagging'],
  order: ['order', 'orders', 'ordered', 'ordering'], rate: ['rate', 'rates', 'rated', 'rating'],
  select: ['select', 'selects', 'selected', 'selecting'], record: ['record', 'records', 'recorded', 'recording'] };

function formas(v) {
  if (IRREGULARES[v]) return IRREGULARES[v];
  const base = v.endsWith('e') ? v.slice(0, -1) : v;
  return [v, v + 's', v + 'es', v.endsWith('y') ? v.slice(0, -1) + 'ies' : v + 's', base + 'ed', base + 'ing', v + 'ed', v + 'ing'];
}
const MAPA = new Map();
for (const v of VERBOS) for (const f of formas(v)) MAPA.set(f, v);

// Verbos de acción DISTINTOS que aparecen en el texto.
export function verbosDe(texto) {
  const vistos = new Set();
  for (const p of String(texto ?? '').toLowerCase().match(/[a-z]+/g) ?? []) {
    const v = MAPA.get(p);
    if (v) vistos.add(v);
  }
  return [...vistos];
}

const tramo = (x, desde, hasta) => Math.min(1, Math.max(0, (x - desde) / (hasta - desde)));

// m = { statement, criteria_count, categories_count, tests_count }
export function puntuar(m) {
  const chars = String(m.statement ?? '').length;
  const verbos = verbosDe(m.statement);
  const criterios = Number(m.criteria_count ?? 0);
  const cats = Number(m.categories_count ?? 0);
  const tests = Number(m.tests_count ?? 0);

  const partes = {
    statement: Math.round(tramo(chars, 250, 750) * 35),
    criteria: Math.round(tramo(criterios, 4, 10) * 25),
    verbs: [0, 0, 10, 20, 25][Math.min(verbos.length, 4)],
    categories: Math.round(tramo(cats, 6, 14) * 10),
    tests: Math.round(tramo(tests, 2, 5) * 5),
  };
  const score = Math.min(100, Object.values(partes).reduce((a, b) => a + b, 0));
  const razones = [];
  if (partes.statement >= 18) razones.push('long_statement');
  if (partes.criteria >= 12) razones.push('many_criteria');
  if (verbos.length >= 2) razones.push('many_verbs');
  if (partes.categories >= 5) razones.push('many_categories');
  if (partes.tests >= 3) razones.push('many_tests');
  return {
    score, level: score >= UMBRAL_ALTO ? 'high' : score >= UMBRAL_CANDIDATO ? 'medium' : 'low',
    candidate: score >= UMBRAL_CANDIDATO, reasons: razones, parts: partes,
    metrics: { chars, criteria: criterios, categories: cats, tests, verbs: verbos },
  };
}
