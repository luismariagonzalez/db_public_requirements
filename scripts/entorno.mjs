// De dónde salen los secretos.
//
// Dos sitios, en este orden, y los dos opcionales:
//
//   1. ~/.secretos/home.env   lo COMPARTIDO por todos los proyectos de la home:
//                             Supabase, Vercel, GitHub. Una sola copia en el
//                             disco, fuera de OneDrive. Rotar una clave es
//                             cambiarla ahí, no ir repo por repo.
//   2. ./.env                 lo de ESTE proyecto, y solo lo de este. Pisa al
//                             común si repite una clave.
//
// Lo que ya venga en el entorno del proceso gana sobre los dos: así un `docker
// run -e` o las variables de Vercel no las pisa nadie.
//
// No hay dependencias: el formato es el de siempre, CLAVE=valor, con comillas
// opcionales y almohadilla para comentar.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const COMUN = process.env.SECRETOS_HOME ?? join(homedir(), '.secretos', 'home.env');

function parsear(texto) {
  const salida = {};
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const clave = t.slice(0, i).trim();
    let valor = t.slice(i + 1).trim();
    // Entre comillas se respeta todo, incluidas las almohadillas. Sin comillas,
    // una almohadilla empieza un comentario — que es justo donde se pierde media
    // contraseña si nadie lo cuenta.
    if ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'")))
      valor = valor.slice(1, -1);
    else
      valor = valor.split(' #')[0].trim();
    salida[clave] = valor;
  }
  return salida;
}

export function cargarEntorno({ silencioso = true } = {}) {
  const cargados = [];
  for (const ruta of [COMUN, '.env']) {
    if (!existsSync(ruta)) continue;
    const vars = parsear(readFileSync(ruta, 'utf8'));
    for (const [k, v] of Object.entries(vars))
      if (process.env[k] === undefined) process.env[k] = v;   // el entorno manda
    cargados.push(`${ruta} (${Object.keys(vars).length})`);
  }
  if (!silencioso) console.log(`  entorno: ${cargados.join(' + ') || 'nada que cargar'}`);
  return cargados;
}

// Falla pronto y diciendo qué falta, en vez de reventar en medio de una query.
export function exige(...claves) {
  const faltan = claves.filter((k) => !process.env[k]);
  if (faltan.length) {
    console.error(`\n  Faltan variables: ${faltan.join(', ')}`);
    console.error(`  Míralas en ${COMUN} o en el .env de este proyecto.\n`);
    process.exit(1);
  }
}

cargarEntorno();
