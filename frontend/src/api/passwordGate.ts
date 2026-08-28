/**
 * MAS-626: the backend 403s every non-exempt /api/* call with
 * `{ error: 'Password change required' }` while a user's mustChangePassword
 * flag is set (admin-created accounts). Axios instances can't reach React
 * state, so interceptors emit a window event that AuthContext listens for
 * to flip the app into the forced change-password screen mid-session.
 */
export const PASSWORD_CHANGE_REQUIRED_EVENT = 'vaultworks:password-change-required';

export function isPasswordChangeRequired(err: unknown): boolean {
  const resp = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
  return resp?.status === 403 && resp?.data?.error === 'Password change required';
}

export function emitPasswordChangeRequired(): void {
  window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
}
