// Acceso a la base compartida: SOLO funciones public.db_public_requirements_srv_*,
// llamadas por REST con la clave secreta (service_role). Esa clave se salta el
// RLS entero: vive únicamente en el entorno del servidor, nunca en web/.

export async function rpc(verbo, args = {}) {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) throw new Error('faltan SUPABASE_URL / SUPABASE_SECRET_KEY');

  const r = await fetch(`${url}/rest/v1/rpc/db_public_requirements_srv_${verbo}`, {
    method: 'POST',
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await r.text();
  if (!r.ok) {
    let msg = texto;
    try { msg = JSON.parse(texto).message ?? texto; } catch { /* texto plano */ }
    const e = new Error(msg.slice(0, 300));
    e.status = r.status;
    throw e;
  }
  return texto ? JSON.parse(texto) : null;
}
