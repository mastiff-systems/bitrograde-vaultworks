import { useState } from 'react';
import { AdminSettings } from './Settings.js';
import { AdminUsers } from './Users.js';
import { TaxonomyManager } from './TaxonomyManager.js';
import { AuditLogs } from './AuditLogs.js';

type AdminTab = 'settings' | 'taxonomy' | 'users' | 'audit-logs';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'taxonomy', label: 'Taxonomy' },
  { id: 'users', label: 'Users' },
  { id: 'audit-logs', label: 'Audit Logs' },
];

export function AdminPanel({ onNavigateToAsset }: { onNavigateToAsset?: (assetId: string) => void } = {}) {
  const [tab, setTab] = useState<AdminTab>('settings');

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar */}
      <div className="flex-shrink-0 border-b border-border bg-surface-1 px-8 pt-6 pb-0">
        <h1 className="page-title mb-4">Admin</h1>
        <nav className="flex gap-0.5" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.id
                  ? 'text-accent border-accent bg-accent/5'
                  : 'text-content-secondary border-transparent hover:text-content-primary hover:border-border'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'settings' && <AdminSettings />}
        {tab === 'taxonomy' && <TaxonomyManager />}
        {tab === 'users' && <AdminUsers />}
        {tab === 'audit-logs' && <AuditLogs onNavigateToAsset={onNavigateToAsset} />}
      </div>
    </div>
  );
}
