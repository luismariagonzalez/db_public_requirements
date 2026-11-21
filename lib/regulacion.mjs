// Validación del contenido regulatorio por jurisdicción (semilla/regulacion-<país>/*.json).
// Puro: lo usa scripts/sembrar_regulacion.mjs (--dry incluido) y se prueba en tests/regulacion.test.mjs.
//
// Forma de cada elemento:
//   { slug, title, statement, criteria[2-5], kind, categories:[{slug, priority}],
//     jurisdictions:[{ code, note, source:{ norm, url, date, in_force_from? } }],
//     tests:[{ slug, title, scenario, type, priority }] }

const SLUG = /^[a-z0-9][a-z0-9-]{3,119}$/;
const TIPOS_TEST = ['unit', 'integration', 'e2e', 'security', 'performance', 'accessibility', 'manual'];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Un requisito dice QUÉ, nunca DÓNDE: palabras de interfaz que delatan un «dónde».
const DONDE = /\b(button|screen|page|modal|dialog|tab|sidebar|menu|banner|popup|pop-up|homepage|home page|footer|header|navbar|widget)s?\b/i;

export function validarRequisito(r, { jurisdiccionesValidas = null, categoriasValidas = null } = {}) {
  const e = [];
  const en = (cond, msg) => { if (!cond) e.push(msg); };
  en(SLUG.test(r.slug ?? ''), 'slug inválido');
  en(typeof r.title === 'string' && r.title.length >= 5 && r.title.length <= 120, 'title: 5-120 caracteres');
  en(typeof r.statement === 'string' && r.statement.length >= 10 && r.statement.length <= 400, 'statement: 10-400 caracteres');
  en(/^(The operator|The system) (must|must not|may not)\b/.test(r.statement ?? ''), 'statement debe empezar por «The operator must…» o «The system must…»');
  en(Array.isArray(r.criteria) && r.criteria.length >= 2 && r.criteria.length <= 5
     && r.criteria.every((c) => typeof c === 'string' && c.length >= 5 && c.length <= 300), 'criteria: 2-5 textos de 5-300 caracteres');
  en(['functional', 'technical'].includes(r.kind), 'kind: functional | technical');
  en(Array.isArray(r.categories) && r.categories.length >= 1 && r.categories.length <= 12
     && r.categories.every((c) => c.slug && Number.isInteger(c.priority) && c.priority >= 1 && c.priority <= 5), 'categories: 1-12 con prioridad 1-5');
  if (categoriasValidas) for (const c of r.categories ?? []) en(categoriasValidas.has(c.slug), `categoría desconocida: ${c.slug}`);
  en(Array.isArray(r.jurisdictions) && r.jurisdictions.length >= 1, 'jurisdictions: al menos una');
  for (const j of r.jurisdictions ?? []) {
    en(/^(EU|[A-Z]{2}(-[A-Z0-9]{1,3})?)$/.test(j.code ?? ''), `jurisdicción inválida: ${j.code}`);
    if (jurisdiccionesValidas) en(jurisdiccionesValidas.has(j.code), `jurisdicción desconocida: ${j.code}`);
    en(typeof j.note === 'string' && j.note.length >= 5 && j.note.length <= 700, `${j.code}: note de 5-700 caracteres`);
    const s = j.source ?? {};
    en(typeof s.norm === 'string' && s.norm.length >= 3 && s.norm.length <= 400, `${j.code}: source.norm obligatorio`);
    en(/^https:\/\/\S{4,500}$/.test(s.url ?? ''), `${j.code}: source.url https obligatorio`);
    en(FECHA.test(s.date ?? ''), `${j.code}: source.date AAAA-MM-DD obligatorio`);
    if (s.in_force_from != null) en(FECHA.test(s.in_force_from), `${j.code}: in_force_from AAAA-MM-DD`);
  }
  // QUÉ, no DÓNDE
  en(!DONDE.test(`${r.title} ${r.statement} ${(r.criteria ?? []).join(' ')}`), 'menciona un «dónde» de interfaz (botón, pantalla, banner…)');
  for (const t of r.tests ?? []) {
    en(SLUG.test(t.slug ?? ''), `test ${t.slug}: slug inválido`);
    en(typeof t.title === 'string' && t.title.length >= 5 && t.title.length <= 120, `test ${t.slug}: title 5-120`);
    en(typeof t.scenario === 'string' && t.scenario.length >= 10 && t.scenario.length <= 800
       && /given/i.test(t.scenario) && /when/i.test(t.scenario) && /then/i.test(t.scenario), `test ${t.slug}: escenario dado/cuando/entonces (Given… When… Then…)`);
    en(TIPOS_TEST.includes(t.type), `test ${t.slug}: type inválido`);
    en(Number.isInteger(t.priority) && t.priority >= 1 && t.priority <= 5, `test ${t.slug}: priority 1-5`);
  }
  return e;
}

// Valida una lista: errores por slug, slugs repetidos y tests repetidos.
export function validarLote(lista, opciones = {}) {
  const errores = [];
  const vistos = new Set(), vistosTest = new Set();
  for (const r of lista) {
    for (const m of validarRequisito(r, opciones)) errores.push(`${r.slug ?? '(sin slug)'}: ${m}`);
    if (vistos.has(r.slug)) errores.push(`${r.slug}: slug repetido`);
    vistos.add(r.slug);
    for (const t of r.tests ?? []) {
      if (vistosTest.has(t.slug)) errores.push(`${t.slug}: test repetido`);
      vistosTest.add(t.slug);
    }
  }
  return errores;
}
