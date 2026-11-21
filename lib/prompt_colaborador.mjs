// El generador del prompt de colaboración vive en web/ (la web se aplana al construir y
// no puede importar de lib/); aquí se reexporta para el servidor, los scripts y los tests.
export * from '../web/prompt_colaborador.js';
