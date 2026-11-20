// Reglas puras de la reorganización de la taxonomía (migraciones 0004 y 0005): qué clase
// tiene un requisito, a qué flujos de acceso pertenece, qué transversal le falta y de qué
// arquetipos hereda una categoría de software. Sin red ni ficheros: las usa
// scripts/reorganizar.mjs (que pregunta a Gemini lo que las reglas no deciden) y se prueban
// en tests/reorganizar.test.mjs.

export const CLASES = ['functional', 'technical'];
export const FLUJOS_ACCESO = ['flow-sign-up', 'flow-sign-in', 'flow-recovery'];

// Los 16 arquetipos originales (semilla/categorias.json) y los 13 de la migración 0004.
export const ARQUETIPOS_ORIGINALES = ['messaging', 'social-network', 'marketplace-ecommerce', 'saas-b2b', 'multiplayer-game',
  'single-player-game', 'fintech', 'booking-scheduling', 'cms-blog', 'media-streaming', 'productivity-notes', 'health-fitness',
  'e-learning', 'ai-chat-app', 'analytics-dashboard', 'mobile-utility'];
export const ARQUETIPOS_NUEVOS = [
  ['crm-sales', 'CRM / sales: contacts, accounts, deals, pipelines, sales forecasting'],
  ['marketing-automation-platform', 'Marketing automation platform: campaigns, audiences, email/SMS, landing pages, lead scoring'],
  ['helpdesk-support', 'Helpdesk / customer support: tickets, queues, SLAs, knowledge base, live chat'],
  ['erp-operations', 'ERP / operations: orders, inventory, purchasing, production, shipping, work orders'],
  ['accounting-invoicing', 'Accounting / invoicing: invoices, payments, ledgers, taxes, expenses'],
  ['hr-people', 'HR / people: employee records, recruiting, onboarding, leave, payroll, performance'],
  ['healthcare-clinical', 'Healthcare / clinical: patients, appointments, clinical records, prescriptions, consent'],
  ['property-real-estate', 'Property / real estate: listings, tenants, leases, maintenance, viewings'],
  ['field-service-fleet', 'Field service / fleet: jobs, dispatch, routes, vehicles, assets, mobile work'],
  ['developer-platform-api', 'Developer platform / API: API keys, SDKs, webhooks, rate limits, documentation, sandboxes'],
  ['video-voice-communication', 'Video / voice communication: calls, meetings, recording, presence, call quality'],
  ['internal-tool-backoffice', 'Internal tool / back-office: admin screens over company data, roles, audit, approvals'],
  ['other-business-software', 'Other business software: generic accounts, roles, records, notifications and reports'],
];
export const ARQUETIPOS = [...ARQUETIPOS_ORIGINALES, ...ARQUETIPOS_NUEVOS.map(([s]) => s)];
export const ARQUETIPO_COMODIN = 'other-business-software';

// Cada tema de la clase antigua tiene un transversal con el mismo asunto.
export const TRANSVERSAL_DE_CLASE = { security: 'security', privacy: 'privacy-gdpr', accessibility: 'accessibility',
  performance: 'performance', reliability: 'reliability-observability' };

// Misma regla que db_public_requirements.slugify en SQL (para localizar el requisito en la base).
export const slugDe = (titulo) =>
  String(titulo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 110).replace(/^-+|-+$/g, '');

// Regla fija de la clase. null = no lo decide la regla: se le pregunta a Gemini.
export function claseFija(kind) {
  if (kind === 'functional') return 'functional';
  if (['technical', 'performance', 'reliability'].includes(kind)) return 'technical';
  return null;
}

export const validaClase = (c) => (CLASES.includes(c) ? c : null);

// Flujos válidos de una respuesta de Gemini; si no queda ninguno, el requisito se queda en los tres.
export function flujosValidos(lista) {
  const f = [...new Set((Array.isArray(lista) ? lista : []).filter((x) => FLUJOS_ACCESO.includes(x)))];
  return f.length ? f : null;
}

// Arquetipos válidos (1 a 3). Sin ninguno válido, el comodín.
export function arquetiposValidos(lista) {
  const a = [...new Set((Array.isArray(lista) ? lista : []).filter((x) => ARQUETIPOS.includes(x)))].slice(0, 3);
  return a.length ? a : [ARQUETIPO_COMODIN];
}

// requisitos: [{ slug, kind, categories: [{slug, priority}] }] con la clase ANTIGUA.
// Devuelve los transversales que les faltan: [{ slug, categoria, prioridad }], con la mejor
// prioridad que ya tuviera el requisito.
export function transversalesQueFaltan(requisitos) {
  const salida = [];
  for (const r of requisitos) {
    const t = TRANSVERSAL_DE_CLASE[r.kind];
    if (!t || (r.categories ?? []).some((c) => c.slug === t)) continue;
    const prioridad = Math.min(...(r.categories ?? []).map((c) => c.priority), 5);
    salida.push({ slug: r.slug, categoria: t, prioridad });
  }
  return salida;
}
