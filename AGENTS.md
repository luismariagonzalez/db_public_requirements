# db_public_requirements

Base pública de **requisitos de software** para quien hace vibe coding: se buscan o se
filtran (tipo de app, tipo de pantalla, transversales como seguridad), cada uno con una
prioridad 1-5, y se copian como Markdown o JSON para pasárselos al agente.

## Decisiones de este proyecto (escritas antes de la primera línea)

| Pregunta | Decisión |
|---|---|
| ¿Móvil como app? | No. Web responsive, sin PWA. |
| ¿Más de un idioma? | **Interfaz en inglés y español** (`web/textos-en.js` / `textos-es.js`, módulo `web/i18n.js`; las páginas estáticas llevan un bloque `.en` y otro `.es`; términos del contenido: `LICENSE-DATA.md` prevalece sobre `LICENSE-DATA.es.md`). El **contenido de la base sigue solo en inglés**: los agentes trabajan en inglés, y la IA traduce los aportes en otro idioma al revisarlos. |
| ¿Guarda datos de personas? | **Sí**: el `sub` de Clerk (autoría de aportes, dueño de API keys). Ni correo ni nombre. Hay aviso legal/privacidad (`web/legal.html`) y borrado (`DELETE /api/me`). |
| Sesión | **Opcional**: leer es libre con rate limit; aportar y tener API key exige sesión (Clerk: Google, GitHub o correo con código). |

## Lo raro de este proyecto

- **Nada se concede a `anon` ni a `authenticated`.** La web NO habla con Supabase. Todo pasa
  por `api/entrada.js` (UNA sola función de Vercel con un router propio, `lib/rutas.mjs`: el plan Hobby limita cuántas funciones caben; no añadas ficheros en `api/`, añade una ruta y un handler en `lib/handlers/`), que verifica la sesión de Clerk (`jose` + JWKS) o la API
  key, aplica el cupo, calcula embeddings con Gemini y llama a
  `public.db_public_requirements_srv_*` con la clave secreta (`service_role`). Por eso el
  ensayo prueba que `anon`/`authenticated` no pueden llamar a ninguna función.
- **Variables en Vercel:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (solo servidor),
  `GEMINI_API_KEY`, `CLERK_PUBLISHABLE_KEY` (`pk_live_…` en producción), `IP_SALT` (cadena
  aleatoria larga), opcional `CLERK_ORIGENES` (azp permitidos, separados por comas),
  `GEMINI_MODEL` (por defecto `gemini-3.8-flash`; Google retira modelos: `gemini-2.5-flash` ya da 404) / `GEMINI_EMBED_MODEL` (`gemini-embedding-001`). En `~/.secretos/home.env` esa
  clave se llama `supabase_admin_secret_key` (es la `sb_secret_…`); los scripts de semilla la
  mapean solos (`scripts/gemini_env.mjs`), pero en Vercel hay que crearla con el nombre `SUPABASE_SECRET_KEY`.
- **Dónde vive en producción:** la app se sirve desde la home, en `https://joderestatodocogido.com/proyectos/requirements-db/app/` (la home la reescribe a este proyecto de Vercel, `db-public-requirements.vercel.app`, igual que otros proyectos suyos). Por eso: (1) la web calcula su base con `new URL('./', location.href)` y TODAS las rutas de la API son relativas a ella, sin `/api/…` absolutos; (2) `PUBLIC_BASE_URL` (en Vercel: `https://joderestatodocogido.com/proyectos/requirements-db/app`) fija la URL que se le da al agente, y la API cuelga de ella (`{base}/api/v1/…`); (3) en esa URL el navegador está en `joderestatodocogido.com`, así que Clerk usa la clave de producción (`pk_live_…`) y no hace falta subdominio.
- **Cupos** (`lib/entrada.mjs`): anónimo 20/min y 300/día por IP-hash; API key 120/min y
  10 000/día; sesión 60/min y 3 000/día; aportes 10/día por persona y 200/día global; y un
  tope global de embeddings de consulta. Viven en la tabla `cupo` (serverless no tiene
  memoria compartida). Si el limitador falla, se **cierra** (503), no se deja pasar.
