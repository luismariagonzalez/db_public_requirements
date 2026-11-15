#!/usr/bin/env node
// El «build»: escribir la config del navegador y dejar en publico/ SOLO lo que
// se publica. Lo llama Vercel (buildCommand en vercel.json).
//
// La lista de lo que se copia es BLANCA a propósito: añadir un fichero al
// repositorio no debe exponerlo en internet sin que nadie lo decida.

import { mkdirSync, copyFileSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { paginaTerminos } from './md_a_html.mjs';

const raiz = new URL('../', import.meta.url);

// ── 1. config del navegador
// Esta web no lleva ninguna credencial de Supabase: habla solo con api/ (misma
// origen). La clave publicable de Clerk va en web/clerk.js, a la vista a
// propósito: es pública por diseño. La secreta de Supabase y la de Gemini viven
// únicamente en el entorno de las funciones de api/.

// ── 2. publico/ = lo único que sale a internet
// web/ se aplana en la raíz, así index.html cae en «/» y no hace falta ningún
// rewrite en vercel.json.
const destino = new URL('publico/', raiz);
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

const PUBLICABLE = /\.(html|js|css|svg|png|jpe?g|webp|woff2?|ico|json)$/;
for (const f of readdirSync(new URL('web/', raiz)).filter((f) => PUBLICABLE.test(f)))
  copyFileSync(new URL(`web/${f}`, raiz), new URL(f, destino));

// El CLI (un solo fichero, sin dependencias) se publica junto a la web: /reqdb.mjs
copyFileSync(new URL('cli/reqdb.mjs', raiz), new URL('reqdb.mjs', destino));

// Los términos del contenido se publican desde LICENSE-DATA.md (inglés, el que vale) y su
// traducción de cortesía LICENSE-DATA.es.md.
writeFileSync(new URL('terms.html', destino), paginaTerminos(
  readFileSync(new URL('LICENSE-DATA.md', raiz), 'utf8'),
  readFileSync(new URL('LICENSE-DATA.es.md', raiz), 'utf8'),
));

console.log('  ✓ publico/ listo');
