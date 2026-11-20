// Generador del prompt de colaboración: dada una herramienta del catálogo
// (GET /api/v1/tools), escribe la tarea que la persona pega en su agente para que
// estudie esa herramienta y aporte requisitos y aceleradores a airedb.
//
// PURO (sin document ni fetch): lo usa la web (web/colaborar.js) y los tests. Vive en
// web/ porque la web se aplana en la raíz al construir y no puede importar de lib/;
// lib/prompt_colaborador.mjs lo reexporta para el servidor y los tests.
//
// El prompt va en INGLÉS (los agentes trabajan en inglés); la interfaz que lo rodea, en EN/ES.
// NUNCA lleva una clave real: solo el marcador `rq_…`.

// ── Rutas y formas de las propuestas: TODO lo que puede cambiar está aquí, en un solo sitio.
export const RUTAS = {
  buscarRequisitos: '/api/v1/requirements',
  buscarAceleradores: '/api/v1/accelerators',
  herramientas: '/api/v1/tools',
  sugerir: '/api/v1/suggestions',          // SOLO sugerencias sobre la app airedb
  // Aportar requisitos, tests y aceleradores. `vigente` dice qué hace HOY el servidor y se imprime tal cual
  // en el prompt: se ajusta aquí cuando la ruta tipada (`type`) esté desplegada.
  contribuir: {
    metodo: 'POST',
    ruta: '/api/contribute',
    vigente: 'The route in force today is `POST /api/contribute`. It takes one proposal per call and reviews it before publishing. '
      + 'Send the typed body below (`type`: requirement | test | accelerator). '
      + 'If the server answers 400 saying a field is unknown, or for a `requirement` only, fall back to the plain form '
      + '`{"text": "<the requirement statement>", "categories": ["<slug>"], "accept_terms": true}`.',
  },
};

// Cuerpos de ejemplo de cada propuesta (se imprimen como JSON en el prompt).
export const PLANTILLAS = {
  requirement: {
    type: 'requirement',
    statement: '<WHAT the software must do, one sentence, in English, no screens/buttons/layout>',
    criteria: ['<observable acceptance criterion>'],
    categories: ['<category slug from GET /api/v1/categories>'],
    priority: 3,
    source_url: '<URL of the page you took it from>',
    accept_terms: true,
  },
  requirement_update: {
    type: 'requirement',
    improves: '<slug of the existing requirement>',
    statement: '<updated, still tool-agnostic statement>',
    why: '<what it adds that the existing one lacks, one sentence>',
    source_url: '<URL>',
    accept_terms: true,
  },
  test: {
    type: 'test',
    title: '<short title>',
    test_type: 'unit | integration | e2e | manual | security | performance',
    scenario: '<given / when / then, in English>',
    requirements: ['<slug of the requirement it checks>'],
    priority: 3,
    accept_terms: true,
  },
  accelerator: {
    type: 'accelerator',
    name: '<library or service name>',
    url: '<https URL you opened and that works>',
    description: '<what it does, one or two sentences, your own words>',
    model: 'open_source | proprietary | saas',
    cost: 'free | freemium | paid',
    platforms: ['<e.g. javascript, python, web, any>'],
    covers: [
      { requirement: '<slug>', coverage: 'full' },
      { requirement: '<another slug>', coverage: 'partial' },
    ],
    accept_terms: true,
  },
};

