import { useEffect, useState } from 'react';
import { fetchSettings, updateSettings, fetchStats } from '../../api/admin.js';
import type { AdminStats } from '../../api/admin.js';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

interface SettingField {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password' | 'checkbox';
  helpText?: string;
}

const S3_FIELDS: SettingField[] = [
  { key: 's3_endpoint', label: 'Endpoint URL', placeholder: 'https://nyc3.digitaloceanspaces.com or http://localhost:9000', helpText: 'S3-compatible endpoint. Leave empty to use AWS default.' },
  { key: 's3_bucket', label: 'Bucket Name', placeholder: 'vaultworks-assets' },
  { key: 's3_region', label: 'Region', placeholder: 'us-east-1' },
  { key: 's3_access_key', label: 'Access Key', placeholder: 'your-access-key' },
  { key: 's3_secret_key', label: 'Secret Key', placeholder: '••••••••', type: 'password', helpText: 'Leave unchanged to keep the existing secret key.' },
  { key: 's3_force_path_style', label: 'Force Path Style', placeholder: '', type: 'checkbox', helpText: 'Required for MinIO and some S3-compatible providers. Disable for AWS and DigitalOcean Spaces.' },
];

export function AdminSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchSettings(), fetchStats()])
      .then(([s, st]) => { setSettings(s); setStats(st); })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Storage and server configuration</p>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-8">
          <div className="stat-card">
            <span className="stat-label">Total Users</span>
            <span className="stat-value">{stats.users}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Admins</span>
            <span className="stat-value">{stats.admins}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Assets</span>
            <span className="stat-value">{stats.assets}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Storage Used</span>
            <span className="stat-value">{formatBytes(stats.totalSizeBytes)}</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && (
        <div className="max-w-2xl">
          {/* S3 Storage section */}
          <div className="card p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625v2.25m0 2.625v2.25" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-content-primary text-sm">Object Storage</h2>
                <p className="text-xs text-content-muted mt-0.5">S3-compatible storage configuration. Changes take effect within 30 seconds.</p>
              </div>
            </div>

            <div className="space-y-4">
              {S3_FIELDS.map((field) => (
                <div key={field.key}>
                  {field.type === 'checkbox' ? (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings[field.key] === 'true'}
                        onChange={(e) => handleChange(field.key, e.target.checked ? 'true' : 'false')}
                        className="mt-0.5 w-4 h-4 rounded border-border bg-surface-2 accent-accent cursor-pointer"
                      />
                      <div>
                        <span className="text-sm font-medium text-content-primary">{field.label}</span>
                        {field.helpText && <p className="text-xs text-content-muted mt-0.5">{field.helpText}</p>}
                      </div>
                    </label>
                  ) : (
                    <>
                      <label className="label">{field.label}</label>
                      <input
                        type={field.type === 'password' ? 'password' : 'text'}
                        className="input"
                        placeholder={field.placeholder}
                        value={settings[field.key] ?? ''}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        autoComplete="off"
                      />
                      {field.helpText && <p className="text-xs text-content-muted mt-1">{field.helpText}</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
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
      )}
    </div>
  );
}