- **Cinco entidades**: requisitos, **tests** (cómo comprobar un requisito; relacionados con 1-8 requisitos, con su propia prioridad 1-5), **aceleradores** (librerías open source, propietarias o SaaS que ayudan a implementar requisitos; `modelo` open_source|proprietary|saas), **proyectos** (de una persona: qué requisitos/tests/aceleradores lleva hecho, en curso, planeado o descartado) y **sugerencias** (de cuenta o API key; las revisa una persona, no la IA).
- **Proyectos y agente:** vale sesión de Clerk **o API key** (el agente trabaja con la key; `ident.owner` es siempre el dueño). Pedir requisitos con `include=tests,accelerators` y `project=<id>` anota el estado de cada cosa; `hide=done` oculta lo ya hecho. Todo Markdown/JSON de requisitos termina con **el mensaje al agente** (`lib/mensaje_agente.mjs`): que registre en el proyecto, con `PUT /api/v1/projects/:id/items`, lo hecho y lo pendiente o en roadmap. Cambiar ese texto es cambiar el contrato con los agentes.
- **Jerarquía de categorías** (migración 0003): `audience` (b2b, b2c, b2b2c, b2g, internal, developer) → `domain` (marketing, finanzas, sanidad…) → hojas (`software_category` de Capterra, `app_type`, `screen_type`, `cross_cutting`). Una hoja cuelga de UN dominio y sirve a varias audiencias. Los requisitos cuelgan de las HOJAS; la API expande una audiencia o un dominio pedidos como `category=` a sus hojas (`lib/categorias.mjs`; audiencia + dominio = Y; un conjunto vacío nunca significa «sin filtro»). En la web, audiencia y dominio solo acotan la lista; se busca por las hojas elegidas.
- **Modelo de filtros (migraciones 0004 y 0005):**
  - **Qué construyes (O):** tipo de app (`app_type`, 29: los 16 originales más CRM, helpdesk, ERP…, y `other-business-software` como comodín) o categoría de software (`software_category`: dominio → categoría). Una categoría de software **hereda** de 1-3 arquetipos (`categoria.arquetipos`): pedirla, o pedir su dominio o audiencia, incluye también a esos arquetipos (`lib/categorias.mjs`). Los tipos de app ya no cuelgan de ningún dominio.
  - **Además (O):** temas transversales (`cross_cutting`) y **flujos** (`screen_type`, que se muestra como «flow», con `familia`: account, discover, buy, manage, attract). El acceso se parte en `flow-sign-up`, `flow-sign-in` y `flow-recovery`; `screen-auth` sigue valiendo como alias.
  - **Clase (Y):** solo `functional` (algo que una persona hace o nota) o `technical` (cómo se construye y se opera). El TEMA (seguridad, privacidad…) vive solo en los transversales.
  - **Orden (`sort`):** `priority` (por defecto sin texto), `copies` (más copiados) o `relevance` (por defecto con texto).
  - **Copias:** `requisito.copias` es un contador global. Cuenta una vez por persona, requisito y día (`copia`, con hash opaco, purgada a los 2 días) al pedir `format=md` o al llamar a `POST /api/v1/copied` (lo que hace el botón Copiar). `POST /export` NO cuenta: la vista previa lo llama sin parar.
  - **Fechas:** `creado_en` y `actualizado_en` de requisitos, tests y aceleradores se mantienen solos con disparadores (cambia el contenido o una prioridad, no el contador). Solo se guardan: la API no las filtra ni las ordena (reservado para una función futura).
  - **Reorganizar datos:** `node scripts/reorganizar.mjs` (Gemini; genera `semilla/reorganizacion.json` para revisar, reanudable) y `--aplicar` (llama a `srv_reorganizar`, que no toca las fechas).
