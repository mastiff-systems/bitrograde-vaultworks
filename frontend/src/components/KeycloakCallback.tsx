import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { exchangeKeycloakCode } from '../auth/keycloak.js';
import { useAuth } from '../contexts/AuthContext.js';

// Handles the /auth/callback redirect from Keycloak (PKCE code exchange)
export function KeycloakCallback() {
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      window.location.replace('/');
      return;
    }

    exchangeKeycloakCode(code, state)
      .then((token) => {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setAuth(token, {
            userId: payload.sub,
            email: payload.email ?? payload.preferred_username,
            role: payload.role ?? 'user',
          });
          navigate('/', { replace: true });
        } catch {
          window.location.replace('/');
        }
      })
      .catch(() => window.location.replace('/'));
  }, [setAuth]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0d0d0d', color: '#aaa', fontFamily: 'system-ui, sans-serif' }}>
      Completing sign-in…
    </div>
  );
}
