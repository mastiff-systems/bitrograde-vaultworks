import { useEffect, useState } from 'react';
import { fetchSmtpSettings, updateSmtpSettings, sendTestEmail } from '../../api/admin.js';
import type { SmtpSettings } from '../../api/admin.js';

const MASKED = '••••••••';

const ENCRYPTION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'tls', label: 'TLS' },
  { value: 'starttls', label: 'STARTTLS' },
];

const DEFAULT_SETTINGS: SmtpSettings = {
  smtp_host: '',
  smtp_port: '',
  smtp_username: '',
  smtp_password: '',
  smtp_from_address: '',
  smtp_encryption: 'none',
};

export function EmailSettings() {
  const [settings, setSettings] = useState<SmtpSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    fetchSmtpSettings()
      .then((s) => setSettings(s))
      .catch(() => setError('Failed to load email settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: keyof SmtpSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSmtpSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save email settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTestStatus('sending');
    setTestError(null);
    try {
      const result = await sendTestEmail();
      if (result.success) {
        setTestStatus('success');
        setTimeout(() => setTestStatus('idle'), 4000);
      } else {
        setTestStatus('error');
        setTestError(result.error ?? 'Test email failed.');
      }
    } catch {
      setTestStatus('error');
      setTestError('Failed to send test email. Check your SMTP settings.');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Email</h1>
          <p className="page-subtitle">Configure outgoing SMTP settings for password resets and system notifications.</p>
        </div>
      </div>

      <div className="max-w-2xl">
        <div className="card p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-content-primary text-sm">SMTP Configuration</h2>
              <p className="text-xs text-content-muted mt-0.5">Outgoing mail server settings.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">SMTP Host</label>
                <input
                  type="text"
                  className="input"
                  placeholder="smtp.example.com"
                  value={settings.smtp_host}
                  onChange={(e) => handleChange('smtp_host', e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">Port</label>
                <input
                  type="text"
                  className="input"
                  placeholder="587"
                  value={settings.smtp_port}
                  onChange={(e) => handleChange('smtp_port', e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="user@example.com"
                value={settings.smtp_username}
                onChange={(e) => handleChange('smtp_username', e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder={settings.smtp_password === MASKED ? 'Unchanged (saved)' : 'Enter password'}
                value={settings.smtp_password}
                onChange={(e) => handleChange('smtp_password', e.target.value)}
                autoComplete="new-password"
              />
              {settings.smtp_password === MASKED && (
                <p className="text-xs text-content-muted mt-1">A password is already saved. Enter a new one to replace it.</p>
              )}
            </div>

            <div>
              <label className="label">From Address</label>
              <input
                type="email"
                className="input"
                placeholder="noreply@example.com"
                value={settings.smtp_from_address}
                onChange={(e) => handleChange('smtp_from_address', e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="label">Encryption</label>
              <select
                className="input"
                value={settings.smtp_encryption}
                onChange={(e) => handleChange('smtp_encryption', e.target.value)}
              >
                {ENCRYPTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
        )}

        {testStatus === 'error' && testError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
            Test email failed: {testError}
          </div>
        )}

        {testStatus === 'success' && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-success/10 border border-success/20 text-success text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Test email sent successfully. Check your inbox.
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : 'Save Changes'}
          </button>

          <button
            onClick={handleTestEmail}
            disabled={testStatus === 'sending'}
            className="btn-secondary"
          >
            {testStatus === 'sending' ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
                Sending…
              </>
            ) : 'Send Test Email'}
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
      </div>
    </div>
  );
}
