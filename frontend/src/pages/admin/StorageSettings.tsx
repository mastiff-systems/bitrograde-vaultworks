import { useEffect, useState } from 'react';
import { fetchSettings, updateSettings } from '../../api/admin.js';

interface SettingField {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password' | 'checkbox';
  helpText?: string;
}

const S3_FIELDS: SettingField[] = [
  { key: 's3_access_key', label: 'Access Key', placeholder: 'your-access-key' },
  { key: 's3_secret_key', label: 'Access Secret', placeholder: '••••••••', type: 'password', helpText: 'Leave unchanged to keep the existing secret key.' },
  { key: 's3_bucket', label: 'S3 Bucket', placeholder: 'vaultworks-assets' },
  { key: 's3_endpoint', label: 'Endpoint URL', placeholder: 'https://nyc3.digitaloceanspaces.com or http://localhost:9000', helpText: 'S3-compatible endpoint. Leave empty to use AWS default.' },
  { key: 's3_root_folder', label: 'Root Folder Name', placeholder: 'my-folder', helpText: 'All files will be stored under this prefix. Leave empty to store at the bucket root.' },
];

// Keys owned by this form — only these are included in the PUT payload.
const STORAGE_KEYS = [
  'storage_type',
  'disk_storage_path',
  's3_access_key',
  's3_secret_key',
  's3_bucket',
  's3_endpoint',
  's3_root_folder',
];

export function StorageSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => setSettings(s))
      .catch(() => setError('Failed to load storage settings.'))
      .finally(() => setLoading(false));
  }, []);

  const storageType = settings['storage_type'] || 's3';

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Send only storage-relevant keys so non-storage settings are untouched.
      const payload = Object.fromEntries(
        STORAGE_KEYS
          .filter((k) => k in settings)
          .map((k) => [k, settings[k]]),
      );
      // Always include storage_type even if not yet persisted.
      payload['storage_type'] = storageType;

      const updated = await updateSettings(payload);
      // Merge returned values back so masked secrets stay correct.
      setSettings((prev) => ({ ...prev, ...updated }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
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
          <h1 className="page-title">Storage</h1>
          <p className="page-subtitle">Configure where uploaded files are stored. Changes take effect within 30 seconds.</p>
        </div>
      </div>

      <div className="max-w-2xl">
        {/* Storage type selector */}
        <div className="card p-6 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625v2.25m0 2.625v2.25" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-content-primary text-sm">Storage Type</h2>
              <p className="text-xs text-content-muted mt-0.5">Choose where uploaded files are saved.</p>
            </div>
          </div>

          <div className="flex gap-4">
            {(['disk', 's3'] as const).map((type) => (
              <label
                key={type}
                className={`flex items-center gap-2.5 cursor-pointer px-4 py-3 rounded-lg border transition-colors ${
                  storageType === type
                    ? 'border-accent bg-accent/5 text-content-primary'
                    : 'border-border text-content-secondary hover:border-border/80 hover:text-content-primary'
                }`}
              >
                <input
                  type="radio"
                  name="storage_type"
                  value={type}
                  checked={storageType === type}
                  onChange={() => handleChange('storage_type', type)}
                  className="accent-accent"
                />
                <span className="text-sm font-medium capitalize">{type === 's3' ? 'S3 / Object Storage' : 'Disk'}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Disk section */}
        {storageType === 'disk' && (
          <div className="card p-6 mb-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-content-primary text-sm">Disk Storage</h2>
                <p className="text-xs text-content-muted mt-0.5">Files are stored on the server filesystem.</p>
              </div>
            </div>

            <div>
              <label className="label">Storage Path <span className="text-content-muted font-normal">(optional)</span></label>
              <input
                type="text"
                className="input"
                placeholder="<app root>/uploads"
                value={settings['disk_storage_path'] ?? ''}
                onChange={(e) => handleChange('disk_storage_path', e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-content-muted mt-1">Files will be stored at this path on the server filesystem. Leave empty to use the default <code className="text-xs bg-surface-3 px-1 py-0.5 rounded">uploads/</code> folder.</p>
            </div>
          </div>
        )}

        {/* S3 section */}
        {storageType === 's3' && (
          <div className="card p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-content-primary text-sm">S3 / Object Storage</h2>
                <p className="text-xs text-content-muted mt-0.5">S3-compatible storage configuration.</p>
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
        )}

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
    </div>
  );
}
