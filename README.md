# db_public_requirements

Base pública de requisitos de software para vibe coders: filtra por tipo de app, tipo de
pantalla o concern transversal (seguridad, privacidad…), con prioridad 1-5 por categoría y
búsqueda por significado (embeddings). Copia lo que necesites como Markdown y pásaselo a tu
agente.

```bash
curl "https://<sitio>/api/v1/requirements?category=messaging&max_priority=2&format=md"
```

- Lectura: `/api/v1/categories`, `/api/v1/requirements`, `/api/v1/tests`, `/api/v1/accelerators` (y `/:slug`), `POST /api/v1/export`.
  `include=tests,accelerators` los pide junto a los requisitos.
- Con cuenta o API key: `/api/v1/projects` (y `PUT /:id/items` para que el agente marque lo hecho y lo pendiente), `/api/v1/suggestions`.
- Con sesión (Clerk + Google): `POST /api/contribute` (revisa una IA), `/api/me/keys`, `/api/me/contributions`, `DELETE /api/me`.

## Licencias

- **Código:** MIT ([LICENSE](LICENSE)).
- **Contenido** (requisitos, tests, aceleradores, prioridades y aportes): [LICENSE-DATA.md](LICENSE-DATA.md). De uso libre para construir y probar software propio, también comercial, pero **no** es open data: sin extracción masiva, espejos ni catálogos competidores. Los contribuyentes ceden una licencia amplia al proyecto. Es un borrador: que lo revise un abogado.
- La semilla generada (`semilla/requisitos|tests|aceleradores/`) **no** está en el repo (ver `.gitignore`): vive solo en tu disco y en la base. Los esquemas y migraciones sí son públicos.

Lee **[AGENTS.md](AGENTS.md)**: decisiones del proyecto, variables, cupos y reglas de la casa.
