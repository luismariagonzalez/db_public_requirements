# Métricas de aceleradores (estrellas y descargas)

Cada acelerador puede llevar su popularidad: estrellas de GitHub y descargas del registro oficial
de su paquete. Se refrescan solas cada ~15 días. Las fuentes se comprobaron el 2026-11-20 leyendo su
documentación oficial y con una petición real de prueba a cada una (la última columna dice qué se vio).

## Fuentes

| Fuente | Qué se guarda | Endpoint | Límites y reglas | Comprobado |
|---|---|---|---|---|
| **GitHub** | `stars`, `forks`, `archivado`, `ultimo_commit` (= `pushed_at`, último push a cualquier rama: aproxima el último commit) | `GET https://api.github.com/repos/{dueño}/{repo}` con `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10` y `Authorization: Bearer $GITHUB_TOKEN` si hay | Sin token: **60 peticiones/hora** por IP; con token: 5 000/hora. Cabeceras `x-ratelimit-remaining/reset`. Con el cupo a 0 no se insiste (daría un baneo); un 403/429 con `retry-after` corto se espera. `User-Agent` obligatorio de hecho. | `stargazers_count`, `forks_count`, `archived`, `pushed_at` presentes |
| **npm** | `descargas_mes` (últimos 30 días disponibles) | `GET https://api.npmjs.org/downloads/point/last-month/{paquete}` (con `@scope/nombre` tal cual) | Documentado: 18 meses de rango, consultas en bloque hasta 128 paquetes pero **no con scopes**; no documenta límite de peticiones. Una petición por paquete. | `{downloads, start, end, package}`; scoped OK |
| **PyPI** | `descargas_mes` | `GET https://pypistats.org/api/packages/{paquete}/recent` → `data.last_month` | La fuente **oficial** es BigQuery (PSF/Linehaul, dataset `bigquery-public-data.pypi`), que exige credenciales de Google Cloud y consultas de pago por volumen: **no se usa**. `pypistats.org` es la fuente secundaria gratuita: se actualiza **una vez al día**, excluye espejos conocidos, límite por IP no especificado y pide **cachear y no repetir el mismo endpoint en el mismo día** (aquí se pide una vez cada 15 días). Es un proyecto comunitario, no de la PSF: puede caer o cambiar. | `data.last_month` = 712 925 236 para pandas (coincide con el orden de magnitud 705-716 M del ejemplo del encargo) |
| PyPI · pepy.tech | — (descartada) | `https://api.pepy.tech/api/v2/projects/{p}` | Su API v2 **exige API key** (401 sin ella). Daría el acumulado histórico; sin clave no es automatizable. `descargas_total` de PyPI queda vacío. | 401 |
| **crates.io** | `descargas_total` (`crate.downloads`) y `descargas_mes` (suma de los últimos 30 días de `/downloads`, que da 90 días por versión y día) | `GET https://crates.io/api/v1/crates/{n}` y `/{n}/downloads` | Política de crawlers: **`User-Agent` que identifique la aplicación** (recomendado con contacto) y **máx. 1 petición por segundo**; el cliente se espacia 1,1 s. Para volumen masivo piden usar el volcado de la base. Dos peticiones por paquete. | `crate.downloads` y `version_downloads` presentes |
| **NuGet** | `descargas_total` | `GET https://azuresearch-usnc.nuget.org/query?q=packageid:{id}&take=1` (el `SearchQueryService` del índice `https://api.nuget.org/v3/index.json`) → `totalDownloads` | API oficial y documentada; sin límite publicado. No da mensual. | `totalDownloads` presente |
| **RubyGems** | `descargas_total` | `GET https://rubygems.org/api/v1/gems/{gema}.json` → `downloads` | Unas 10 peticiones/s por IP en el balanceador; 429 con `Retry-After`. No da mensual. | `downloads` presente |
| **Packagist** | `descargas_mes` y `descargas_total` | `GET https://packagist.org/packages/{vendor}/{paquete}.json` → `package.downloads.{monthly,total}` | Caché de 12 h en su lado. Pide un `User-Agent` con contacto (`mailto=`), no más de 10 peticiones en paralelo y no lanzar crons a las horas en punto. | `downloads.total/monthly/daily` presentes |
| **Homebrew** | `descargas_mes` = **instalaciones** de 30 días (opt-out de analítica: no son descargas ni usuarios únicos) | `GET https://formulae.brew.sh/api/formula/{formula}.json` → `analytics.install["30d"]` | JSON estático en CDN; sin límite publicado. La documentación solo lista los agregados `/api/analytics/…`; el campo por fórmula se comprobó con una petición real. | `analytics.install.30d` presente |
| **Maven Central** | — | (`search.maven.org/solrsearch` da versión y fecha, **no descargas**) | Central no publica contadores de descargas. El registro `maven` se guarda para clasificar; las estrellas salen del repo de GitHub. | sin fuente |
| **Go** | — | (proxy.golang.org / index.golang.org / pkg.go.dev) | No hay API documentada de popularidad (ni descargas ni «imported by»). Igual que Maven: se guarda `go` + el repo de GitHub. | sin fuente |

Nada de esto toca páginas HTML ni hace scraping: solo APIs JSON documentadas o públicas. Los datos son
hechos numéricos públicos (no contenido protegido) y solo se guardan los contadores.