- **Categorías de Capterra:** los nombres de las 1.024 categorías salen del directorio público de capterra.es (solo la lista de categorías; sin descripciones ni contenido suyo) y se clasifican con Gemini. Se regeneran con: `curl` con cabeceras de navegador a `https://www.capterra.es/directory` (WebFetch da 403) → `semilla/capterra_bruto.json` (`[{id, slug, name}]`) → `node scripts/importar_capterra.mjs`. Capterra es una marca de su titular; no implica relación con ella. Casi todas esas categorías aún no tienen requisitos propios: se generan por tandas (`generar_semilla.mjs --solo=<slug>`).
- **Licencias:** código MIT (`LICENSE`); contenido bajo `LICENSE-DATA.md` (uso libre para software propio, sin extracción masiva ni catálogos competidores; los aportes ceden licencia amplia al proyecto). `scripts/construir.mjs` publica ese documento como `terms.html`: se edita SOLO `LICENSE-DATA.md`. La semilla generada está en `.gitignore`: no la subas a un repo público. Si cambias los términos, sube la versión en el propio documento y revisa `web/legal.html`.
- **Revisión de aportes (requisitos, tests y aceleradores).** `POST /api/contribute` acepta `type: requirement|test|accelerator` (por defecto `requirement`; campos: requisito `text`+`categories`; test `title`, `scenario`, `test_type`, `priority`, `requirements` (slugs); acelerador `name`, `url`, `description`, `model`, `cost`, `platforms`, `requirements` (slugs o `{slug, coverage}`); siempre `accept_terms`). Mismo cupo (10/día por persona, 200 globales) y tamaños de columna. `GET /api/me/contributions` lista todos los tipos (`type`, `status`, `verdict`, y el `requirement`/`test`/`accelerator` creado o fusionado). Flujo (`lib/revisar.mjs` para requisitos, `lib/revision.mjs` para tests y aceleradores; mismo patrón): (0) comprobaciones sin IA: forma, URL del acelerador (https, sin IP privada/localhost/credenciales/puerto raro, sin parámetros de afiliado) y que los requisitos enlazados existan; (1) análisis con Gemini (política + normalizar a inglés + riesgo + inyección); el CÓDIGO decide (`lib/revision_reglas.mjs`): rechazo del modelo → `rejected`, riesgo alto → `rejected` aunque el modelo diga accept, riesgo medio / inyección (del modelo o detectada a mano) / confianza < 0.6 → `needs_human`; (2) solo si se acepta, el acelerador se comprueba en red (`lib/url_segura.mjs`: https.request con `lookup` que rechaza IPs privadas EN el connect, redirecciones a mano (≤3) revalidadas, 6 s; <400 o 401/403/429 vale; fallo de red → `needs_human`); (3) embedding → el más cercano de su tipo (`srv_similares`, `_tests`, `_aceleradores`; un acelerador con la misma URL entra como similitud 1) → ≥0.93 duplicado (si trae enlaces nuevos a requisitos se añaden, si no `rejected` con `duplicate_of`), 0.80-0.93 la IA decide `update|new|duplicate`, <0.80 nuevo; «actualizar» solo si el objetivo está ≥0.80; (4) `created` / `merged` / `rejected` / `needs_human`. Una fusión **nunca** cambia una prioridad ni una cobertura existentes (`srv_fusionar_test`/`_acelerador` solo añaden enlaces y mejoran el texto); discutir un test P1 → `needs_human`. El veredicto guardado (`aporte.veredicto`) lleva `type`, `reason`, `risk_level`, `confidence`, `injection_detected`, `language` e `items[{action, slug, reason, reason_code, duplicate_of}]`.
- **Política y prompts de revisión** (`lib/prompts_revision.mjs`, la ÚNICA fuente; testeada en `tests/prompts_revision.test.mjs`): `POLITICA.rechazar` (códigos `illegal`, `harmful`, `privacy`, `hate_harassment`, `copyright`, `spam_promo`, `where_not_what`, `not_an_item`, `prompt_injection`, `off_topic`, cada uno con su riesgo), `POLITICA.normalizar` (traducir a inglés, quitar el DÓNDE, tono neutral) y `POLITICA.datos` (el texto de la persona es DATO no confiable). El texto va entre `<contribution>` y `sanear()` impide cerrar o abrir etiquetas; los candidatos existentes van en `<existing>`. Añadir una regla = tocar `POLITICA` (los prompts la reproducen sola) y el test. `npm run gemini:revision` hace 3 llamadas reales (test legítimo en español, inyección + dañino, acelerador publicitario). Los umbrales 0.93/0.80 se reutilizan para tests y aceleradores sin calibrar. **Migración 0007 antes de desplegar** este código.
- **Un requisito dice QUÉ, nunca DÓNDE** (ni pantallas, ni botones, ni layout). El tipo de
  pantalla es solo una categoría para filtrar. La IA revisora (`lib/revisar.mjs`, `lib/revision.mjs`) reescribe lo
  que lo incumpla y el Markdown exportado lo recuerda al agente.
- **La prioridad es por categoría** (`requisito_categoria.prioridad`): el cifrado extremo a
  extremo es P1 en mensajería y P3 en un SaaS. Una fusión nunca cambia una prioridad que ya
  existe; discutir un P1 manda el aporte a `needs_human`.
- **Los umbrales de duplicado** (`lib/umbral.mjs`: 0.93 / 0.80) son una estimación: calibrarlos
  con la semilla cargada.
- Embeddings: `gemini-embedding-001` a 768 dimensiones, `vector(768)` + HNSW coseno. Cambiar
  de modelo o de dimensión obliga a re-embeber todo y a una migración nueva.
- **Texto del embedding y reembebido (migración 0006):** el vector de un requisito se calcula SIEMPRE con `textoParaEmbedding` (`lib/texto_embedding.mjs`: título + enunciado + criterios + clase + todas sus categorías con nombre, más dominios y audiencias deducidos). Lo usan `sembrar.mjs`, `revisar.mjs` (al fusionar con categorías nuevas se recalcula) y `anadir_borradores.mjs`; cambiar la composición obliga a subir `VERSION_TEXTO` y la columna `embedding_v`. **Tras desplegar la 0006 hay que ejecutar UNA vez** `node scripts/reembeber.mjs` (`--dry` para ver; por lotes, reanudable; usa `srv_requisitos_para_embeber` / `srv_guardar_embedding`) y después `node scripts/mapa_calcular.mjs --refit`.
- **Mapa 2D (`web/mapa.html` + `mapa.js` + `mapa_logica.js`, `GET /api/v1/map`):** proyección PCA determinista (`lib/proyeccion.mjs`, iteración de subespacio; JS puro). El modelo (media, ejes, escala) se guarda en `mapa_modelo` y las coordenadas en `mapa_requisito`, calculadas por `scripts/mapa_calcular.mjs` (sin flags: solo los requisitos nuevos, sin mover los demás; `--refit`: reajusta alineando ejes con los anteriores; `--dry`). La ruta lee `srv_mapa()`, pasa por el cupo de lectura y se cachea (`s-maxage=1800`). Sin 3 puntos con coordenadas la pantalla muestra un estado vacío. La portada lee `?q=` (enlace «abrir en la app»). Ensayo sin Gemini: `scripts/embedding_simulado.mjs`.
- Datos y texto de la base son **no confiables**: la web pinta con `textContent`, nunca
  `innerHTML` (la CSP ya prohíbe scripts en línea).

