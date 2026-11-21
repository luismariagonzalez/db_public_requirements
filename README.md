# Requirements DB

*[Leer en español](README.es.md)*

A public database of **software requirements, tests and accelerators** for people who build with AI coding agents.

AI agents write code well, but they rarely get detailed requirements or the best libraries to start from. Pick what your app must do (by type of app, audience, domain or cross-cutting concern such as security), each item with a **priority from 1 to 5**, and hand it to your agent as Markdown or JSON. Search is hybrid: by meaning (embeddings) and by keywords.

- **Live app:** <https://joderestatodocogido.com/proyectos/requirements-db/app/> (English and Spanish interface)
- **CLI docs for agents:** <https://joderestatodocogido.com/proyectos/requirements-db/app/cli.html>
- Requirements say **what** an app must do, never **where** (screens, buttons, layout): that is the agent's decision.

## Use it from the terminal (`reqdb`)

One file, no dependencies, Node 18+. No MCP server on purpose: a CLI works in any agent and in CI.

```bash
curl -fsSL https://joderestatodocogido.com/proyectos/requirements-db/app/reqdb.mjs -o reqdb.mjs
node reqdb.mjs search "password reset" --max-priority 2
node reqdb.mjs login --key rq_xxxxxxxx          # key from the website (Account)
node reqdb.mjs init --name "My app" --category saas-b2b --max-priority 2
node reqdb.mjs pull -o REQUIREMENTS.md           # the brief for your agent
node reqdb.mjs mark done auth-email-password     # your agent records progress
node reqdb.mjs check --max-priority 1            # exit 1 while any P1 is pending (CI)
```

Or with no download: `npx github:luismariagonzalez/db_public_requirements search "password reset"`.

Reading is anonymous and rate limited; projects need an API key. Exit codes: `0` ok, `1` pending/refused, `2` usage, `3` key, `4` rate limited, `5` network.

## Use it over HTTP

```bash
curl "https://joderestatodocogido.com/proyectos/requirements-db/app/api/v1/requirements?category=messaging&max_priority=2&format=md"
```

- Read: `/api/v1/categories`, `/api/v1/requirements`, `/api/v1/tests`, `/api/v1/accelerators` (and `/:slug`), `POST /api/v1/export`. `include=tests,accelerators` returns them with the requirements.
- With an account or API key: `/api/v1/projects` (and `PUT /:id/items` so the agent marks what is done, in progress or planned), `/api/v1/suggestions`.
- With a session (Clerk: Google, GitHub or email with a code): `POST /api/contribute` (an AI reviews it: is it already there? merge or create), `/api/me/keys`, `/api/me/contributions`, `DELETE /api/me`.

## Requirements by country (regulation)

A requirement exists once and is tied to the jurisdictions where it applies (ISO country codes, `EU`, regions), each with its own short note and official source. Add `country=ES` (comma separated) to `GET /api/v1/requirements`, `GET /api/v1/requirements/:slug` or `POST /api/v1/export` (`country` in the body), or `--country ES` in the CLI: you get only what applies there, with that country's note and source and no other country's. Generic requirements stay unless you add `country_only=1`. `GET /api/v1/jurisdictions` lists the available ones (today: `ES` and `EU`; regulated online gambling in Spain is the first set).

> **Informational guidance, not legal advice. Always verify the current text of each cited norm in the official source.**

## Run your own copy

Needs a Postgres with `pgvector` (Supabase), a Gemini API key (embeddings and review), and Clerk for sign-in. See [AGENTS.md](AGENTS.md) for the variables, quotas and house rules.

```bash
npm install
npm run db:up && npm run db:ensayar    # local Postgres + pgvector, migrations and contract checks
npm test                               # unit tests (CLI, i18n, logic)
npm run api:ensayar                    # the real API against that local database
npm run construir                      # builds publico/
```

The web app never talks to the database: everything goes through one serverless function (`api/entrada.js`) that applies rate limits and calls `service_role`-only SQL functions.

## Licences

- **Code:** MIT ([LICENSE](LICENSE)).
- **Content** (requirements, tests, accelerators, priorities and contributions): [LICENSE-DATA.md](LICENSE-DATA.md) ([Spanish courtesy translation](LICENSE-DATA.es.md)). Free to use for building and testing your own software, commercial or not, but it is **not open data**: no bulk extraction, mirroring or competing catalogues. Contributors grant the project a broad licence. This is a draft: have a lawyer review it before relying on it.
- The generated seed content (`semilla/requisitos|tests|aceleradores/`) is **not** in this repository (see `.gitignore`). Schemas and migrations are public.
- Software categories follow the public category directory of Capterra, a trademark of its owner; this project is not affiliated with it.

## Contributing

Suggest a requirement, test or accelerator from the website, the API or `reqdb suggest`. Bug reports and pull requests for the code are welcome.
