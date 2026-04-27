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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);

  // Parse user from stored token on mount (no extra network call)
  useEffect(() => {
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUser({ userId: payload.userId ?? payload.sub, email: payload.email, role: payload.role ?? 'user' });
    } catch {
      setToken(null);
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

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
