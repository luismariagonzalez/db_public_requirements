# Requirements DB

*[Read in English](README.md)*

Una base de datos pública de **requisitos de software, tests y aceleradores** para quien programa con agentes de IA.

Los agentes de IA programan bien, pero casi nunca reciben requisitos detallados ni las mejores librerías de partida. Elige lo que tu app debe cumplir (por tipo de app, audiencia, dominio o aspecto transversal como la seguridad), cada elemento con una **prioridad de 1 a 5**, y pásaselo a tu agente en Markdown o JSON. La búsqueda es híbrida: por significado (embeddings) y por palabras.

- **App en vivo:** <https://joderestatodocogido.com/proyectos/requirements-db/app/> (interfaz en inglés y español)
- **Documentación del CLI para agentes:** <https://joderestatodocogido.com/proyectos/requirements-db/app/cli.html>
- Los requisitos dicen **qué** debe hacer una app, nunca **dónde** (pantallas, botones, diseño): eso lo decide el agente.

## Úsalo desde la terminal (`reqdb`)

Un solo fichero, sin dependencias, Node 18+. Sin servidor MCP a propósito: un CLI funciona en cualquier agente y en CI.

```bash
curl -fsSL https://joderestatodocogido.com/proyectos/requirements-db/app/reqdb.mjs -o reqdb.mjs
node reqdb.mjs search "password reset" --max-priority 2
node reqdb.mjs login --key rq_xxxxxxxx          # clave de la web (Cuenta)
node reqdb.mjs init --name "Mi app" --category saas-b2b --max-priority 2
node reqdb.mjs pull -o REQUIREMENTS.md           # el documento para tu agente
node reqdb.mjs mark done auth-email-password     # tu agente anota el progreso
node reqdb.mjs check --max-priority 1            # sale con 1 mientras haya algún P1 pendiente (CI)
```

O sin descargar nada: `npx github:luismariagonzalez/db_public_requirements search "password reset"`.

Leer es anónimo y con límite de uso; los proyectos necesitan una clave de API. Códigos de salida: `0` correcto, `1` pendiente o rechazado, `2` uso, `3` clave, `4` límite de uso, `5` red.

## Úsalo por HTTP

```bash
curl "https://joderestatodocogido.com/proyectos/requirements-db/app/api/v1/requirements?category=messaging&max_priority=2&format=md"
```

- Lectura: `/api/v1/categories`, `/api/v1/requirements`, `/api/v1/tests`, `/api/v1/accelerators` (y `/:slug`), `POST /api/v1/export`. `include=tests,accelerators` los devuelve junto a los requisitos.
- Con cuenta o clave de API: `/api/v1/projects` (y `PUT /:id/items` para que el agente marque lo hecho, lo que está en curso y lo planeado), `/api/v1/suggestions`.
- Con sesión (Clerk: Google, GitHub o correo con código): `POST /api/contribute` (la revisa una IA: ¿ya está? ¿fusionar o crear?), `/api/me/keys`, `/api/me/contributions`, `DELETE /api/me`.

## Monta tu propia copia

Necesitas un Postgres con `pgvector` (Supabase), una clave de la API Gemini (embeddings y revisión) y Clerk para el inicio de sesión. Las variables, los cupos y las reglas están en [AGENTS.md](AGENTS.md).

```bash
npm install
npm run db:up && npm run db:ensayar    # Postgres local con pgvector, migraciones y comprobación del contrato
npm test                               # pruebas unitarias (CLI, idiomas, lógica)
npm run api:ensayar                    # la API real contra esa base local
npm run construir                      # genera publico/
```

La web nunca habla con la base de datos: todo pasa por una única función serverless (`api/entrada.js`) que aplica los límites de uso y llama a funciones SQL que solo puede ejecutar `service_role`.

## Licencias

- **Código:** MIT ([LICENSE](LICENSE)).
- **Contenido** (requisitos, tests, aceleradores, prioridades y aportaciones): [LICENSE-DATA.md](LICENSE-DATA.md) ([traducción de cortesía al español](LICENSE-DATA.es.md); si hay diferencias, prevalece el inglés). De uso libre para construir y probar tu propio software, comercial o no, pero **no** es open data: sin extracción masiva, espejos ni catálogos competidores. Quien aporta concede una licencia amplia al proyecto. Es un borrador: que lo revise un abogado antes de fiarte de él.
- El contenido generado de la semilla (`semilla/requisitos|tests|aceleradores/`) **no** está en este repositorio (ver `.gitignore`). Los esquemas y las migraciones sí son públicos.
- Las categorías de software siguen el directorio público de categorías de Capterra, marca de su titular; este proyecto no está afiliado a ella.

## Contribuir

Sugiere un requisito, un test o un acelerador desde la web, la API o `reqdb suggest`. Los informes de errores y las pull requests del código son bienvenidos.
