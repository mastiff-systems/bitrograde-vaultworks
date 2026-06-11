// Keycloak PKCE (Authorization Code + S256) flow for public clients.
// Activated when VITE_AUTH_PROVIDER=keycloak.

const KC_URL = import.meta.env.VITE_KEYCLOAK_URL as string;
const KC_REALM = import.meta.env.VITE_KEYCLOAK_REALM as string;
const KC_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string;
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const array = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(array.buffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(digest) };
}

export async function redirectToKeycloak(): Promise<void> {
  const { verifier, challenge } = await generatePkce();
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)).buffer);

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state', state);

  const params = new URLSearchParams({
    client_id: KC_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/auth?${params}`;
}

export async function exchangeKeycloakCode(code: string, state: string): Promise<string> {
  const storedState = sessionStorage.getItem('pkce_state');
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');

  if (state !== storedState) throw new Error('State mismatch — possible CSRF');
  if (!verifier) throw new Error('Missing PKCE verifier');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KC_CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const resp = await fetch(
    `${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  );

  if (!resp.ok) throw new Error('Token exchange failed');
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

export function isKeycloakEnabled(): boolean {
  return import.meta.env.VITE_AUTH_PROVIDER === 'keycloak';
}