## El CLI

`cli/reqdb.mjs` (un fichero, sin dependencias, sin MCP a propósito) se publica como `/reqdb.mjs` y se documenta en `web/cli.html` (EN/ES). Usa solo la API pública: si cambias un contrato de la API, cambia el CLI y `tests/cli.test.mjs`. Códigos de salida: 0 ok, 1 pendiente/rechazado, 2 uso, 3 clave, 4 cupo, 5 red.

## Cómo se trabaja

```bash
npm run db:up && npm run db:ensayar    # base local con pgvector + contrato + supabase/ensayo.sql
npm run api:ensayar                    # la API real contra esa base local (Supabase falso delante), sin Gemini ni Clerk
npm test                               # lógica pura y revisión con Gemini/base simulados
npm run gemini:ensayar                # Gemini REAL contra la base local: semilla, búsqueda semántica, revisión de aportes (gasta unas llamadas)
npm run semilla:generar                # genera semilla/requisitos/*.json con Gemini (para REVISAR)
npm run semilla:generar-extras         # tests y aceleradores de esos requisitos (REVISAR sobre todo las URLs)
node scripts/sembrar.mjs --dry         # qué cargaría; sin --dry carga con embeddings
vercel dev                             # web + api en local (necesita las variables de arriba)
```

---

# Plantilla de la casa (reglas generales)

# Instrucciones para el agente

Estás empezando un proyecto que va a colgar de la home de Luis María González.
Esta carpeta es la plantilla: cópiala, renómbrala y sigue esto.

**La regla de fondo:** un proyecto nuevo no debe obligar a tocar la home ni a
ninguno de los otros proyectos. Todo lo que sigue existe para eso.

La implementación de referencia es el repositorio `emociones`. Si algo aquí no
se entiende, mira cómo está hecho allí.

---

## Lo primero, en este orden

```bash
cp -r _plantilla-proyecto ../mi-proyecto && cd ../mi-proyecto
node iniciar.mjs mi-proyecto        # renombra db_public_requirements en todos los ficheros
git init -b main
git add -A && git commit -m "Primer commit desde la plantilla"
```

`iniciar.mjs` se borra solo al terminar. Comprueba el `git status` antes del
primer commit: **`.env` no puede aparecer**. Si aparece, algo has roto en el
`.gitignore` y no sigas.

### La rama se llama `main`

En toda la casa, y sin excepciones. Si te encuentras un repositorio con
`master`, se renombra:

```bash
git branch -m master main
```

No es una preferencia: es lo que dan por hecho GitHub al crear el repositorio y
Vercel al elegir qué desplegar. Con las dos convenciones mezcladas, el día que
alguien despliegue va a desplegar la rama equivocada. Ramas de trabajo las que
quieras, con el nombre que quieras; **lo que se despliega es `main`**.

---

## La forma de la casa

| Pieza | Cuántas hay |
|---|---|
| Repositorio de GitHub | **uno por proyecto**, personal (no de organización) |
| Proyecto de Vercel | **uno por proyecto** |
| Proyecto de Supabase | **uno, compartido por todos** |
| Esquema de la base | **uno por proyecto**, se llama como el proyecto |

Vercel Hobby aguanta 200 proyectos y 100 despliegues al día: no es el cuello de
botella. Sí lo son dos cosas: **no puede conectarse a repos de una organización
de GitHub** (tienen que ser personales) y es de uso no comercial.

Un proyecto ya desplegado en otro sitio entra en la home **como enlace** y no
necesita nada de esto: solo su fila en `comun.proyecto`.

---

## Los secretos: no los copies

Esto es importante porque es el error que ya se cometió una vez.

Los secretos compartidos —Supabase, Vercel, GitHub, Cloudflare— viven **en un
solo sitio del disco**: `~/.secretos/home.env`, fuera de OneDrive. Todos los
proyectos lo leen con `scripts/entorno.mjs`. Rotar una clave es cambiarla ahí.

**No copies esos valores al `.env` del proyecto.** El `.env` local es solo para
lo que sea de este proyecto y de ningún otro. Si no tiene nada propio, no hace
falta que exista.

