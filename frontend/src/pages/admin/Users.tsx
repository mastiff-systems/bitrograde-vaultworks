import { useEffect, useRef, useState } from 'react';
import { fetchUsers, updateUserRole, createUser } from '../../api/admin.js';
import type { AdminUser } from '../../api/admin.js';
import { useAuth } from '../../contexts/AuthContext.js';

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Create User Modal ─────────────────────────────────────────────────────────

interface CreateUserModalProps {
  onCreated: (user: AdminUser) => void;
  onClose: () => void;
}

function CreateUserModal({ onCreated, onClose }: CreateUserModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Password is required.';
    else if (password.length < 8) next.password = 'Password must be at least 8 characters.';
    if (!confirmPassword) next.confirmPassword = 'Please confirm the password.';
    else if (password !== confirmPassword) next.confirmPassword = 'Passwords do not match.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const user = await createUser({ email: email.trim().toLowerCase(), password, role });
      onCreated(user);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setServerError(msg ?? 'Failed to create user. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cu-title"
        className="bg-surface-1 border border-border rounded-xl shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-[18px] h-[18px] text-accent-light" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
              </svg>
            </div>
            <div>
              <h2 id="cu-title" className="font-semibold text-content-primary text-sm">Create User</h2>
              <p className="text-xs text-content-muted mt-0.5">New account with temporary password</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-surface-4 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
          <div className="px-6 pb-2 flex flex-col gap-4">
            {serverError && (
              <div className="px-3 py-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs">
                {serverError}
              </div>
            )}

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cu-email" className="text-xs font-medium text-content-secondary">
                Email <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                ref={emailRef}
                id="cu-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((p) => ({ ...p, email: '' })); }}
                placeholder="user@example.com"
                className={`input ${errors.email ? 'border-danger focus:ring-danger/30' : ''}`}
                autoComplete="email"
                disabled={submitting}
              />
              {errors.email && <p className="text-xs text-danger">{errors.email}</p>}
            </div>

            {/* Role */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cu-role" className="text-xs font-medium text-content-secondary">Role</label>
              <select
                id="cu-role"
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                className="input"
                disabled={submitting}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cu-password" className="text-xs font-medium text-content-secondary">
                Password <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="cu-password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((p) => ({ ...p, password: '' })); }}
                placeholder="Min. 8 characters"
                className={`input ${errors.password ? 'border-danger focus:ring-danger/30' : ''}`}
                autoComplete="new-password"
                disabled={submitting}
              />
              {errors.password && <p className="text-xs text-danger">{errors.password}</p>}
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cu-confirm" className="text-xs font-medium text-content-secondary">
                Confirm Password <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="cu-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (errors.confirmPassword) setErrors((p) => ({ ...p, confirmPassword: '' })); }}
                placeholder="Re-enter password"
                className={`input ${errors.confirmPassword ? 'border-danger focus:ring-danger/30' : ''}`}
                autoComplete="new-password"
                disabled={submitting}
              />
              {errors.confirmPassword && <p className="text-xs text-danger">{errors.confirmPassword}</p>}
            </div>

            <p className="text-xs text-content-muted -mt-1">
              The user will be prompted to change their password on first login.
            </p>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex gap-2 justify-end mt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary btn-sm">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary btn-sm">
              {submitting ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating…
                </span>
              ) : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface AdminUsersProps {
  /** Render without the page wrapper/header, for embedding inside the admin
   *  Settings "Users" tab (MAS-778). The /admin/users route stays standalone. */
  embedded?: boolean;
}

export function AdminUsers({ embedded = false }: AdminUsersProps) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setError('Failed to load users.')).finally(() => setLoading(false));
  }, []);

  const handleRoleToggle = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    setUpdatingId(u.id);
    try {
      const updated = await updateUserRole(u.id, newRole);
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to update role.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUserCreated = (user: AdminUser) => {
    setUsers((prev) => [...prev, user]);
    setShowCreateModal(false);
  };

  return (
    <div className={embedded ? '' : 'flex-1 p-8'}>
      <div className={embedded ? 'flex items-center justify-between mb-4' : 'page-header'}>
        {embedded ? (
          <p className="text-sm text-content-secondary">{users.length} registered account{users.length !== 1 ? 's' : ''}</p>
        ) : (
          <div>
            <h1 className="page-title">Users</h1>
            <p className="page-subtitle">{users.length} registered account{users.length !== 1 ? 's' : ''}</p>
          </div>
        )}
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary btn-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create User
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-accent-light">
                          {u.email[0].toUpperCase()}
                        </span>
                      </div>
                      <span className="text-content-primary font-medium">
                        {u.email}
                        {u.id === currentUser?.userId && (
                          <span className="ml-2 text-[10px] text-content-muted">(you)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'bg-accent/15 text-accent-light' : 'bg-surface-4 text-content-secondary'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td>{formatDate(u.created_at)}</td>
                  <td>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleRoleToggle(u)}
                        disabled={updatingId === u.id || u.id === currentUser?.userId}
                        className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {updatingId === u.id ? (
                          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        ) : u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <CreateUserModal
          onCreated={handleUserCreated}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
