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

export function paginaTerminos(md) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Content Terms · Requirements DB</title>
<link rel="icon" href="data:,">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="./estilo.css">
</head>
<body>
<main>
<p><a href="./index.html">← Back</a> · <a href="./legal.html">Legal notice &amp; privacy</a></p>
${mdAHtml(md)}
</main>
</body>
</html>
`;
}
