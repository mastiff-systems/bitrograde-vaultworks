import { useEffect, useState } from 'react';
import { getProfile, updateProfile, type UserProfile } from '../api/client.js';

/**
 * User profile settings page.
 *
 * Lets any logged-in user view and update their first and last name.
 * Mapped to the "profile" page via Layout / App.tsx navigation.
 */
export function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getProfile()
      .then((p) => {
        setProfile(p);
        setFirstName(p.firstName ?? '');
        setLastName(p.lastName ?? '');
      })
      .catch(() => setError('Failed to load profile.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateProfile({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
      });
      setProfile(updated);
      setFirstName(updated.firstName ?? '');
      setLastName(updated.lastName ?? '');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const initials = [firstName, lastName]
    .filter(Boolean)
    .map((s) => s[0].toUpperCase())
    .join('') || profile?.email?.[0]?.toUpperCase() || '?';

  const displayName = [firstName, lastName].filter(Boolean).join(' ') || null;

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Manage your personal information</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && (
        <div className="max-w-lg">
          {/* Avatar + identity summary */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-accent-light">{initials}</span>
            </div>
            <div>
              {displayName ? (
                <p className="font-semibold text-content-primary">{displayName}</p>
              ) : (
                <p className="text-content-muted italic text-sm">No name set</p>
              )}
              <p className="text-sm text-content-muted">{profile?.email}</p>
              <span className="text-xs capitalize text-content-muted bg-surface-3 px-2 py-0.5 rounded-full mt-1 inline-block">
                {profile?.role}
              </span>
            </div>
          </div>

          {/* Edit form */}
          <div className="card p-6">
            <h2 className="font-semibold text-content-primary text-sm mb-5">Personal Information</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label" htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  className="input"
                  type="text"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setSaved(false); }}
                  maxLength={100}
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="label" htmlFor="lastName">Last Name</label>
                <input
                  id="lastName"
                  className="input"
                  type="text"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); setSaved(false); }}
                  maxLength={100}
                  autoComplete="family-name"
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input bg-surface-2 cursor-not-allowed opacity-60"
                  type="email"
                  value={profile?.email ?? ''}
                  readOnly
                  aria-readonly="true"
                />
                <p className="text-xs text-content-muted mt-1">Email cannot be changed here.</p>
              </div>

              {error && (
                <div className="px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
                {saved && (
                  <span className="flex items-center gap-1.5 text-success text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Saved
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
