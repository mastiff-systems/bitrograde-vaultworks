import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchMe } from '../api/auth.js';
import { PASSWORD_CHANGE_REQUIRED_EVENT } from '../api/passwordGate.js';

const TOKEN_KEY = 'vaultworks_token';

interface AuthUser {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  /** True when the backend gates this user off all protected routes until they change their password (MAS-626). */
  mustChangePassword: boolean;
  setAuth: (token: string, user: AuthUser, mustChangePassword?: boolean) => void;
  clearMustChangePassword: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Decode the JWT payload into an AuthUser; null if the token is missing or malformed. */
function parseUser(token: string | null): AuthUser | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { userId: payload.userId ?? payload.sub, email: payload.email, role: payload.role ?? 'user' };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  // Parsed eagerly so role checks (e.g. AdminRoute) see the user on the very
  // first render — an effect would leave user null for one render and hard
  // loads of /admin/* would redirect before the token was ever parsed.
  const [user, setUser] = useState<AuthUser | null>(() => parseUser(token));
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // A stored token that failed to parse is garbage — drop it.
  useEffect(() => {
    if (token && !user) {
      setToken(null);
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token, user]);

  // The JWT doesn't carry mustChangePassword, so on token restore (page load)
  // hydrate it from /api/auth/me — one of the two routes exempt from the gate.
  // Mount-only: fresh logins get the flag from the login response via setAuth,
  // and re-running here would overwrite it with a stale/racing /me result.
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;
    let cancelled = false;
    fetchMe(storedToken)
      .then((me) => {
        if (!cancelled) setMustChangePassword(me.mustChangePassword === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // API interceptors emit this when any call 403s with 'Password change required'
  // (covers the flag flipping server-side mid-session).
  useEffect(() => {
    const onRequired = () => setMustChangePassword(true);
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onRequired);
  }, []);

  function setAuth(newToken: string, newUser: AuthUser, newMustChangePassword = false) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(newMustChangePassword);
  }

  function clearMustChangePassword() {
    setMustChangePassword(false);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
  }

  return (
    <AuthContext.Provider value={{ token, user, mustChangePassword, setAuth, clearMustChangePassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
