// Textos del cuadro de control (zona admin), en inglés. Mismas claves que textos-admin-es.js
// (lo comprueba tests/admin_i18n.test.mjs). Van aparte de textos-en.js para no engordar lo que carga
// la web pública y no tocar ficheros compartidos.
export default {
  'meta.title': 'Admin · airedb',
  'chrome.admin': 'admin',
  'nav.aria': 'Admin sections',
  'nav.overview': 'Overview', 'nav.contributions': 'Contributions', 'nav.suggestions': 'Suggestions', 'nav.split': 'Long requirements',
  'nav.panels': 'Panels', 'nav.history': 'History', 'nav.audit': 'Audit log',
  'me.id': 'Signed in as admin {id}',

  'gate.checking': 'Checking your access…',
  'gate.403.title': '403 · Administrators only',
  'gate.403.text': 'This area is only for the people who run airedb. If you should have access, sign in with your administrator account.',
  'gate.signin': 'Sign in', 'gate.signout': 'Sign out', 'gate.back': 'Back to airedb',
  'gate.429.title': 'Too many attempts', 'gate.error.title': 'Could not open the admin area', 'gate.error': 'Could not check your access: {msg}',
  'err.429': 'Too many requests. Wait a minute and try again.', 'err.403': 'Not allowed: administrators only.',

  'common.loading': 'Loading…', 'common.empty': 'Nothing to show.', 'common.more': 'Load more', 'common.retry': 'Try again',
  'common.apply': 'Apply', 'common.reset': 'Reset', 'common.refresh': 'Refresh', 'common.all': 'All',
  'common.approve': 'Approve', 'common.reject': 'Reject', 'common.accept': 'Accept', 'common.dismiss': 'Dismiss',
  'common.version': 'version {n}',

  'sec.activity': 'Activity', 'sec.database': 'Database', 'sec.contributions': 'Contributions timeline and review queue',
  'sec.suggestions': 'Suggestions', 'sec.split': 'Requirements that are too long', 'sec.proposals': 'Split proposals',
  'sec.panels': 'Useful lists', 'sec.history': 'Version history', 'sec.audit': 'Audit log',

  'kpi.published': 'Published requirements', 'kpi.archived': 'Archived requirements', 'kpi.tests': 'Tests', 'kpi.accelerators': 'Accelerators',
  'kpi.categories': 'Categories', 'kpi.copies': 'Copies in total', 'kpi.needs_human': 'Waiting for a person', 'kpi.suggestions_new': 'New suggestions',
  'kpi.proposals': 'Split proposals pending', 'kpi.keys': 'Active API keys', 'kpi.projects': 'Projects', 'kpi.db_size': 'Database size',

  'range.aria': 'Time range', 'range.days': 'Last {n} days',
  'activity.note': 'Reads, searches, copies and errors are counted in batches by the API, so they are approximate. Contributions, suggestions, keys, projects and requirements come straight from the tables. Daily counters are kept for one year.',
  'graf.resumen': '{titulo}: {total} in total, at most {max} in a day (on {dia}).',
  'graf.contributions': 'Contributions by outcome',
  'm.read': 'Requirement reads', 'm.search': 'Searches', 'm.list': 'Lists without search', 'm.copy': 'Copies', 'm.export': 'Exports (preview)',
  'm.api_total': 'API requests', 'm.error_5xx': 'Server errors (5xx)', 'm.rate_limited': 'Rate-limited (429)',
  'm.suggestions': 'Suggestions', 'm.keys_created': 'API keys created', 'm.projects_created': 'Projects created', 'm.requirements_created': 'Requirements created',
  'db.note': 'Total size {size}. Rows are exact counts; size includes indexes.',

  'ap.created': 'Created', 'ap.merged': 'Merged', 'ap.rejected': 'Rejected', 'ap.needs_human': 'Needs a person', 'ap.pending': 'Pending',
  'act.created': 'created', 'act.merged': 'merged', 'act.rejected': 'rejected', 'act.needs_human': 'needs a person',
  'c.note': 'Who is shown as a short hash (never the account). Approving a “needs a person” contribution applies the stored requirement: it creates it, or merges it into the existing one without changing existing priorities.',
  'c.status': 'Status', 'c.requirement': 'Requirement', 'c.who': 'Person (hash)', 'c.filter.who': 'Show only this person',
  'c.resolved': 'resolved {d}', 'c.admin': 'Admin decision: {d}. {reason}', 'c.admin.approved': 'approved', 'c.admin.rejected': 'rejected',
  'c.approve.confirm': 'Apply this contribution (create or merge the requirement)?', 'c.reject.prompt': 'Reason for rejecting (optional):',
  'c.approved': 'Contribution #{id} approved.', 'c.rejected': 'Contribution #{id} rejected.',

  'sug.new': 'New', 'sug.accepted': 'Accepted', 'sug.dismissed': 'Dismissed',
  's.set.new': 'Reopen', 's.set.accepted': 'Accept', 's.set.dismissed': 'Dismiss', 's.changed': 'Suggestion #{id} is now {s}.',
  'kind.new_item': 'New item', 'kind.improvement': 'Improvement', 'kind.report': 'Report',
  'target.requirement': 'requirement', 'target.test': 'test', 'target.accelerator': 'accelerator', 'target.general': 'general',

  'd.note': 'Score 0-100 from the statement length, number of criteria, distinct action verbs, categories and tests. From 40 a requirement is a candidate. “Propose split” asks the AI for 2-4 smaller requirements and only saves a proposal: nothing changes until you accept it.',
  'd.min': 'Minimum score', 'd.none': 'No candidates at this score.', 'd.propose': 'Propose split', 'd.repropose': 'Propose again', 'd.proposing': 'Asking the AI…',
  'd.proposed': 'Proposal saved for {slug}.', 'd.has_proposal': 'has a proposal', 'd.score.title': 'Split candidate score (0-100)',
  'd.m.chars': '{n} chars · ', 'd.m.criteria': '{n} criteria · ', 'd.m.categories': '{n} categories · ', 'd.m.tests': '{n} tests · ',
  'd.m.verbs': '{n} verbs · ', 'd.m.copies': '{n} copies',
  'level.high': 'high', 'level.medium': 'medium', 'level.low': 'low',
  'why.long_statement': 'long statement', 'why.many_criteria': 'many criteria', 'why.many_verbs': 'several action verbs', 'why.many_categories': 'many categories', 'why.many_tests': 'many tests',
  'd.proposals.note': 'Accepting creates the new requirements with the same categories and priorities, links the tests and accelerators of the original to each of them, and archives the original.',
  'd.status.pending': 'Pending', 'd.status.accepted': 'Accepted', 'd.status.dismissed': 'Dismissed',
  'd.accept.confirm': 'Create the new requirements and archive {slug}?', 'd.accepted': 'Done: {n} requirements created, original archived.', 'd.dismissed': 'Proposal dismissed.',
  'd.reason': 'Why: {r}', 'd.score': 'score {n}', 'd.result': 'Created: {slugs}',

  'p.top': 'Most copied', 'p.top.note': 'The requirements people copy most.',
  'p.notests': 'Without tests', 'p.notests.note': 'Published requirements that no test checks (most copied first).',
  'p.noacc': 'Without accelerators', 'p.noacc.note': 'Published requirements with no library or service linked.',
  'p.emptycat': 'Categories without content', 'p.emptycat.note': 'Categories that have no published requirement yet.',

  'h.slug': 'Requirement slug', 'h.show': 'Show history', 'h.note': 'Type a requirement slug, or click one anywhere in this area.', 'h.notfound': 'No requirement with that slug.',
  'h.current': 'Current', 'h.old': 'Previous', 'h.status.published': 'published', 'h.status.archived': 'archived',

  'a.note': 'Every action that changes data is recorded here with a short hash of the admin. Kept for one year.',
  'aud.contribution_approved': 'contribution approved', 'aud.contribution_rejected': 'contribution rejected', 'aud.suggestion_status': 'suggestion status',
  'aud.split_proposed': 'split proposed', 'aud.split_accepted': 'split accepted', 'aud.split_dismissed': 'split dismissed',
};
