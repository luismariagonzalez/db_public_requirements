// La caja «¿Quieres colaborar?»: carga el catálogo (GET /api/v1/tools), deja elegir una
// herramienta y copiar el prompt para el agente (generado por prompt_colaborador.js).
// Todo lo que viene de la base se pinta con textContent, nunca con innerHTML.
import { generarPrompt, filtrarHerramientas, urlHttps } from './prompt_colaborador.js';
import { t as T } from './i18n.js';

// ctx: { $, el, api, copiar, base }  (los ayudantes de app.js; base = origen + ruta donde está montada la app)
export function iniciarColaborar({ $, el, api, copiar, base }) {
  const e = { lista: $('#colLista'), estado: $('#colEstado'), buscar: $('#colBuscar'), detalle: $('#colDetalle'),
    prompt: $('#colPrompt'), copiar: $('#colCopiar'), chars: $('#colChars') };
  let herramientas = null;      // null = sin cargar
  let cargando = false;
  let error = null;
  let elegida = null;           // slug

  const enlace = (etq, url) => { const href = urlHttps(url);
    return href ? el('a', { href, rel: 'noopener noreferrer', target: '_blank' }, `${etq} ↗`) : null; };

  function pintarLista() {
    e.lista.replaceChildren();
    if (error) { e.estado.textContent = T('col.error', { e: error }); return; }
    if (!herramientas) { e.estado.textContent = T('col.cargando'); return; }
    const visibles = filtrarHerramientas(herramientas, e.buscar.value);
    e.estado.textContent = visibles.length ? '' : T('col.vacio');
    for (const h of visibles) {
      const sel = h.slug === elegida;
      e.lista.append(el('li', {}, el('button', { type: 'button', class: 'col-item', 'aria-pressed': String(sel), 'data-slug': h.slug,
        onclick: () => elegir(h.slug) },
        el('span', {}, h.name), el('small', { class: 'tenue' }, T(`col.cat.${h.category}`)))));
    }
  }

  function pintarDetalle() {
    const h = herramientas?.find((x) => x.slug === elegida);
    e.detalle.replaceChildren();
    e.copiar.disabled = !h;
    if (!h) { e.prompt.textContent = T('col.elige'); e.chars.textContent = ''; return; }
    e.detalle.append(el('strong', {}, h.name), el('span', { class: 'nota' }, h.description ?? ''),
      el('span', { class: 'col-enl nota' }, enlace(T('col.codigo'), h.code_url), enlace(T('col.docs'), h.docs_url)));
    const texto = generarPrompt({ herramienta: h, base });
    e.prompt.textContent = texto;
    e.chars.textContent = T('col.chars', { n: texto.length.toLocaleString(document.documentElement.lang) });
  }

  function elegir(slug) { elegida = slug; pintarLista(); pintarDetalle(); }
  function repintar() { pintarLista(); pintarDetalle(); }

  async function cargar() {
    if (herramientas || cargando) return;
    cargando = true;
    try { herramientas = (await api('GET', '/api/v1/tools')).tools ?? []; error = null; }
    catch (err) { error = err.message; }
    cargando = false;
    repintar();
  }

  e.buscar.addEventListener('input', pintarLista);
  e.copiar.addEventListener('click', () => { if (e.prompt.textContent && elegida) copiar(e.prompt.textContent); });
  // El catálogo se pide al acercarse a la caja (o al llegar con #colaborar), no al abrir la página.
  if ('IntersectionObserver' in window) {
    const ob = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { ob.disconnect(); cargar(); } }, { rootMargin: '600px' });
    ob.observe($('#colaborar'));
  } else cargar();
  $('#btnColaborar').addEventListener('click', cargar);
  repintar();
  return { repintar, elegir, cargar };
}
