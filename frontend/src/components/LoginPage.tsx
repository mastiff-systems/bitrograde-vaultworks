import { useState, type FormEvent } from 'react';
import { login, register } from '../api/auth.js';
import { redirectToKeycloak, isKeycloakEnabled } from '../auth/keycloak.js';
import { useAuth } from '../contexts/AuthContext.js';

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0d0d0d',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 12,
    padding: '40px 36px',
    width: 360,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  subtitle: { color: '#666', fontSize: 13, margin: '0 0 28px' },
  label: { display: 'block', color: '#aaa', fontSize: 13, marginBottom: 6 },
  input: {
    width: '100%',
    background: '#111',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#fff',
    fontSize: 14,
    padding: '10px 12px',
    boxSizing: 'border-box',
    outline: 'none',
    marginBottom: 16,
  },
  btn: {
    width: '100%',
    background: '#7c3aed',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    padding: '11px 0',
    marginTop: 4,
  },
  btnSecondary: {
    width: '100%',
    background: 'transparent',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#aaa',
    cursor: 'pointer',
    fontSize: 13,
    padding: '10px 0',
    marginTop: 10,
  },
  divider: { textAlign: 'center', color: '#444', fontSize: 12, margin: '18px 0' },
  toggle: {
    textAlign: 'center',
    color: '#666',
    fontSize: 13,
    marginTop: 20,
  },
  toggleLink: { color: '#7c3aed', cursor: 'pointer', background: 'none', border: 'none', fontSize: 13 },
  error: { color: '#f66', fontSize: 13, marginBottom: 12 },
};

export function LoginPage() {
  const { setAuth } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const keycloak = isKeycloakEnabled();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = mode === 'login'
        ? await login(email, password)
        : await register(email, password);
      setAuth(result.token, { userId: result.user.id, email: result.user.email });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Bitrograde Vaultworks</h1>
        <p style={styles.subtitle}>Digital Asset Management</p>

        {keycloak ? (
          <>
            <button style={styles.btn} onClick={() => redirectToKeycloak()}>
              Continue with Keycloak
            </button>
            <div style={styles.divider}>or sign in locally</div>
          </>
        ) : null}

        <form onSubmit={handleSubmit}>
          {error && <p style={styles.error}>{error}</p>}
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p style={styles.toggle}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button style={styles.toggleLink} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
