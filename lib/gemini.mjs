// Gemini por fetch, sin SDK. Embeddings (768 dims) y generación con salida JSON
// estructurada. Los nombres de modelo son configurables: cámbialos por entorno
// si Google los renombra.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DIMS = 768;

const clave = () => {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('falta GEMINI_API_KEY');
  return k;
};

async function llamar(ruta, cuerpo, reintentos = 2) {
  for (let intento = 0; ; intento++) {
    const r = await fetch(`${BASE}/${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': clave() },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS ?? 25_000)),
    });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && intento < reintentos) {
      await new Promise((ok) => setTimeout(ok, 600 * (intento + 1)));
      continue;
    }
    throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// Con outputDimensionality < 3072 el vector no sale normalizado: se normaliza
// aquí para que la distancia coseno sea comparable.
function normalizar(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

// tarea: 'RETRIEVAL_DOCUMENT' (lo que se guarda y los aportes) o
//        'RETRIEVAL_QUERY' (lo que escribe quien busca).
export async function embed(texto, tarea = 'RETRIEVAL_DOCUMENT') {
  const modelo = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-001';
  const j = await llamar(`models/${modelo}:embedContent`, {
    content: { parts: [{ text: texto.slice(0, 8000) }] },
    taskType: tarea,
    outputDimensionality: DIMS,
  });
  const v = j?.embedding?.values;
  if (!Array.isArray(v) || v.length !== DIMS) throw new Error('Gemini devolvió un embedding inesperado');
  return normalizar(v);
}

// Varios textos en una llamada (hasta 100). Para la semilla y las deduplicaciones.
export async function embedLote(textos, tarea = 'RETRIEVAL_DOCUMENT') {
  const modelo = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-001';
  const salida = [];
  for (let i = 0; i < textos.length; i += 100) {
    const trozo = textos.slice(i, i + 100);
    const j = await llamar(`models/${modelo}:batchEmbedContents`, {
      requests: trozo.map((t) => ({
        model: `models/${modelo}`,
        content: { parts: [{ text: t.slice(0, 8000) }] },
        taskType: tarea,
        outputDimensionality: DIMS,
      })),
    });
    const vs = j?.embeddings?.map((e) => e.values);
    if (!vs || vs.length !== trozo.length || vs.some((v) => v?.length !== DIMS))
      throw new Error('Gemini devolvió embeddings inesperados');
    salida.push(...vs.map(normalizar));
  }
  return salida;
}

// El vector viaja a Postgres como literal '[0.1,0.2,…]'.
export const aLiteral = (v) => `[${v.map((x) => Number(x.toFixed(6))).join(',')}]`;

// Devuelve el objeto JSON ya parseado. `esquema` es un JSON schema (subconjunto
// OpenAPI que admite Gemini). Aun así el llamador valida el resultado.
export async function generarJson(prompt, esquema, { maxTokens = 4096 } = {}) {
  const modelo = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const j = await llamar(`models/${modelo}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: esquema,
      maxOutputTokens: maxTokens,
    },
  });
  const texto = j?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try { return JSON.parse(texto); }
  catch { throw new Error('Gemini no devolvió JSON válido'); }
}
