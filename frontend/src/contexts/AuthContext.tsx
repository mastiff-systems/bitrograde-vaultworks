import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const TOKEN_KEY = 'vaultworks_token';

interface AuthUser {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
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

  // A stored token that failed to parse is garbage — drop it.
  useEffect(() => {
    if (token && !user) {
      setToken(null);
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token, user]);

  function setAuth(newToken: string, newUser: AuthUser) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ token, user, setAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
