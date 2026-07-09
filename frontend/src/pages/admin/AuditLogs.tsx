import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs } from '../../api/admin.js';
import type { AuditAction, AuditLogEntry } from '../../api/admin.js';

const ACTION_STYLES: Record<AuditAction, string> = {
  UPLOAD:          'bg-blue-500/15 text-blue-400',
  DOWNLOAD:        'bg-green-500/15 text-green-400',
  VIEW:            'bg-surface-4 text-content-secondary',
  UPDATE:          'bg-yellow-500/15 text-yellow-400',
  UPDATE_METADATA: 'bg-yellow-500/15 text-yellow-400',
  DELETE:          'bg-danger/15 text-danger',
  SHARE:           'bg-purple-500/15 text-purple-400',
  REVOKE_SHARE:    'bg-orange-500/15 text-orange-400',
};

const ACTIONS: AuditAction[] = [
  'UPLOAD', 'DOWNLOAD', 'VIEW', 'UPDATE', 'UPDATE_METADATA', 'DELETE', 'SHARE', 'REVOKE_SHARE',
];

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function AuditLogs({ onNavigateToAsset }: { onNavigateToAsset?: (assetId: string) => void } = {}) {
  const [rows, setRows]             = useState<AuditLogEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [action, setAction]         = useState<AuditAction | ''>('');
  const [from, setFrom]             = useState('');
  const [to, setTo]                 = useState('');
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditLogs({
        action:    action || undefined,
        startDate: from ? new Date(from).toISOString() : undefined,
        endDate:   to   ? new Date(to).toISOString()   : undefined,
        page: p,
      });
      setRows(res.data);
      setTotalPages(res.totalPages);
    } catch {
      setError('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [action, from, to]);

  useEffect(() => {
    setPage(1);
    load(1);
  }, [load]);

  const handleNext = () => {
    if (page >= totalPages) return;
    const next = page + 1;
    setPage(next);
    load(next);
  };

  const handlePrev = () => {
    if (page <= 1) return;
    const prev = page - 1;
    setPage(prev);
    load(prev);
  };

  return (
    <div className="flex-1 p-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-subtitle">Track asset access and modifications</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | '')}
          className="input-field text-sm h-9 px-3 min-w-[160px]"
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <label className="text-xs text-content-secondary whitespace-nowrap">From</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input-field text-sm h-9 px-3"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-content-secondary whitespace-nowrap">To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input-field text-sm h-9 px-3"
          />
        </div>

        {(action || from || to) && (
          <button
            onClick={() => { setAction(''); setFrom(''); setTo(''); }}
            className="btn-secondary btn-sm"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Asset</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-content-muted py-12">
                      No audit log entries found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td className="text-content-secondary text-sm whitespace-nowrap">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="text-content-primary text-sm">
                        {row.user?.email ?? <span className="text-content-muted italic">deleted user</span>}
                      </td>
                      <td>
                        <span className={`badge text-xs font-semibold uppercase tracking-wide ${ACTION_STYLES[row.action]}`}>
                          {row.action}
                        </span>
                      </td>
                      <td className="text-sm">
                        {row.asset ? (
                          <button
                            onClick={() => row.assetId && onNavigateToAsset?.(row.assetId)}
                            className="text-accent-light font-medium hover:underline text-left"
                          >
                            {row.asset.originalName}
                          </button>
                        ) : (
                          <span className="text-content-muted italic">deleted asset</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-content-muted">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={page <= 1}
                className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                onClick={handleNext}
                disabled={page >= totalPages}
                className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
