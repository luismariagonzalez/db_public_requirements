// Tabla de rutas de la API. Una función de Vercel (api/[...ruta].js) las atiende todas.
import { compilar } from './router.mjs';
import * as lectura from './handlers/lectura.mjs';
import * as proyectos from './handlers/proyectos.mjs';
import * as sugerencias from './handlers/sugerencias.mjs';
import * as cuenta from './handlers/cuenta.mjs';

export const rutas = compilar([
  // lectura pública
  ['GET', '/api/v1/categories', lectura.categorias],
  ['GET', '/api/v1/requirements', lectura.listarRequisitos],
  ['GET', '/api/v1/requirements/:slug', lectura.verRequisito],
  ['POST', '/api/v1/export', lectura.exportar],
  ['GET', '/api/v1/tests', lectura.listarTests],
  ['GET', '/api/v1/tests/:slug', lectura.verTest],
  ['GET', '/api/v1/accelerators', lectura.listarAceleradores],
  ['GET', '/api/v1/accelerators/:slug', lectura.verAcelerador],
  ['GET', '/api/v1/agent-instructions', lectura.instruccionesAgente],

  // cuenta (sesión o API key): proyectos y sugerencias
  ['GET', '/api/v1/projects', proyectos.listar],
  ['POST', '/api/v1/projects', proyectos.crear],
  ['GET', '/api/v1/projects/:id', proyectos.ver],
  ['DELETE', '/api/v1/projects/:id', proyectos.borrar],
  ['PUT', '/api/v1/projects/:id/items', proyectos.marcarItems],
  ['POST', '/api/v1/projects/:id/items', proyectos.marcarItems],
  ['GET', '/api/v1/suggestions', sugerencias.listar],
  ['POST', '/api/v1/suggestions', sugerencias.crear],

  // solo sesión de Clerk
  ['POST', '/api/contribute', cuenta.aportar],
  ['GET', '/api/me/contributions', cuenta.misAportes],
  ['GET', '/api/me/keys', cuenta.listarKeys],
  ['POST', '/api/me/keys', cuenta.crearKey],
  ['DELETE', '/api/me/keys', cuenta.revocarKey],
  ['DELETE', '/api/me', cuenta.borrarMisDatos],
]);
