// Idioma de la interfaz: inglés y español. Sin librerías: un diccionario por idioma
// (textos-en.js, textos-es.js), la clave que falta cae al inglés y la que no existe
// en ninguno se ve tal cual (así se nota). El contenido de la base NO se traduce.
//
// En el HTML: data-i18n="clave" (texto) · data-i18n-html="clave" (marcado de confianza del
// diccionario) · data-i18n-attr="placeholder:clave;aria-label:otra" (atributos).
// El idioma se elige con ?lang=es|en, con el conmutador (se recuerda en localStorage)
// o, si no, con el del navegador.
import en from './textos-en.js';
import es from './textos-es.js';
import colEn from './textos-colaborar-en.js';   // la caja «¿Quieres colaborar?» tiene sus propios diccionarios
import colEs from './textos-colaborar-es.js';

export const IDIOMAS = ['en', 'es'];
const DICC = { en: { ...en, ...colEn }, es: { ...es, ...colEs } };
let actual = 'en';

export function idiomaInicial(ubicacion = globalThis.location, almacen = globalThis.localStorage, navegador = globalThis.navigator) {
  try {
    const q = new URLSearchParams(ubicacion?.search ?? '').get('lang');
    if (IDIOMAS.includes(q)) { almacen?.setItem('rq_lang', q); return q; }
    const guardado = almacen?.getItem('rq_lang');
    if (IDIOMAS.includes(guardado)) return guardado;
  } catch { /* ventana privada: sin almacén */ }
  return /^es\b/i.test(navegador?.language ?? '') ? 'es' : 'en';
}

export const idioma = () => actual;
export function fijar(l) {
  actual = IDIOMAS.includes(l) ? l : 'en';
  if (globalThis.document) document.documentElement.lang = actual;
  try { globalThis.localStorage?.setItem('rq_lang', actual); } catch { /* ventana privada */ }
}

export function t(clave, vars = {}) {
  const s = DICC[actual][clave] ?? DICC.en[clave] ?? clave;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
// Plural sencillo: claves «base.one» y «base.other».
export const tn = (base, n, vars = {}) => t(`${base}.${n === 1 ? 'one' : 'other'}`, { n, ...vars });
export const fecha = (d) => new Date(d).toLocaleDateString(actual === 'es' ? 'es-ES' : 'en-GB');

export function aplicar(raiz = document) {
  for (const e of raiz.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of raiz.querySelectorAll('[data-i18n-html]')) e.innerHTML = t(e.dataset.i18nHtml);   // solo diccionario propio
  for (const e of raiz.querySelectorAll('[data-i18n-attr]'))
    for (const par of e.dataset.i18nAttr.split(';')) { const [a, k] = par.split(':'); if (a && k) e.setAttribute(a.trim(), t(k.trim())); }
  // Solo las páginas que lo piden (<html data-titulo="meta.title">) cambian su <title> y su descripción.
  if (raiz === document && document.documentElement.dataset.titulo) {
    document.title = t(document.documentElement.dataset.titulo);
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  }
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === actual));
}

// Arranca: fija el idioma, traduce lo estático y engancha el conmutador (EN | ES).
export function iniciar(alCambiar) {
  fijar(idiomaInicial());
  aplicar();
  for (const b of document.querySelectorAll('[data-lang]'))
    b.addEventListener('click', () => { fijar(b.dataset.lang); aplicar(); alCambiar?.(actual); });
}
