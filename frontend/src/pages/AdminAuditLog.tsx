import { useEffect, useRef, useState } from 'react';
import { fetchAuditLogs } from '../api/admin.js';
import type { AuditAction, AuditLogEntry } from '../api/admin.js';
import { useAuth } from '../contexts/AuthContext.js';

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

function formatMetadata(meta: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '—';
  return Object.entries(meta)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

interface Props {
  onNavigateToAsset?: (assetId: string) => void;
}

export function AdminAuditLog({ onNavigateToAsset }: Props = {}) {
  const { user } = useAuth();

  const [rows, setRows]             = useState<AuditLogEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [page, setPage]             = useState(1);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filter applied state (drives fetch)
  const [action, setAction]       = useState<AuditAction | ''>('');
  const [userId, setUserId]       = useState('');
  const [assetId, setAssetId]     = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  // Pending text input state (committed on Enter/blur)
  const [userIdInput, setUserIdInput]   = useState('');
  const [assetIdInput, setAssetIdInput] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  const load = (p: number, opts: {
    action?: AuditAction | '';
    userId?: string;
    assetId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    fetchAuditLogs({
      action:    opts.action    || undefined,
      userId:    opts.userId    || undefined,
      assetId:   opts.assetId   || undefined,
      startDate: opts.startDate ? new Date(opts.startDate).toISOString() : undefined,
      endDate:   opts.endDate   ? new Date(opts.endDate).toISOString()   : undefined,
      page: p,
    }).then((res) => {
      if (ctrl.signal.aborted) return;
      setRows(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setLoading(false);
    }).catch(() => {
      if (ctrl.signal.aborted) return;
      setError('Failed to load audit logs.');
      setLoading(false);
    });
  };

  // Initial load
  useEffect(() => {
    load(1, { action, userId, assetId, startDate, endDate });
    return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, userId, assetId, startDate, endDate]);

  const applyFilter = (overrides: Partial<{
    action: AuditAction | '';
    userId: string;
    assetId: string;
    startDate: string;
    endDate: string;
  }>) => {
    const next = {
      action:    'action'    in overrides ? overrides.action!    : action,
      userId:    'userId'    in overrides ? overrides.userId!    : userId,
      assetId:   'assetId'   in overrides ? overrides.assetId!   : assetId,
      startDate: 'startDate' in overrides ? overrides.startDate! : startDate,
      endDate:   'endDate'   in overrides ? overrides.endDate!   : endDate,
    };
    setPage(1);
    if ('action'    in overrides) setAction(next.action);
    if ('userId'    in overrides) setUserId(next.userId);
    if ('assetId'   in overrides) setAssetId(next.assetId);
    if ('startDate' in overrides) setStartDate(next.startDate);
    if ('endDate'   in overrides) setEndDate(next.endDate);
    load(1, next);
  };

  const commitUserId = () => {
    if (userIdInput !== userId) applyFilter({ userId: userIdInput });
  };
  const commitAssetId = () => {
    if (assetIdInput !== assetId) applyFilter({ assetId: assetIdInput });
  };

  const handleClear = () => {
    setUserIdInput('');
    setAssetIdInput('');
    setPage(1);
    setAction('');
    setUserId('');
    setAssetId('');
    setStartDate('');
    setEndDate('');
    load(1, { action: '', userId: '', assetId: '', startDate: '', endDate: '' });
  };

  const handlePrev = () => {
    if (page <= 1) return;
    const prev = page - 1;
    setPage(prev);
    load(prev, { action, userId, assetId, startDate, endDate });
  };

  const handleNext = () => {
    if (page >= totalPages) return;
    const next = page + 1;
    setPage(next);
    load(next, { action, userId, assetId, startDate, endDate });
  };

  const hasFilters = action || userId || assetId || startDate || endDate;

  if (user?.role !== 'admin') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-content-primary font-semibold text-lg">Access Denied</p>
          <p className="text-content-secondary text-sm mt-1">
            You do not have permission to view audit logs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="page-header mb-6">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-subtitle">Track all asset access and modification events</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Action dropdown */}
        <select
          value={action}
          onChange={(e) => applyFilter({ action: e.target.value as AuditAction | '' })}
          className="input-field text-sm h-9 px-3 min-w-[180px]"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {/* User ID */}
        <input
          type="text"
          placeholder="User ID (UUID)"
          value={userIdInput}
          onChange={(e) => setUserIdInput(e.target.value)}
          onBlur={commitUserId}
          onKeyDown={(e) => e.key === 'Enter' && commitUserId()}
          className="input-field text-sm h-9 px-3 w-56"
          aria-label="Filter by user ID"
        />

        {/* Asset ID */}
        <input
          type="text"
          placeholder="Asset ID (UUID)"
          value={assetIdInput}
          onChange={(e) => setAssetIdInput(e.target.value)}
          onBlur={commitAssetId}
          onKeyDown={(e) => e.key === 'Enter' && commitAssetId()}
          className="input-field text-sm h-9 px-3 w-56"
          aria-label="Filter by asset ID"
        />

        {/* Date range */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-content-secondary whitespace-nowrap">From</label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => applyFilter({ startDate: e.target.value })}
            className="input-field text-sm h-9 px-3"
            aria-label="Start date"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-content-secondary whitespace-nowrap">To</label>
          <input
            type="datetime-local"
            value={endDate}
            onChange={(e) => applyFilter({ endDate: e.target.value })}
            className="input-field text-sm h-9 px-3"
            aria-label="End date"
          />
        </div>

        {hasFilters && (
          <button onClick={handleClear} className="btn-secondary btn-sm">
            Clear filters
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
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Asset Name</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-content-muted py-12">
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
                        {row.user?.email ?? (
                          <span className="text-content-muted italic">deleted user</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge text-xs font-semibold uppercase tracking-wide ${ACTION_STYLES[row.action]}`}>
                          {row.action.replace('_', ' ')}
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
                      <td className="text-xs text-content-muted max-w-xs truncate" title={formatMetadata(row.details)}>
                        {formatMetadata(row.details)}
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
              {total > 0
                ? `${total.toLocaleString()} total • Page ${page} of ${totalPages}`
                : 'No results'}
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
