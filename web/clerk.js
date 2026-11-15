// Sesión con Clerk (Google), la misma cuenta que el resto de proyectos de
// joderestatodocogido.com. Se carga bajo demanda: quien solo lee no descarga nada.
//
// La clave publicable es pública por diseño. Producción solo funciona en el
// dominio propio y sus subdominios; en vercel.app, previews y local se usa la
// instancia de desarrollo, con sus propios usuarios.

const CLERK_PK = /(^|\.)joderestatodocogido\.com$/.test(location.hostname)
  ? 'pk_live_Y2xlcmsuam9kZXJlc3RhdG9kb2NvZ2lkby5jb20k'
  : 'pk_test_YWxpdmUtd2FsbGV5ZS02NjQ0LmNsZXJrLmFjY291bnRzLmRldiQ';
const CLERK_JS = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5.128.0/dist/clerk.browser.js';

let promesa = null;

// Los botones sociales del modal construyen la vuelta con displayConfig.signInUrl:
// se reescribe para que Google vuelva a esta página y no al portal accounts.*.
function apuntarAqui() {
  const aqui = location.origin + location.pathname;
  const dc = window.Clerk?.__unstable__environment?.displayConfig;
  if (dc) { dc.signInUrl = aqui; dc.signUpUrl = aqui; }
}

export function cargarClerk() {
  if (promesa) return promesa;
  promesa = new Promise((ok, mal) => {
    const sc = document.createElement('script');
    sc.src = CLERK_JS; sc.async = true; sc.crossOrigin = 'anonymous';
    sc.setAttribute('data-clerk-publishable-key', CLERK_PK);
    sc.onload = async () => {
      try {
        const aqui = location.origin + location.pathname;
        // telemetry:false → Clerk no manda eventos a clerk-telemetry.com (la CSP no lo permite y no hace falta)
        await window.Clerk.load({ telemetry: false, signInUrl: aqui, signUpUrl: aqui,
          signInFallbackRedirectUrl: aqui, signUpFallbackRedirectUrl: aqui });
        apuntarAqui();
        if (/^#\/(sso-callback|continue)/.test(location.hash)) {
          await window.Clerk.handleRedirectCallback({ signInUrl: aqui, signUpUrl: aqui, firstFactorUrl: aqui,
            secondFactorUrl: aqui, continueSignUpUrl: aqui + '#/continue', verifyEmailAddressUrl: aqui,
            verifyPhoneNumberUrl: aqui, signInFallbackRedirectUrl: aqui, signUpFallbackRedirectUrl: aqui },
            async (a) => { try { history.replaceState(null, '', new URL(a, aqui).origin === location.origin ? a : aqui); }
                           catch { history.replaceState(null, '', aqui); } });
          if (/^#\/continue/.test(location.hash)) window.Clerk.openSignUp({});
          else history.replaceState(null, '', aqui);
        }
        ok(window.Clerk);
      } catch (e) { promesa = null; mal(e); }
    };
    sc.onerror = () => { promesa = null; mal(new Error('Could not load the sign-in service')); };
    document.head.appendChild(sc);
  });
  return promesa;
}

export async function entrar() {
  const c = await cargarClerk();
  apuntarAqui();
  c.openSignIn({ withSignUp: true });
}

export async function salir() { await (await cargarClerk()).signOut(); }

export async function token() {
  const c = await cargarClerk();
  return c.session ? c.session.getToken() : null;
}

export async function usuario() { return (await cargarClerk()).user ?? null; }

// Solo se carga Clerk al arrancar si ya hubo sesión en este navegador (la cookie
// __client_uat la pone Clerk); si no, esperamos a que alguien pulse «Sign in».
export const huboSesion = () => /(?:^|;\s*)__client_uat[^=]*=(?!0(?:;|$))/.test(document.cookie)
  || localStorage.getItem('rq_sesion') === '1';
export const marcarSesion = (v) => {
  try { v ? localStorage.setItem('rq_sesion', '1') : localStorage.removeItem('rq_sesion'); } catch { /* ventana privada */ }
};
