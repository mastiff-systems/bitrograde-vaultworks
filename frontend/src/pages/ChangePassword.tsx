import { useState, type FormEvent } from 'react';
import { changePassword } from '../api/auth.js';
import { useAuth } from '../contexts/AuthContext.js';

/**
 * Forced change-password screen (MAS-626). Rendered instead of the app shell
 * while mustChangePassword is set — admin-created accounts land here on first
 * login and cannot reach any other route until the password is changed.
 */
export function ChangePassword() {
  const { token, clearMustChangePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) return;
    setError('');
    setLoading(true);
    try {
      await changePassword(token, currentPassword, newPassword);
      clearMustChangePassword();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-accent mb-4">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-content-primary">Bitrograde Vaultworks</h1>
          <p className="text-sm text-content-muted mt-1">Digital Asset Management</p>
        </div>

        <div className="card p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-content-primary">Set a new password</h2>
            <p className="text-sm text-content-muted mt-1">
              Your account was created with a temporary password. Choose a new one to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="px-3 py-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="label">Current Password</label>
              <input
                className="input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your temporary password"
              />
            </div>

            <div>
              <label className="label">New Password</label>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label className="label">Confirm New Password</label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Repeat your new password"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : 'Change password'}
            </button>
          </form>

          <p className="text-center text-sm text-content-muted mt-5">
            <button className="text-accent-light hover:underline" onClick={logout}>
              Sign out
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
