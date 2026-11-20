// Tabla de rutas de la API. Una función de Vercel (api/entrada.js) las atiende todas.
import { compilar } from './router.mjs';
import * as lectura from './handlers/lectura.mjs';
import * as proyectos from './handlers/proyectos.mjs';
import * as sugerencias from './handlers/sugerencias.mjs';
import * as cuenta from './handlers/cuenta.mjs';
import * as admin from './handlers/admin.mjs';

export const rutas = compilar([
  // lectura pública
  ['GET', '/api/v1/categories', lectura.categorias],
  ['GET', '/api/v1/requirements', lectura.listarRequisitos],
  ['GET', '/api/v1/requirements/:slug', lectura.verRequisito],
  ['POST', '/api/v1/export', lectura.exportar],
  ['POST', '/api/v1/copied', lectura.copiado],
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

  // zona admin: sesión de Clerk con el sub en ADMIN_SUBS (lib/admin.mjs); una API key nunca vale
  ['GET', '/api/admin/me', admin.yo],
  ['GET', '/api/admin/overview', admin.resumen],
  ['GET', '/api/admin/activity', admin.actividad],
  ['GET', '/api/admin/panels', admin.paneles],
  ['GET', '/api/admin/audit', admin.auditoria],
  ['GET', '/api/admin/contributions', admin.aportes],
  ['POST', '/api/admin/contributions/:id/approve', admin.aprobarAporte],
  ['POST', '/api/admin/contributions/:id/reject', admin.rechazarAporte],
  ['GET', '/api/admin/suggestions', admin.sugerencias],
  ['POST', '/api/admin/suggestions/:id/status', admin.cambiarSugerencia],
  ['GET', '/api/admin/requirements/:slug/history', admin.historial],
  ['GET', '/api/admin/split/candidates', admin.candidatos],
  ['POST', '/api/admin/split/propose', admin.proponerDividir],
  ['GET', '/api/admin/split/proposals', admin.propuestas],
  ['POST', '/api/admin/split/proposals/:id/accept', admin.aceptarPropuesta],
  ['POST', '/api/admin/split/proposals/:id/dismiss', admin.descartarPropuesta],
]);
