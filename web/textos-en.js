// Interface texts (English). Spanish lives in textos-es.js; a key missing there falls back to this file.
// Variables go in {braces}. Keys ending in .html may contain markup: ONLY write trusted markup here.
// The content of the database (requirements, tests…) is in English and is NOT translated here.
export default {
  'meta.title': 'Requirements DB · what your app must do, ready for your coding agent',
  'meta.description': 'A public, community-curated database of software requirements, tests and accelerators by app type and concern, with priorities 1-5. Search, pick, and paste them to your AI coding agent.',

  'nav.browse': 'Browse', 'nav.api': 'API', 'nav.cli': 'CLI', 'nav.account': 'Account', 'nav.terms': 'Terms', 'nav.main': 'Main',
  'cuenta.entrar': 'Sign in', 'cuenta.salir': 'Sign out', 'atajo.buscar': 'search',

  'hero.kicker': '// requirements for your coding agent',
  'hero.h1': "Don't let your agent forget the boring essentials.",
  'hero.p.html': 'Pick requirements for your kind of app — with the tests that prove them and the libraries that speed them up. They say <em>what</em> the app must do, never <em>where</em> it goes.',
  'hero.paso1': 'Pick a category & priority', 'hero.paso2': "Untick what doesn't apply", 'hero.paso3': 'Copy Markdown, curl or JSON',

  'lat.filtros': 'Filters', 'busca.placeholder': 'Search by meaning…', 'busca.aria': 'Search requirements by meaning',
  'lat.categoria': 'Category', 'filtro.placeholder': 'Filter: CRM, payroll, LMS…', 'filtro.aria': 'Filter software categories',
  'lat.prioridad': 'Priority up to', 'prio.aria': 'Maximum priority', 'lat.incluir': 'Include',
  'inc.tests': 'Tests', 'inc.acel': 'Accelerators', 'lat.proyecto': 'Project', 'proy.ninguno': '— none —', 'proy.ocultar': 'Hide what I did',

  'lista.titulo': 'Requirements', 'sel.todos': 'all', 'sel.ninguno': 'none', 'sel.cuenta': '{n}/{total} selected',
  'marcar.texto': 'Mark the selected in the project as', 'marcar.aplicar': 'Apply', 'marcar.aria': 'Status',
  'marcar.ok': '{n} item(s) marked as {estado}',

  'g.audience': 'Audience', 'g.domain': 'Domain', 'g.software_category': 'Software category', 'g.app_type': 'App type',
  'g.screen_type': 'Screen type', 'g.cross_cutting': 'Cross-cutting concerns',
  'g.mas': '{n} more: narrow it with the filter above.',

  'p1.n': 'essential', 'p1.d': 'broken or unsafe without it',
  'p2.n': 'expected', 'p2.d': 'users assume it is there',
  'p3.n': 'recommended', 'p3.d': 'solid apps do this',
  'p4.n': 'nice to have', 'p4.d': 'polish',
  'p5.n': 'differentiator', 'p5.d': 'sets you apart',
  'prio.todo': 'Everything, from essential to differentiators.', 'prio.hasta': 'P1 to P{n}, down to “{nombre}” — {desc}.',

  'estado.elige': 'Pick an audience, a category or an app type — or search by meaning.',
  'estado.buscando': 'Searching…',
  'estado.vacio': 'No requirements for this selection yet. Try the cross-cutting concerns (security, privacy…), fewer filters, or contribute one.',
  'err.429': 'Too many requests. Try again in {s} seconds, or sign in for a higher limit.', 'err.429.poco': 'a few',

  'item.incluir': 'Include {titulo}', 'det.tests': 'Tests', 'det.acel': 'Accelerators', 'det.sugerir': 'Suggest',
  'n.test.one': '{n} test', 'n.test.other': '{n} tests', 'n.acel.one': '{n} accelerator', 'n.acel.other': '{n} accelerators',
  'n.req.one': '{n} requirement', 'n.req.other': '{n} requirements',

  'est.planned': 'planned', 'est.in_progress': 'in progress', 'est.done': 'done', 'est.skipped': 'skipped',
  'estl.planned': 'Planned (roadmap)', 'estl.in_progress': 'In progress', 'estl.done': 'Done', 'estl.skipped': 'Skipped',

  'tabs.aria': 'What your agent receives', 'copiar': 'Copy', 'copiado': 'Copied', 'copiar.fallo': 'Could not copy: select the text manually',
  'codigo.vacio': '// select requirements to preview what your agent will receive', 'codigo.mas': '{n} more lines: Copy takes them all',
  'codigo.preview': 'Preview', 'pie.chars': '{n} chars', 'pie.get': 'GET · public', 'pie.tests': ' · {n} tests',

  'api.kicker': '// api', 'api.h2': 'Use it from your agent',
  'api.p.html': 'Public and rate limited — 20 req/min without a key. JSON by default, or paste-ready Markdown with <code>format=md</code>, ending with instructions for your agent to record what\'s done and what\'s pending in your project.',
  'api.leyenda': 'Priority scale · per category',
  'api.lectura': 'Read · public', 'api.clave': 'With a key',
  'api.ep.cats': 'audiences, domains, categories', 'api.ep.reqs.html': 'search, filter, <code>format=md</code>',
  'api.ep.tests': 'tests by category and priority', 'api.ep.acel': 'libraries and services',
  'api.ep.proyectos': 'your projects', 'api.ep.marcar': 'mark done / planned / skipped', 'api.ep.sugerir': 'suggest something',
  'api.nota.html': 'Add <code>project=&lt;id&gt;</code> to a search to see what you already shipped, and <code>hide=done</code> to skip it.',
  'api.cli.titulo': 'Prefer the terminal?', 'api.cli.p': 'The reqdb CLI is one file, no dependencies: pull requirements into your repo, let your agent mark progress, and fail CI while P1 work is pending.',
  'api.cli.enlace': 'CLI docs for agents →',

  'proy.h2': 'My projects',
  'proy.p.html': 'Track which requirements, tests and accelerators you implemented in each app, so next time you only pick what is new. Your agent can update this too (see <a href="#api">API</a> and <a href="./cli.html">CLI</a>).',
  'proy.nombre.placeholder': 'New project name, e.g. “Acme chat”', 'proy.nombre.aria': 'Project name', 'proy.crear': 'Create project',
  'proy.vacio': 'No projects yet. Create one to start tracking.', 'proy.cuentas': '{done} done · {in_progress} in progress · {planned} planned · {skipped} skipped',
  'proy.abrir': 'Open', 'proy.cerrar': 'Close', 'proy.borrar': 'Delete', 'proy.nada': 'Nothing tracked yet.', 'proy.estado.de': 'Status of {titulo}',
  'proy.confirmar': 'Delete the project “{nombre}” and its tracked items?', 'proy.dale.nombre': 'Give the project a name.', 'proy.creado': 'Project created and selected',

  'aporte.h2': 'Contribute a requirement',
  'aporte.p': 'Describe something an app should do, in any language. An AI reviews it: it checks it is a real requirement, whether it already exists (then it merges or declines), and strips anything about screens or layout.',
  'aporte.placeholder': 'e.g. Users must be able to block another user so they stop receiving their messages.',
  'aporte.terminos.html': 'I have the right to submit this and I agree to the <a href="./terms.html">Content Terms</a>, including the licence I grant the project over my contribution.',
  'aporte.enviar': 'Send for review', 'aporte.mias': 'My contributions', 'aporte.revisando': 'Reviewing…',
  'aporte.corto': 'Write at least a sentence (10 characters).', 'aporte.acepta': 'Please accept the Content Terms.',
  'aporte.duplicado': ' — already exists as {slug}',
  'ap.created': 'Created', 'ap.merged': 'Merged', 'ap.rejected': 'Not added', 'ap.needs_human': 'Needs a human look', 'ap.pending': 'Pending',

  'sug.h2': 'Suggest something',
  'sug.p': 'A missing test or accelerator, a requirement that could be better, or something wrong? A person reviews every suggestion. Use “Suggest” on any result to point at it.',
  'sug.tipo.aria': 'Kind', 'sug.tipo.improvement': 'Improve something', 'sug.tipo.new_item': 'Add something new', 'sug.tipo.report': 'Report a problem',
  'sug.obj.aria': 'Type of item', 'sug.obj.requirement': 'requirement', 'sug.obj.test': 'test', 'sug.obj.accelerator': 'accelerator', 'sug.obj.general': 'general',
  'sug.slug.placeholder': 'About (slug, optional)', 'sug.slug.aria': 'Slug it is about', 'sug.placeholder': 'What should change, and why?',
  'sug.enviar': 'Send suggestion', 'sug.mias': 'My suggestions', 'sug.entra': 'Sign in to send suggestions', 'sug.gracias': 'Thanks! A person will review it.',
  'sug.estado.new': 'new', 'sug.estado.accepted': 'accepted', 'sug.estado.dismissed': 'dismissed',

  'claves.h2': 'API keys',
  'claves.p': 'Keys raise your rate limit and let your agent (or the CLI) read, update your projects and send suggestions. Keep them secret: they are shown only once.',
  'claves.nombre.placeholder': 'Name, e.g. “my Claude Code”', 'claves.nombre.aria': 'Key name', 'claves.crear': 'Create key',
  'claves.vacio': 'No keys yet.', 'claves.revocada': 'revoked', 'claves.usada': 'used {fecha}', 'claves.nunca': 'never used', 'claves.revocar': 'Revoke',
  'claves.dale.nombre': 'Give the key a name.', 'claves.nueva': 'Copy it now, it will not be shown again:',
  'datos.borrar': 'Delete my data', 'datos.confirmar': 'This deletes your API keys, contributions, projects and suggestions, and anonymises content you authored. Continue?',
  'datos.borrados': 'Your data was deleted.', 'nada.todavia': 'Nothing yet.',

  'pie.texto': 'reqdb · community-curated · code MIT', 'pie.legal': 'Legal & privacy', 'pie.terminos': 'Content terms', 'pie.cli': 'CLI',
  'idioma.aria': 'Language',
};