// Una línea, sin saltos ni comillas invertidas: nada que rompa el formato del prompt.
export const limpiarLinea = (s, max = 200) => String(s ?? '').replace(/[\r\n`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function urlHttps(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && !/\s/.test(String(u)) ? x.href : null;
  } catch { return null; }
}

const normalizarBase = (b) => String(b || 'https://<this-site>').replace(/\/+$/, '');
const json = (o) => JSON.stringify(o, null, 2);

// ¿Es una herramienta usable? Necesita nombre y al menos una URL https (código o documentación).
export function herramientaValida(h) {
  return Boolean(h && limpiarLinea(h.name) && (urlHttps(h.code_url) || urlHttps(h.docs_url)));
}

// Filtra el catálogo por texto (nombre, slug, categoría, descripción). Sin texto, todo.
export function filtrarHerramientas(lista, texto = '') {
  const q = String(texto).trim().toLowerCase();
  const ok = (Array.isArray(lista) ? lista : []).filter(herramientaValida);
  return q ? ok.filter((h) => `${h.name} ${h.slug} ${h.category} ${h.description}`.toLowerCase().includes(q)) : ok;
}

// herramienta: { slug, name, category, description, code_url, docs_url, platforms } (forma de /api/v1/tools)
// base: URL de la web/API (PUBLIC_BASE_URL o el origen de la página), sin barra final.
export function generarPrompt({ herramienta, base } = {}) {
  if (!herramientaValida(herramienta)) throw new Error('herramienta: hace falta un nombre y una URL https (code_url o docs_url)');
  const B = normalizarBase(base);
  const nombre = limpiarLinea(herramienta.name, 80);
  const codigo = urlHttps(herramienta.code_url), docs = urlHttps(herramienta.docs_url);
  const plat = (herramienta.platforms ?? []).map((p) => limpiarLinea(p, 30)).filter(Boolean).join(', ');
  const desc = limpiarLinea(herramienta.description, 300);
  const R = RUTAS;
  const C = `${R.contribuir.metodo} ${B}${R.contribuir.ruta}`;

  const L = [];
  L.push(`# Task: study "${nombre}" and contribute what you learn to airedb`);
  L.push('');
  L.push('## Context');
  L.push('');
  L.push(`airedb (${B}/) is a public, community-built database of software requirements, tests and accelerators (libraries and services that speed up implementing requirements) for people who build software with AI coding agents. You are going to read the public code or documentation of one tool, extract the capabilities it offers, and contribute them to airedb.`);
  L.push('');
  L.push('The golden rule: **a requirement says WHAT the software must do, never WHERE or HOW it looks** (no screens, buttons, layouts, colours; and no product names inside the statement). Write it so it applies to any implementation, e.g. "Users can reset a forgotten password through a single-use link that expires", not "the Clerk sign-in form has a Forgot password button".');
  L.push('');
  L.push('## What to study');
  L.push('');
  L.push(`- Tool: **${nombre}**${herramienta.category ? ` (${limpiarLinea(herramienta.category, 40)})` : ''}${desc ? `: ${desc}` : ''}`);
  if (codigo) L.push(`- Code: ${codigo}`);
  if (docs) L.push(`- Documentation: ${docs}`);
  if (plat) L.push(`- Platforms: ${plat}`);
  L.push('');
  L.push('Read the documentation and the public repository (README, docs folder, feature lists, configuration options). Make a list of the distinct capabilities the tool provides that a team building an app would need to specify: functional behaviour people notice, and technical behaviour (security, reliability, operations).');
  L.push('');
  L.push('## Access');
  L.push('');
  L.push(`- Base URL: \`${B}\``);
  L.push('- Reading is public. Contributing needs an API key, sent as `Authorization: Bearer rq_…`.');
  L.push('- Get a key: sign in on the website, open your account menu → API keys → Create key. It is shown only once.');
  L.push('- Ask the person for the key (or read it from the environment variable `AIREDB_KEY`). Never print it, never write it into a file, never commit it, and never invent one.');
  L.push('');
  L.push('## Steps');
  L.push('');
  L.push('### 1. For each candidate capability, check whether airedb already has it');
  L.push('');
  L.push('Search by meaning, in English, with a short natural description of the capability:');
  L.push('');
  L.push('```http');
  L.push(`GET ${B}${R.buscarRequisitos}?q=<capability in plain English>&limit=5&sort=relevance&include=accelerators`);
  L.push('```');
  L.push('');
  L.push('Read the 5 results: each has a `slug`, `statement`, `categories` and, with `include=accelerators`, the accelerators already linked to it. If a result says the same thing, it already exists.');
  L.push('');
  L.push('### 2. Propose the requirement (or its improvement)');
  L.push('');
  L.push('- **It already exists and you add nothing:** skip it. Do not propose duplicates.');
  L.push('- **It already exists but you can add something** (a missing criterion, a clearer or more current statement, a missing category): propose the improved version, pointing to the existing slug in `improves`.');
  L.push('- **It does not exist:** propose it as new. Use `GET ' + `${B}/api/v1/categories?q=<word>` + '` to pick real category slugs.');
  L.push('');
  L.push(R.contribuir.vigente);
  L.push('');
  L.push('```http');
  L.push(C);
  L.push('Authorization: Bearer rq_…');
  L.push('Content-Type: application/json');
  L.push('```');
  L.push('');
  L.push('New requirement:');
  L.push('');
  L.push('```json');
  L.push(json(PLANTILLAS.requirement));
  L.push('```');
  L.push('');
  L.push('Improvement of an existing one:');
  L.push('');
  L.push('```json');
  L.push(json(PLANTILLAS.requirement_update));
  L.push('```');
  L.push('');
  L.push('Optionally, a test that checks a requirement (same route, `type: "test"`):');
  L.push('');
  L.push('```json');
  L.push(json(PLANTILLAS.test));
  L.push('```');
  L.push('');
  L.push('### 3. Propose the accelerator');
  L.push('');
  L.push(`"${nombre}" itself (or a part of it) is an accelerator when using it saves work on a requirement. First check it is not there yet: \`GET ${B}${R.buscarAceleradores}?q=${encodeURIComponent(nombre)}&limit=5\`. If it exists, link it to the extra requirements it covers; if not, create it. One accelerator can cover SEVERAL requirements: list every requirement it helps with, each marked \`full\` (it does the whole job) or \`partial\` (it helps, you still need more). Use the slugs found in step 1 (or the ones you just proposed).`);
  L.push('');
  L.push('```http');
  L.push(C);
  L.push('```');
  L.push('');
  L.push('```json');
  L.push(json(PLANTILLAS.accelerator));
  L.push('```');
  L.push('');
  L.push('### 4. Limits and rules');
  L.push('');
  L.push('- English only, in your own words. Do not copy text from the documentation or the code beyond a few words: paraphrase (copyright).');
  L.push('- Never invent URLs. Only use URLs you actually opened and that load; a URL you cannot verify is omitted, not guessed.');
  L.push('- One proposal per call. Quotas: reading about 120 requests per minute with a key; contributions are limited per day (about 10 per person), so send the most valuable proposals first and stop when the server answers 429 (wait for `retry-after`).');
  L.push('- Priorities are 1 (essential) to 5 (nice to have). If you are unsure, use 3.');
  L.push('- Everything is reviewed before it is published; some proposals will be merged with existing ones or declined. That is normal.');
  L.push(`- \`POST ${B}${R.sugerir}\` is ONLY for suggestions about the airedb app itself (a new feature or a problem). Do not use it for requirements, tests or accelerators.`);
  L.push('');
  L.push('### 5. Finish');
  L.push('');
  L.push('At the end, report to the person: how many capabilities you found, how many already existed, which proposals you sent (with the answer of the server for each) and which ones you left out and why.');
  L.push('');
  return L.join('\n');
}
