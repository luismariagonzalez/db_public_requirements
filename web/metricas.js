// Formato de las métricas de popularidad de un acelerador (estrellas y descargas).
// Puro: sin document ni fetch. Lo usan la web (web/app.js) y, para el Markdown del agente,
// lib/markdown.mjs (por eso vive aquí y no en lib/: web/ se publica tal cual).

const UNIDADES = ['', 'k', 'M', 'G', 'T'];

// 950 → «950»; 1234 → «1,2 k» (es) / «1.2 k» (en); 3 400 000 → «3,4 M». Sin decimales si son .0.
// sinEspacio: «1.2k», para el Markdown del agente.
export function abreviar(n, locale = 'en', { sinEspacio = false } = {}) {
  if (!Number.isFinite(n) || n < 0) return '';
  let v = n, u = 0;
  while (v >= 1000 && u < UNIDADES.length - 1) { v /= 1000; u++; }
  // 999 950 → 1000 k tras redondear: se sube de unidad
  if (u > 0 && Math.round(v * 10) / 10 >= 1000 && u < UNIDADES.length - 1) { v /= 1000; u++; }
  const num = u === 0 ? String(Math.round(v)) : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.round(v * 10) / 10);
  return u === 0 ? num : `${num}${sinEspacio ? '' : ' '}${UNIDADES[u]}`;
}

const esNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Las métricas que un acelerador trae (ficha o chip). → { stars, mes, total, registro, archivado, actualizado } o null si no hay nada.
export function metricasDe(a) {
  if (!a) return null;
  const stars = esNum(a.stars) ? a.stars : null;
  const mes = esNum(a.downloads_month) ? a.downloads_month : null;
  const total = esNum(a.downloads_total) ? a.downloads_total : null;
  if (stars === null && mes === null && total === null) return null;
  return { stars, mes, total, registro: a.registry ?? null, archivado: a.archived === true, actualizado: a.metrics_updated_at ?? null };
}

// Homebrew mide instalaciones, no descargas.
const palabraDescargas = (registro) => (registro === 'homebrew' ? 'installs' : 'downloads');

// Texto compacto para el Markdown del agente: «12.3k stars · 1.2M downloads/mo» (o «… total»). '' si no hay métricas.
export function textoCompacto(a) {
  const m = metricasDe(a);
  if (!m) return '';
  const p = [];
  if (m.stars !== null) p.push(`${abreviar(m.stars, 'en', { sinEspacio: true })} stars`);
  if (m.mes !== null) p.push(`${abreviar(m.mes, 'en', { sinEspacio: true })} ${palabraDescargas(m.registro)}/mo`);
  else if (m.total !== null) p.push(`${abreviar(m.total, 'en', { sinEspacio: true })} ${palabraDescargas(m.registro)} total`);
  if (m.archivado) p.push('archived');
  return p.join(' · ');
}

// Para la web: las piezas del chip de un acelerador. t y fecha son los de i18n (inyectados: este módulo no
// depende de ellos). → null si no hay métricas, o { partes: [{ texto, titulo }], titulo } con el título del
// chip entero (incluida la fecha de la última actualización).
export function piezasMetricas(a, { t, fecha, locale }) {
  const m = metricasDe(a);
  if (!m) return null;
  const partes = [];
  if (m.stars !== null) partes.push({ texto: `⭐ ${abreviar(m.stars, locale)}`, titulo: t('met.stars.t', { n: m.stars.toLocaleString(locale) }) });
  const brew = m.registro === 'homebrew';
  if (m.mes !== null)
    partes.push({ texto: `↓ ${abreviar(m.mes, locale)}${t('met.mes')}`,
      titulo: t(brew ? 'met.mes.brew.t' : 'met.mes.t', { n: m.mes.toLocaleString(locale), registro: m.registro ?? '' }) });
  else if (m.total !== null)
    partes.push({ texto: `↓ ${abreviar(m.total, locale)}${t('met.total')}`, titulo: t('met.total.t', { n: m.total.toLocaleString(locale), registro: m.registro ?? '' }) });
  if (m.archivado) partes.push({ texto: t('met.archived'), titulo: t('met.archived.t') });
  const actualizado = m.actualizado && !Number.isNaN(new Date(m.actualizado).getTime()) ? t('met.updated', { fecha: fecha(m.actualizado) }) : '';
  return { partes, titulo: [...partes.map((p) => p.titulo), actualizado].filter(Boolean).join(' · ') };
}