Tres cosas que cuestan una tarde si no se saben:

- **Los valores con `#` van entre comillas.** Sin ellas, el lector de entorno
  corta la línea en la almohadilla y te deja media contraseña. El error que sale
  es «password authentication failed», que parece otra cosa completamente.
- **La clave `sb_secret_…` se salta el RLS entero.** Nunca en el navegador.
  `scripts/construir.mjs` se planta si la detecta donde va la publicable.
- **`.env` en `.gitignore` desde el primer commit.** Un `git add -A` con un
  `.env` sin ignorar mete el secreto en el historial, y de ahí no sale con un
  `rm`: hay que rotar la clave y reescribir el historial.

---

## La base de datos

El esquema se llama como el proyecto. Dentro, las tablas se llaman como quieras:
nadie más las ve.

1. **Nunca crees tablas en `public`.** Es el vestíbulo compartido: solo lleva las
   funciones que expone cada proyecto, y lo común.
2. **Nunca leas el esquema de otro proyecto.** Si dos lo necesitan, ese dato es
   común y va en `comun`, que es del repo de la home.
3. **No expongas el esquema en la API** (no lo añadas a «Exposed schemas»).
4. **RLS activo en todas las tablas y sin políticas.** Cinturón, por si algún día
   alguien expone el esquema por error.
5. **La única puerta son funciones `public.<proyecto>_<verbo>()`**, con
   `security definer`, `set search_path = ''` y `grant execute` explícito a
   `anon` y/o `authenticated`. El prefijo evita choques entre proyectos.

Está todo esqueletado en `supabase/migraciones/0001_db_public_requirements.sql`.

### Migraciones

Numeradas, en `supabase/migraciones/`, y **nunca se edita una ya aplicada**: se
añade la siguiente. El registro está en `<proyecto>.migracion_aplicada` con la
huella del fichero, así que si alguien edita una aplicada, el script lo dice.

```bash
npm run db:migrar          # dice qué falta, no escribe
npm run db:migrar:aplicar  # la aplica, cada una en su transacción
```

**Ensaya antes de tocar la base compartida.** Es una base con otros proyectos
dentro. Una migración sin ensayar no se aplica:

```bash
npm run db:up        # Postgres local en Docker (127.0.0.1:5433)
npm run db:ensayar   # aplica las migraciones y comprueba el contrato
```

`scripts/ensayar.mjs` comprueba solo las reglas de arriba: nada en `public`,
RLS en todas las tablas, `anon` y `authenticated` sin acceso a tablas ni al
esquema, y funciones `security definer` con `search_path` y **sin `EXECUTE`
para `PUBLIC`**. Después corre `supabase/ensayo.sql`, que son **tus** pruebas:
llamar a cada función como `anon` y como usuario con sesión, comprobar que lo de
una persona no lo ve otra y que el cupo para. Va en una transacción que se
deshace, así que puedes escribir lo que quieras. El CI corre lo mismo.

> **El agujero de los permisos.** Postgres da `EXECUTE` a `PUBLIC` en cada
> función nueva, y Supabase además a `anon` y `authenticated`. Un `grant … to
> authenticated` sin un `revoke all … from public, anon, authenticated` antes
> **no cierra nada**: `anon` sigue entrando. La migración de ejemplo lo hace
> bien; el ensayo falla si se te olvida.

---

## Sesión: decide y déjalo escrito

Los usuarios son los mismos para todos (`auth.users`), pero **cada proyecto
decide si los necesita**:

- **Sin cuenta** — las funciones se conceden a `anon`.
- **Opcional** — se conceden a `anon` y `authenticated`, y la función mira
  `auth.jwt()->>'sub'` para saber si guarda algo o no.
- **Obligatoria** — solo a `authenticated`, y la función empieza por
  `if auth.jwt()->>'sub' is null then raise exception '...' end if;`.

Ponlo en la fila de `comun.proyecto` (`sesion`) para que la home sepa si pintar
un candado.

**Quién hace el login: Clerk** (la app «Laberinto» de la cuenta de Clerk; Google
ya está configurado en su producción, dominio `joderestatodocogido.com`). La
Supabase compartida acepta sus tokens (*Third-Party Auth → Clerk*) y el usuario
es el `sub` del token (`user_…`, **texto**, no uuid): úsalo en las funciones
mediante `auth.jwt()->>'sub'` (WeWin lo envuelve en `wewin.yo()`, que además
exige el emisor de Clerk) y **no** referencies `auth.users` con claves foráneas.
Las apps nativas añaden su redirección en Clerk → Native applications.

> Guardar identidad es fácil y quitarla después no lo es. Si el proyecto va de
> algo íntimo, plantéate no guardarla: `emociones` no guarda ninguna —ni
> usuario, ni correo— y el historial se queda en el navegador de quien lo
> siente. Es una decisión suya, no la norma; pero tómala a conciencia.

