#!/usr/bin/env node
// Servidor estático mínimo, sin dependencias. Sirve el repo tal cual, que es lo Sin dependencias.
//   que hace Vercel con publico/.
//   node scripts/servir.mjs [puerto]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize } from 'node:path';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.argv[2]) || 5173;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let ruta = decodeURIComponent(req.url.split('?')[0]);

  // Redirección de verdad, no servir el HTML desde «/»: si no, los imports
  // relativos del módulo (./motor.js) resolverían contra la raíz y darían 404.
  if (ruta === '/') {
    res.writeHead(302, { Location: "/web/index.html" }).end();
    return;
  }

  // No salir de la raíz del proyecto.
  const destino = join(RAIZ, normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
  // Ni ficheros ocultos (.env, .git): este servidor sirve el repo en crudo.
  if (!destino.startsWith(RAIZ) || /[\\/]\./.test(destino.slice(RAIZ.length - 1))) {
    res.writeHead(403).end('403');
    return;
  }

  try {
    const cuerpo = await readFile(destino);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(destino)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', // el JSON cambia a mano constantemente
    });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 · ' + ruta);
  }
// Solo esta máquina: sirve el repo entero, no la carpeta publicada.
}).listen(PUERTO, '127.0.0.1', () => console.log(`http://127.0.0.1:${PUERTO}`));
