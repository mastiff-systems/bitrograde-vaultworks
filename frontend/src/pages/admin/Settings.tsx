import { useEffect, useState } from 'react';
import { fetchStats } from '../../api/admin.js';
import type { AdminStats } from '../../api/admin.js';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

export function AdminSettings() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then((st) => setStats(st))
      .catch(() => setError('Failed to load stats.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">General server configuration and usage overview</p>
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

      {error && (
        <div className="px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
      )}

      {!loading && !error && (
        <div className="max-w-2xl">
          <p className="text-sm text-content-secondary">
            Storage configuration has moved to the{' '}
            <strong className="text-content-primary">Storage</strong> tab.
            General settings (upload size limit, app name, etc.) will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
