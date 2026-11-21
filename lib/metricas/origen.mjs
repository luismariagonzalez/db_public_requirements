// De dónde salen las métricas de un acelerador: el repositorio (GitHub) y el paquete
// (registro oficial). Puro: sin red. Lo usan el relleno inicial y las pruebas.
//
// Los formatos de nombre de paquete son los mismos que valida la base
// (db_public_requirements.paquete_valido, migración 0009).

export const REGISTROS = ['npm', 'pypi', 'crates', 'nuget', 'rubygems', 'packagist', 'maven', 'go', 'homebrew'];

// Registros de los que sabemos leer descargas. maven y go no tienen API pública de descargas:
// se guardan (clasifican) pero no se consultan.
export const REGISTROS_CON_FUENTE = ['npm', 'pypi', 'crates', 'nuget', 'rubygems', 'packagist', 'homebrew'];

const FORMATO = {
  npm: (p) => /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i.test(p) && p.length <= 214,
  pypi: (p) => /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(p) && p.length <= 100,
  crates: (p) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(p),
  nuget: (p) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p),
  rubygems: (p) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p),
  packagist: (p) => /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/.test(p) && p.length <= 150,
  maven: (p) => /^[A-Za-z0-9_.-]{1,100}:[A-Za-z0-9_.-]{1,100}$/.test(p),
  go: (p) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/[A-Za-z0-9._~-]+)*$/.test(p) && p.length <= 200,
  homebrew: (p) => /^[a-z0-9][a-z0-9@+._-]{0,79}$/.test(p),
};

export function paqueteValido(registro, paquete) {
  return typeof paquete === 'string' && !!FORMATO[registro]?.(paquete);
}

// Primeros segmentos de github.com que no son un usuario u organización.
const RESERVADOS_GH = new Set(['features', 'marketplace', 'sponsors', 'orgs', 'topics', 'settings', 'apps', 'about',
  'pricing', 'enterprise', 'login', 'join', 'explore', 'collections', 'trending', 'readme', 'security', 'customer-stories',
  'solutions', 'resources', 'new', 'notifications', 'pulls', 'issues', 'search', 'site', 'contact', 'team']);

// → { owner, repo } o null. Acepta github.com/o/r, con .git, o subrutas (/tree/main, /releases…).
export function repoGithub(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const [owner, repoBruto] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repoBruto || RESERVADOS_GH.has(owner.toLowerCase())) return null;
  const repo = repoBruto.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || /^\.+$/.test(repo)) return null;
  return { owner, repo };
}

export const urlRepoGithub = (url) => {
  const r = repoGithub(url);
  return r ? `https://github.com/${r.owner}/${r.repo}` : null;
};

// Deduce, a partir de la URL pública del acelerador, su repositorio y su paquete.
// → { repo_url, registro, paquete } (cada uno null si no se puede deducir).
export function deducirOrigen(url) {
  const vacio = { repo_url: null, registro: null, paquete: null };
  let u;
  try { u = new URL(url); } catch { return vacio; }
  if (u.protocol !== 'https:') return vacio;

  const repo = urlRepoGithub(url);
  if (repo) return { ...vacio, repo_url: repo };

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const partes = u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  let registro = null, paquete = null;

  if (host === 'npmjs.com' && partes[0] === 'package') {
    registro = 'npm'; paquete = partes[1]?.startsWith('@') ? `${partes[1]}/${partes[2]}` : partes[1];
  } else if (host === 'pypi.org' && partes[0] === 'project') {
    registro = 'pypi'; paquete = partes[1];
  } else if (host === 'crates.io' && partes[0] === 'crates') {
    registro = 'crates'; paquete = partes[1];
  } else if (host === 'nuget.org' && partes[0] === 'packages') {
    registro = 'nuget'; paquete = partes[1];
  } else if (host === 'rubygems.org' && partes[0] === 'gems') {
    registro = 'rubygems'; paquete = partes[1];
  } else if (host === 'packagist.org' && partes[0] === 'packages') {
    registro = 'packagist'; paquete = `${partes[1]}/${partes[2]}`;
  } else if (host === 'formulae.brew.sh' && partes[0] === 'formula') {
    registro = 'homebrew'; paquete = partes[1];
  } else if (host === 'pkg.go.dev' && partes.length) {
    registro = 'go'; paquete = partes.join('/');
  } else if ((host === 'central.sonatype.com' && partes[0] === 'artifact') || (host === 'search.maven.org' && partes[0] === 'artifact')
             || (host === 'mvnrepository.com' && partes[0] === 'artifact')) {
    registro = 'maven'; paquete = `${partes[1]}:${partes[2]}`;
  }
  if (registro && paqueteValido(registro, paquete)) return { ...vacio, registro, paquete };
  return vacio;
}

// Pura (probada): la lista de aceleradores → qué fijar y qué no se pudo deducir.
export function planificar(aceleradores, { sobrescribir = false } = {}) {
  const fijar = [], sinDeducir = [], yaFijados = [];
  for (const a of aceleradores) {
    const d = deducirOrigen(a.url);
    if (!d.repo_url && !d.registro) { sinDeducir.push({ slug: a.slug, url: a.url, model: a.model ?? null }); continue; }
    const actual = { repo_url: a.repo_url ?? null, registro: a.registry ?? null, paquete: a.package ?? null };
    const nuevo = sobrescribir
      ? { repo_url: d.repo_url ?? actual.repo_url, registro: d.registro ?? actual.registro, paquete: d.paquete ?? actual.paquete }
      : { repo_url: actual.repo_url ?? d.repo_url, registro: actual.registro ?? d.registro, paquete: actual.paquete ?? d.paquete };
    if (nuevo.repo_url === actual.repo_url && nuevo.registro === actual.registro && nuevo.paquete === actual.paquete) {
      yaFijados.push(a.slug); continue;
    }
    fijar.push({ slug: a.slug, url: a.url, ...nuevo });
  }
  return { fijar, sinDeducir, yaFijados };
}
