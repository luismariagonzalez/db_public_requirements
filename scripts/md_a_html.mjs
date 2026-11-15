// Convierte el Markdown sencillo de LICENSE-DATA.md en HTML para web/terms.html.
// Mínimo a propósito (títulos, párrafos, listas, **negrita**, `código`, *cursiva*,
// enlaces http/https): escapa TODO el texto antes de formatear, así que un
// documento con HTML dentro no puede inyectar nada.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

export function mdAHtml(md) {
  const out = [];
  let lista = null;   // 'ul' | 'ol'
  const cierra = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const linea of md.split(/\r?\n/)) {
    let m;
    if (!linea.trim()) { cierra(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(linea))) { cierra(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = /^-\s+(.*)$/.exec(linea))) { if (lista !== 'ul') { cierra(); out.push('<ul>'); lista = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\d+\.\s+(.*)$/.exec(linea))) { if (lista !== 'ol') { cierra(); out.push('<ol>'); lista = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    cierra(); out.push(`<p>${inline(linea)}</p>`);
  }
  cierra();
  return out.join('\n');
}

// Cabecera común de las páginas de texto estáticas: volver + conmutador EN | ES.
// Cada bloque de idioma lleva class="en" o class="es"; el CSS (html[lang]) enseña uno.
export const cabeceraEstatica = (extra = '') => `<header class="cab-est">
  <a href="./index.html"><span class="en">← Back</span><span class="es">← Volver</span></a>${extra}
  <span class="idiomas" role="group" aria-label="Language / Idioma"><button type="button" data-lang="en" aria-pressed="true">EN</button><button type="button" data-lang="es" aria-pressed="false">ES</button></span>
</header>`;

export const cabezaHtml = (titulo) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<link rel="icon" href="data:,">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="./estilo.css">
<script type="module" src="./pagina.js"></script>`;

export function paginaTerminos(md, mdEs = '') {
  const enlaces = `<span class="en"><a href="./legal.html">Legal notice &amp; privacy</a></span><span class="es"><a href="./legal.html">Aviso legal y privacidad</a></span>`;
  return `<!doctype html>
<html lang="en">
<head>
${cabezaHtml('Content Terms · Requirements DB')}
</head>
<body>
<main>
${cabeceraEstatica(` · ${enlaces}`)}
<div class="en">
${mdAHtml(md)}
</div>
<div class="es">
${mdAHtml(mdEs || md)}
</div>
</main>
</body>
</html>
`;
}
