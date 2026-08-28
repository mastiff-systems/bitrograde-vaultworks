import { useState, type FormEvent } from 'react';
import { login, register, forgotPassword } from '../api/auth.js';
import { redirectToKeycloak, isKeycloakEnabled } from '../auth/keycloak.js';
import { useAuth } from '../contexts/AuthContext.js';

type Mode = 'login' | 'register' | 'forgot';

export function LoginPage() {
  const { setAuth } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const keycloak = isKeycloakEnabled();

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setForgotSent(false);
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'forgot') {
        await forgotPassword(email);
        setForgotSent(true);
        return;
      }
      const result = mode === 'login'
        ? await login(email, password)
        : await register(email, password);
      setAuth(
        result.token,
        { userId: result.user.id, email: result.user.email, role: result.user.role ?? 'user' },
        result.user.mustChangePassword === true,
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const Logo = () => (
    <div className="text-center mb-8">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-accent mb-4">
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-content-primary">Bitrograde Vaultworks</h1>
      <p className="text-sm text-content-muted mt-1">Digital Asset Management</p>
    </div>
  );

  if (mode === 'forgot') {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <div className="relative w-full max-w-sm">
          <Logo />

          <div className="card p-6">
            {forgotSent ? (
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success/10 mb-2">
                  <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm text-content-primary font-medium">Check your inbox</p>
                <p className="text-sm text-content-muted">
                  If an account with that email exists, a password reset link has been sent.
                </p>
                <button
                  className="text-accent-light hover:underline text-sm mt-2"
                  onClick={() => switchMode('login')}
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-content-primary">Forgot your password?</h2>
                  <p className="text-sm text-content-muted mt-1">Enter your email and we'll send you a reset link.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="px-3 py-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
                      {error}
                    </div>
                  )}

                  <div>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                    />
                  </div>

                  <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                    {loading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Please wait…
                      </>
                    ) : 'Send reset link'}
                  </button>
                </form>

                <p className="text-center text-sm text-content-muted mt-5">
                  <button className="text-accent-light hover:underline" onClick={() => switchMode('login')}>
                    Back to sign in
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <Logo />

        <div className="card p-6">
          {keycloak && (
            <>
              <button
                type="button"
                onClick={() => redirectToKeycloak()}
                className="btn-secondary w-full justify-center mb-4"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 1.5C6.201 1.5 1.5 6.201 1.5 12S6.201 22.5 12 22.5 22.5 17.799 22.5 12 17.799 1.5 12 1.5zm0 19.5C6.753 21 3 17.247 3 12S6.753 3 12 3s9 3.753 9 9-3.753 9-9 9z" />
                </svg>
                Continue with Keycloak
              </button>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-content-muted">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="px-3 py-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    className="text-xs text-accent-light hover:underline"
                    onClick={() => switchMode('forgot')}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Please wait…
                </>
              ) : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-content-muted mt-5">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              className="text-accent-light hover:underline"
              onClick={() => { switchMode(mode === 'login' ? 'register' : 'login'); }}
            >
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-content-muted mt-4">
          {mode === 'register' && 'The first account created becomes admin.'}
        </p>
      </div>
    </div>
  );
}
