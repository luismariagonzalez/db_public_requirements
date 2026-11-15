// Completa una lista de requisitos antes de devolverla:
//   · anota el estado que cada cosa tiene en el proyecto (project_status)
//   · oculta lo que el proyecto ya tiene en ciertos estados (hide=done,skipped)
//   · añade sus tests y aceleradores relacionados (include=tests,accelerators)
// Puro respecto a la red: recibe las dependencias.

import { rpc } from './bd.mjs';

// estados: { "requirement:<slug>": "done", "test:<slug>": "planned", … } o null
export function anotar(items, tipo, estados) {
  if (!estados) return items;
  return items.map((it) => (estados[`${tipo}:${it.slug}`] ? { ...it, project_status: estados[`${tipo}:${it.slug}`] } : it));
}

export function ocultarPorEstado(items, ocultar) {
  return ocultar?.length ? items.filter((it) => !ocultar.includes(it.project_status)) : items;
}

export async function enriquecer(items, opts, deps = { rpc }) {
  const { estados = null, ocultar = [], incluirTests = false, incluirAceleradores = false, testsMax = 5 } = opts;

  let res = ocultarPorEstado(anotar(items, 'requirement', estados), ocultar);

  if ((incluirTests || incluirAceleradores) && res.length) {
    const rel = await deps.rpc('relacionados', {
      p_slugs: res.map((i) => i.slug), p_tests: incluirTests, p_tests_max: testsMax, p_aceleradores: incluirAceleradores });
    res = res.map((it) => {
      const r = rel?.[it.slug] ?? { tests: [], accelerators: [] };
      return {
        ...it,
        ...(incluirTests ? { tests: ocultarPorEstado(anotar(r.tests, 'test', estados), ocultar) } : {}),
        ...(incluirAceleradores ? { accelerators: ocultarPorEstado(anotar(r.accelerators, 'accelerator', estados), ocultar) } : {}),
      };
    });
  }
  return res;
}
