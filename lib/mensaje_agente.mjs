// El mensaje para el AGENTE de vibe coding: que deje registrado en el proyecto de
// la persona qué requisitos, tests y aceleradores ha implementado y cuáles
// quedan pendientes o en el roadmap. Puro: lo añade la API a los Markdown y a
// los JSON que devuelve.

export const ESTADOS = ['done', 'in_progress', 'planned', 'skipped'];

export function mensajeAgente({ base = 'https://<this-site>', proyecto = null } = {}) {
  const id = proyecto?.id ?? '<project_id>';
  const lineas = [
    '## Instructions for the agent: track progress in the project roadmap',
    '',
    proyecto
      ? `These items belong to the user's project "${proyecto.name}" (id ${proyecto.id}). Do not silently drop any of them: record the status of EVERY requirement, test and accelerator listed above.`
      : 'These items are not tied to a project yet. Ask the user for their project (or create one) and record the status of EVERY requirement, test and accelerator listed above, so they know what is done and what is pending.',
    '',
    'Send the user\'s API key as `Authorization: Bearer <key>` and call:',
    '',
    '```http',
    `PUT ${base}/api/v1/projects/${id}/items`,
    'Content-Type: application/json',
    '',
    '{"items": [',
    '  {"type": "requirement", "slug": "<slug>", "status": "done"},',
    '  {"type": "test", "slug": "<slug>", "status": "planned", "note": "after the auth work"},',
    '  {"type": "accelerator", "slug": "<slug>", "status": "skipped", "note": "using our own implementation"}',
    ']}',
    '```',
    '',
    'Statuses: `done` implemented · `in_progress` working on it · `planned` pending, on the roadmap · `skipped` deliberately not doing it (add a short `note`).',
    '',
    '- At the start, mark everything you are NOT implementing right now as `planned`.',
    '- Update statuses as you finish things.',
    '- Before ending the session, tell the user what is still `planned`.',
  ];
  if (!proyecto) {
    lineas.push('',
      `To create a project first: \`POST ${base}/api/v1/projects\` with \`{"name": "<app name>"}\` and use the returned \`id\`.`);
  }
  lineas.push('',
    `Found a missing, wrong or improvable requirement, test or accelerator? \`POST ${base}/api/v1/suggestions\` with \`{"kind": "improvement", "target_type": "requirement", "target": "<slug>", "text": "…"}\`.`);
  return lineas.join('\n') + '\n';
}