**Honestidad de los datos.** Las cifras no son comparables entre registros (npm cuenta descargas de CI y
espejos; Homebrew cuenta instalaciones; NuGet y RubyGems solo dan el acumulado). Por eso la web y el
Markdown enseñan el mensual si existe y, si no, el acumulado marcado como «total». La ordenación
`sort=popularity` usa `ln(1+estrellas) + ln(1+descargas_mes)/2` (desconocido = 0): las descargas son
órdenes de magnitud mayores que las estrellas y el logaritmo evita que dominen.

## Modelo de datos (migración `0009_metricas_aceleradores.sql`)

Columnas nuevas en `acelerador` (se descartó una tabla hija con historial: hoy solo se enseña el último
valor y una fila por acelerador evita un join en cada ficha y en la ordenación; si algún día hace falta la
evolución se añade `acelerador_metrica` sin romper nada):

`repo_url`, `stars`, `forks`, `archivado`, `ultimo_commit`, `registro` (npm, pypi, crates, nuget,
rubygems, packagist, maven, go, homebrew), `paquete`, `descargas_mes`, `descargas_total`,
`metricas_fuente` (p. ej. `github+npm`), `metricas_actualizado_en` (último refresco con algún dato),
`metricas_intentado_en` (último intento, con o sin error: es la marca de «qué falta»), `metricas_error`
(≤ 300 caracteres; no se publica por la API).

Validaciones: `repo_url` https; `registro` y `paquete` van juntos; `paquete` con el formato de su
registro (`db_public_requirements.paquete_valido`, replicado en `lib/metricas/origen.mjs`); contadores ≥ 0.
El disparador de fechas (0005) compara solo columnas de contenido: **refrescar métricas no mueve `actualizado_en`**.

Funciones (todas `security definer`, solo `service_role`): `srv_metricas_pendientes(p_limite, p_antes_de)`
(los más atrasados primero, los nunca intentados antes), `srv_metricas_resumen`, `srv_guardar_metricas`
(las claves ausentes conservan el valor; un error conserva los datos viejos y se borra en el siguiente
refresco bueno), `srv_fijar_origen`, `srv_aceleradores_origen`; y cambian `ficha_acelerador`,
`srv_relacionados` y `srv_buscar_aceleradores` (nuevo parámetro `p_orden` con valor por defecto: el
código anterior sigue funcionando).

## El proceso

- `GET|POST /api/cron/metricas[?limit=25]` (en el router único; **no** añade ninguna función a `api/`).
  Cabecera `Authorization: Bearer $CRON_SECRET`; sin `CRON_SECRET` (mín. 16 caracteres) la ruta responde 503.
- Un lote de hasta 25 aceleradores con tope de **22 s** (la función dura 30), reanudable: la base marca el
  último intento y siempre sirve primero los más atrasados. Solo toca los que llevan más de 14 días sin
  intentarse. GitHub y el registro son independientes: si uno falla se guardan los datos del otro y el
  error. Si una fuente frena por cupo se deja en paz el resto del lote y **no se marca** el intento (se
  repite en la próxima pasada). Reintentos con retroceso exponencial (400 ms, 800 ms, 1,6 s) en fallos de
  red y 5xx.
- **Planificación (`vercel.json`, `17 4 * * *`): diaria, no quincenal.** La documentación vigente de Vercel
  dice que en Hobby el cron mínimo es **una vez al día** (con ±59 min de imprecisión) y que cada pasada es
  una función de 30 s; un cron «días 1 y 15» no podría con un catálogo de cientos de aceleradores en un
  lote. Con el cron diario y la regla «solo lo que lleva más de 14 días» cada acelerador se refresca
  cada 14-15 días y la carga se reparte sola. Los días sin pendientes la pasada es una sola consulta.
- A mano: `node scripts/actualizar_metricas.mjs [--dry] [--todos] [--limite=N] [--lotes=N]` (encadena lotes
  sin el tope de 30 s; se para solo si una fuente frena y se reanuda al relanzarlo).
- Relleno inicial: `node scripts/rellenar_origen_metricas.mjs --dry` deduce `repo_url` (URL de github.com) y
  `registro`/`paquete` (URL de npmjs.com/package, pypi.org/project, crates.io/crates, nuget.org/packages,
  rubygems.org/gems, packagist.org/packages, formulae.brew.sh/formula, pkg.go.dev, central.sonatype.com/artifact)
  y lista los que no puede deducir. Sin `--dry` aplica con `srv_fijar_origen` (sin pisar lo ya fijado salvo
  `--sobrescribir`). `--desde=lista.json` lo prueba sin base.

## Qué hay que crear en Vercel

- `CRON_SECRET`: cadena aleatoria de 16+ caracteres (letras y números), en Production. Vercel la envía sola
  como `Authorization: Bearer …` al lanzar el cron; **hay que redesplegar** tras crearla o cambiarla.
- `GITHUB_TOKEN` (opcional pero muy recomendable): token personal sin permisos (solo lectura de repos públicos).
  Sin él, 60 peticiones/hora: con 25 aceleradores por pasada alcanza, pero un relleno inicial grande tardará días.
- `METRICAS_USER_AGENT` (opcional): p. ej. `reqdb-metrics/1.0 (+https://tu-web)`; crates.io y Packagist piden
  poder contactar. Por defecto es genérico (`reqdb-metrics/1.0`) y no lleva datos personales.
- Tras aplicar la migración 0009 en la base compartida, correr el relleno inicial (`rellenar_origen_metricas.mjs`).