---

## Front: habla con RPC, no con tablas

```js
const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/db_public_requirements_algo`, {
  method: 'POST',
  headers: { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`,
             'Content-Type': 'application/json' },
  body: JSON.stringify({ p_lo_que_sea: 1 }),
});
```

`fetch` basta y no añade 40 KB. Mete el cliente de Supabase cuando necesites
login o realtime, no antes.

Dos costumbres que han salido bien:

- **Cachea en `localStorage` y ten un plan B.** Que la app arranque sin red, y
  que se pueda desarrollar sin credenciales. Envuelve **todo** acceso a
  `localStorage` en `try/catch`: en ventana privada revienta.
- **Pide de una vez lo que necesitas de una vez.** Una llamada gorda al arrancar
  suele batir a veinte pequeñas por el camino.

---

## Decisiones de calidad

Lo de arriba es la forma de la casa. Esto es lo que separa un proyecto que
funciona de uno que aguanta: tests, seguridad, móvil, idiomas y privacidad.
Está pensado para proyectos personales en Vercel Hobby, no para una empresa:
**lo mínimo que de verdad protege**, sin ceremonia.

### Tres preguntas antes de la primera línea

Contéstalas y escríbelas al principio del `AGENTS.md` del proyecto. Cambiar
de opinión después se puede, pero cuesta mucho más que decidirlo ahora.

| Pregunta | Si la respuesta es sí |
|---|---|
| **¿Se va a usar desde el móvil como una app?** | PWA desde el principio (abajo) |
| **¿Va a estar en más de un idioma?** | Textos fuera del código desde el primer commit (abajo) |
| **¿Guarda datos de personas?** (cuentas, correos, lo que escriben) | Sesión pensada, aviso legal y política de privacidad (abajo) |

### Tests: proporcionales, pero que existan

Por orden de lo que más duele romper:

1. **La base** — `supabase/ensayo.sql`, que corre `npm run db:ensayar`. Cada
   función pública probada como `anon` y como usuario con sesión, y que lo de
   una persona no lo ve otra. Es lo primero porque la base es compartida: un
   fallo aquí no rompe tu proyecto, rompe la casa.
2. **La lógica** — `npm test` (`node:test`, sin dependencias). Un
   `tests/<módulo>.test.mjs` por cada módulo de `web/` con reglas: cálculos,
   filtros, validaciones, lo que transforma datos. La interfaz no se prueba
   aquí. Para que se pueda probar, la lógica va en módulos sin `document` ni
   `fetch` dentro.
3. **De punta a punta, si hay flujos** — si el proyecto tiene login, formularios
   o pasos (no si es una página que se mira), una prueba de humo con Playwright
   que abra la página, haga el camino principal y mire que no hay errores en la
   consola. `@axe-core/playwright` en esa misma prueba mira la accesibilidad.

Lo que **no** hace falta: perseguir un porcentaje de cobertura, ni probar que
el HTML tiene tal clase. Un test que se rompe cada vez que cambias el diseño se
acaba borrando.

### Seguridad

- **Dependencias.** `.github/dependabot.yml` abre un PR semanal con las
  actualizaciones, y `npm run auditar` (en el CI, también cada lunes) falla si
  hay una vulnerabilidad alta o crítica. En el repo de GitHub: *Settings → Code
  security* → activar *Dependabot alerts*, *Dependabot security updates*,
  *Secret scanning* y *Push protection*. La última es la que de verdad importa:
  GitHub **rechaza el push** que lleva una clave, antes de que entre en el
  historial.
- **Menos dependencias, menos superficie.** Antes de un `npm install`, piensa
  si hace falta. Cada paquete es código de otro que se ejecuta en tu web.
- **Cabeceras.** `vercel.json` trae una **CSP** estricta: solo scripts propios
  y en ficheros (`web/app.js`), nada en línea ni `onclick=`. Es lo que convierte
  un XSS en un error en la consola. Si añades un servicio externo, ábrele
  **solo** su dominio en la directiva que toque:
  - Google Fonts: `style-src … https://fonts.googleapis.com` y
    `font-src … https://fonts.gstatic.com`. Mejor aún: descarga la fuente y
    sírvela tú.
  - Clerk: su dominio de *Frontend API* (`https://clerk.joderestatodocogido.com`)
    en `script-src` y `connect-src`, `https://img.clerk.com` en `img-src`,
    `https://challenges.cloudflare.com` en `frame-src`, y `worker-src 'self'
    blob:`.
  - Cámara o micrófono (el swing, por ejemplo): cámbialo en `Permissions-Policy`
    de `()` a `(self)`.

  Prueba la CSP en una preview de Vercel, con la consola abierta: lo que bloquea
  sale ahí como «Refused to …».
- **Las funciones públicas son una API abierta.** La clave publicable va en la
  web, a la vista: cualquiera puede llamar a tus funciones en bucle. Toda
  función que escribe lleva **un cupo** (el ejemplo de la migración: tantas
  filas por minuto) y **límites de tamaño** en lo que recibe. Si algo se abusa
  de verdad, el *Firewall* de Vercel limita por IP.
- **Supabase avisa.** El panel (*Advisors → Security*) o la herramienta
  `get_advisors` de Supabase señalan funciones sin `search_path`, tablas sin RLS
  y similares, de **todos** los proyectos. Mírala al acabar cada migración.
- **El servidor de desarrollo** (`npm run dev`) sirve el repo en crudo; por eso
  solo escucha en `127.0.0.1` y no da ficheros ocultos. No lo cambies.

### Móvil: PWA primero, tienda solo si hace falta

- **Siempre**: diseño para móvil primero, `viewport-fit=cover` (ya está en el
  HTML), objetivos táctiles de 44 px como mínimo y nada que dependa de pasar el
  ratón por encima.
- **Si se va a usar como app**: PWA. Un `web/manifest.json` (nombre, iconos de
  192 y 512 px, `display: standalone`) enlazado con `<link rel="manifest">`, y
  un *service worker* que guarde la aplicación para abrirla sin red (encaja con
  lo de cachear en `localStorage` de más abajo). Se instala desde el navegador y
  se actualiza sola con cada despliegue. Para la mayoría de proyectos, basta.
- **Si de verdad hace falta tienda** (notificaciones en iOS antiguos, sensores,
  estar en Google Play): **Capacitor**, que envuelve esta misma web en una app
  nativa sin reescribirla. React Native o Flutter son reescribir el proyecto:
  solo si la web no puede hacer lo que se necesita. Clerk ya admite apps
  nativas (§ Sesión).
- Las apps de Android **propias** (las que no son una web, como la del
  asistente) siguen otra convención: `android/<nombre>/`, compiladas en Docker,
  fuera de OneDrive.

### Idiomas: o desde el principio o nunca

Si el proyecto va a estar en más de un idioma:

- **Ni un texto escrito en el código.** Todos en `web/textos/es.json`,
  `en.json`…, con claves por pantalla (`"portada.titulo"`). Una función `t()`
  de diez líneas basta; no metas una librería de i18n hasta que haga falta.
- **El idioma en la URL** (`/en/…`) o en la elección guardada de quien visita,
  nunca adivinado solo por la IP. Por defecto, el del navegador
  (`navigator.language`).
- `lang` en el `<html>` cambia con el idioma (lectores de pantalla y
  buscadores lo usan).
- **Fechas, números y monedas con `Intl`** (`Intl.DateTimeFormat`,
  `Intl.NumberFormat`), nunca formateados a mano.
- Los **datos** de la base que se traducen van en una columna `jsonb` por
  campo (`{"es": "…", "en": "…"}`) y la función devuelve el idioma que se le
  pide.

Si no va a estar en más de un idioma, no hagas nada de esto: es trabajo que no
se usa. Pero escríbelo en el `AGENTS.md`, para que la decisión quede tomada.

### Privacidad (RGPD)

Si el proyecto guarda datos de personas:

- **Guarda lo mínimo.** Lo que no se guarda no se puede filtrar (§ Sesión).
- **Aviso legal y política de privacidad**, enlazados en el pie: quién eres,
  qué se guarda, para qué, cuánto tiempo y cómo pedir que se borre. Es
  obligatorio en España (RGPD y LSSI) en cuanto se recoge algo.
- **Sin cookies de seguimiento, sin banner.** Para saber cuánta gente entra,
  *Vercel Web Analytics*, que no usa cookies. Google Analytics o similares
  obligan al banner de consentimiento.
- **Que se pueda borrar.** Una función `db_public_requirements_borrar_mis_datos()` si hay
  cuentas.

### Errores en producción

Vercel guarda los registros de las funciones, pero no ve lo que falla en el
navegador. En proyectos con usuarios de verdad, una captura mínima de errores
(`window.addEventListener('error', …)` que llame a una función
`db_public_requirements_error()` con cupo) o Sentry en su plan gratuito. En una página que
solo se mira, no hace falta.

### Copias de seguridad

El plan gratuito de Supabase no restaura a un momento concreto. La copia de
**toda** la base compartida es cosa de la casa, no de cada proyecto: un
`pg_dump` semanal al NAS, que guarda la última copia y otra de hace un mes.
Si borras algo sin querer, puedes volver como mucho a una semana atrás.
Más allá de eso, solo a hace un mes. Tu parte: que nada importante viva **solo** en la
base (el código, los datos semilla y las migraciones están en el repo).

---

## Despliegue

**No hay pipeline de despliegue que escribir: lo hace Vercel.** Al conectar el
proyecto con el repositorio, cada push a `main` publica en producción y cada
rama o PR levanta su propia URL de preview. No hace falta GitHub Actions para
eso, ni un token de Vercel guardado en el repositorio, ni un `deploy.yml`.

Lo que sí hay en Actions (`.github/workflows/verificar.yml`) son **las
comprobaciones**: lo que Vercel no sabe mirar. Que los datos sean coherentes,
que las migraciones apliquen contra un Postgres de verdad, que en lo que se
publica no se haya colado un secreto.

> **Un fallo de las comprobaciones NO impide que Vercel publique.** Sale en rojo
> en el commit y ya. Para un sitio estático con reversión en un clic suele ser
> el equilibrio correcto: te enteras enseguida y vuelves atrás sin drama.
>
> Si quieres que sí lo impida, hay dos caminos. El barato: en el proyecto de
> Vercel, *Ignored Build Step*, un comando que consulte el estado del commit en
> GitHub y salga con 1 si está en rojo. El completo: apagar el despliegue
> automático y publicar desde Actions con `vercel deploy --prod`, lo que obliga a
> guardar un token de Vercel en los secretos del repositorio y a rehacer las
> previews a mano. No lo hagas «por si acaso»: hazlo cuando algo se te haya roto
> en producción y te haya dolido.

Y un detalle que cuesta una tarde: **no lances despliegues por la API si la
integración de Git está activa.** Salen dos por commit y en Hobby, que solo
compila uno a la vez, el segundo queda en `BLOCKED`. Con `git push` basta.

`vercel.json` ya viene hecho. Dos cosas que no se tocan:

- `outputDirectory` apunta a una **carpeta construida, nunca a la raíz del
  repo**. Si publicas la raíz, publicas los scripts, el SQL y los datos en
  crudo. La lista de lo que se copia es blanca: lo que no esté, no sale.
- El `buildCommand` es donde se escribe la config del navegador a partir de las
  variables de entorno del proyecto de Vercel.

Variables en Vercel, con estos nombres exactos: `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`. La secreta solo si hay funciones de servidor.

---

## Entrar en la home

Un `insert` y ya. Es lo único que se toca fuera de este repo:

```sql
insert into comun.proyecto (id, titulo, resumen, url, sesion, orden)
values ('db_public_requirements', 'Título', 'Una línea de qué es.',
        'https://db_public_requirements.vercel.app', 'sin_cuenta', 50);
```

Despliegue propio antes que subcarpeta: cada proyecto cae por su cuenta sin llevarse la
home por delante.

---

## Antes de dar nada por terminado

- [ ] `git status` limpio y **sin `.env`**
- [ ] Las tres decisiones (móvil, idiomas, datos personales) escritas en el
      `AGENTS.md` del proyecto
- [ ] `npm run db:ensayar` limpio, con `supabase/ensayo.sql` probando **tus**
      funciones (no solo las del ejemplo)
- [ ] `npm test` en verde, con tests de la lógica que tenga reglas
- [ ] `npm run auditar` sin vulnerabilidades graves
- [ ] La página abre sin errores de CSP en la consola, en una preview de Vercel
- [ ] El build local funciona y `publico/` no lleva nada que no deba salir
- [ ] En GitHub: *Dependabot alerts*, *Secret scanning* y *Push protection*
      activados
- [ ] Si guarda datos de personas: aviso legal y política de privacidad
- [ ] La fila en `comun.proyecto`
- [ ] Un `AGENTS.md` propio con lo que este proyecto tenga de raro

---

## Cosas que ya han mordido

- **Firma los commits con la cuenta dueña del repositorio.** Si tu identidad de
  git apunta a otra cuenta de GitHub —muy fácil si usas una para el trabajo y
  otra para lo tuyo—, Vercel bloquea el despliegue: estado `BLOCKED` y **ni un
  mensaje de error**. Se pone por repositorio, nunca global:

  ```bash
  git config user.email "<id>+<usuario>@users.noreply.github.com"
  ```

  El id sale de `https://api.github.com/users/<usuario>`. Usa el `noreply` y no
  tu correo real: apunta a la cuenta correcta sin publicar una dirección.
- **`localhost` no siempre es `127.0.0.1`.** Node resuelve `::1` primero y el
  reenvío IPv6 de Docker corta la conexión con un `ECONNRESET` que no explica
  nada. En las cadenas de conexión, IPv4 explícita.
- **Supabase ya no publica `db.<ref>.supabase.co`.** Se conecta por el pooler:
  `aws-1-<region>.pooler.supabase.com`, usuario `postgres.<ref>`. Si el error
  dice *tenant or user not found*, la región está mal; si dice *password
  authentication failed*, la región está bien.
- **El pooler presenta un certificado que no está en el almacén del sistema.** O
  descargas el CA del panel (`SUPABASE_CA`) o conectas sin verificar, que vale
  para sembrar desde tu máquina y no vale para nada desatendido.
