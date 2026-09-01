import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStats, fetchAuditLogs, fetchAuditUsers } from '../../api/admin.js';
import type { AdminStats, AuditLogEntry, AuditLogsParams, AuditAction, AuditUser } from '../../api/admin.js';
import {
  listTrashedFiles,
  listTrashedFolders,
  purgeFile,
  purgeFolder,
  restoreFile,
  restoreFolder,
} from '../../api/client.js';
import type { TrashedAsset, TrashedFolder } from '../../api/client.js';
import { StorageSettings } from './StorageSettings.js';
import { EmailSettings } from './EmailSettings.js';
import { TaxonomyManager } from './TaxonomyManager.js';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const ACTION_BADGE: Record<string, string> = {
  UPLOAD: 'bg-success/10 text-success',
  DELETE: 'bg-danger/10 text-danger',
  UPDATE: 'bg-accent/10 text-accent-light',
  UPDATE_METADATA: 'bg-accent/10 text-accent-light',
  RESTORE: 'bg-accent/10 text-accent-light',
  LOGIN: 'bg-surface-3 text-content-secondary',
  LOGOUT: 'bg-surface-3 text-content-secondary',
};

function actionLabel(action: AuditAction): string {
  const map: Record<AuditAction, string> = {
    UPLOAD: 'Upload', DOWNLOAD: 'Download', VIEW: 'View', UPDATE: 'Update',
    DELETE: 'Delete', SHARE: 'Share', REVOKE_SHARE: 'Revoke share',
    UPDATE_METADATA: 'Update metadata', LOGIN: 'Login', LOGOUT: 'Logout',
    RESTORE: 'Restore', USER_CREATED: 'User created',
  };
  return map[action] ?? action;
}

const AUDIT_ACTIONS: AuditAction[] = [
  'UPLOAD', 'DOWNLOAD', 'VIEW', 'UPDATE', 'DELETE',
  'SHARE', 'REVOKE_SHARE', 'UPDATE_METADATA', 'LOGIN', 'LOGOUT', 'RESTORE', 'USER_CREATED',
];

const ACTIVITY_ACTIONS: AuditAction[] = ['LOGIN', 'LOGOUT', 'UPLOAD', 'DELETE', 'RESTORE', 'UPDATE_METADATA', 'UPDATE'];

// ─── Log Table ──────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: AuditAction }) {
  const cls = ACTION_BADGE[action] ?? 'bg-surface-3 text-content-muted';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {actionLabel(action)}
    </span>
  );
}

interface LogTableProps {
  mode: 'audit' | 'activity';
}

function LogTable({ mode }: LogTableProps) {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('');
  const [userFilter, setUserFilter] = useState('');
  const [users, setUsers] = useState<AuditUser[]>([]);

  const hasFilter = fromDate || toDate || actionFilter || (mode === 'activity' && userFilter);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: AuditLogsParams = { page };
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      if (actionFilter) params.action = actionFilter;
      if (mode === 'activity' && userFilter) params.userId = userFilter;
      const res = await fetchAuditLogs(params);
      setLogs(res.logs);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, fromDate, toDate, actionFilter, userFilter, mode]);

  useEffect(() => {
    if (mode === 'activity') {
      fetchAuditUsers().then(setUsers).catch(() => {});
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  const reset = () => {
    setFromDate('');
    setToDate('');
    setActionFilter('');
    setUserFilter('');
    setPage(1);
  };

  const actions = mode === 'activity' ? ACTIVITY_ACTIONS : AUDIT_ACTIONS;

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <div className="label">From</div>
          <input
            type="date"
            className="input text-sm py-1.5"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
          />
        </div>
        <div>
          <div className="label">To</div>
          <input
            type="date"
            className="input text-sm py-1.5"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
          />
        </div>
        {mode === 'activity' && (
          <div>
            <div className="label">User</div>
            <select
              className="input text-sm py-1.5"
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <div className="label">Action</div>
          <select
            className="input text-sm py-1.5"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value as AuditAction | ''); setPage(1); }}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{actionLabel(a)}</option>
            ))}
          </select>
        </div>
        {hasFilter && (
          <button onClick={reset} className="btn-ghost btn-sm self-end">
            Reset filters
          </button>
        )}
        <span className="text-xs text-content-muted self-end ml-auto">{total} results</span>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Timestamp</th>
              {mode === 'activity' ? <th>Actor</th> : <th>User</th>}
              <th>Action</th>
              <th>File / Target</th>
              <th>IP / Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center">
                  <div className="flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center">
                  <svg className="w-10 h-10 text-content-muted mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm text-content-secondary font-medium">No log entries found</p>
                  {hasFilter && <p className="text-xs text-content-muted mt-1">Try adjusting the filters.</p>}
                </td>
              </tr>
            ) : logs.map((log) => (
              <tr key={log.id} className="hover:bg-surface-1 cursor-default">
                <td className="text-xs text-content-muted tabular-nums whitespace-nowrap">
                  {formatDate(log.created_at)}
                </td>
                <td className="text-sm text-content-primary">
                  {mode === 'activity' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-6 h-6 rounded-full bg-accent/20 text-accent-light text-[10px] flex items-center justify-center flex-shrink-0 font-semibold">
                        {(log.user_name ?? log.user_email ?? '?')[0].toUpperCase()}
                      </span>
                      {log.user_name ?? log.user_email ?? '—'}
                    </span>
                  ) : (
                    log.user_email ?? '—'
                  )}
                </td>
                <td><ActionBadge action={log.action} /></td>
                <td className="text-sm text-content-secondary max-w-[200px] truncate">
                  {log.asset_name ? (
                    log.asset_id ? (
                      <button
                        onClick={() => navigate(`/?asset=${log.asset_id}`)}
                        className="text-accent-light font-medium hover:underline text-left truncate max-w-full"
                        title={`Open ${log.asset_name}`}
                      >
                        {log.asset_name}
                      </button>
                    ) : (
                      log.asset_name
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-xs text-content-muted font-mono">
                  {log.ip_address ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3">
          <button
            className="btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span className="text-xs text-content-muted">Page {page} of {totalPages}</span>
          <button
            className="btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Logs Tab ──────────────────────────────────────────────────────────────

function LogsTab() {
  const [subTab, setSubTab] = useState<'audit' | 'activity'>('audit');

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center gap-1.5 mb-6">
        {(['audit', 'activity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              subTab === t
                ? 'bg-accent/10 text-accent border-accent/30'
                : 'text-content-secondary border-border/60 bg-surface-1 hover:text-content-primary'
            }`}
          >
            {t === 'audit' ? 'Audit Logs' : 'Activity Logs'}
          </button>
        ))}
      </div>

      <LogTable key={subTab} mode={subTab} />
    </div>
  );
}

// ─── Trash Tab ──────────────────────────────────────────────────────────────

function TrashTab() {
  const [items, setItems] = useState<TrashedAsset[]>([]);
  const [folders, setFolders] = useState<TrashedFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [files, trashedFolders] = await Promise.all([listTrashedFiles(), listTrashedFolders()]);
      setItems(files);
      setFolders(trashedFolders);
    } catch {
      setError('Failed to load trash. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleRestore(item: TrashedAsset) {
    if (actionInProgress) return;
    setActionInProgress(item.id);
    try {
      await restoreFile(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      setError(`Failed to restore "${item.original_name}".`);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handlePurge(item: TrashedAsset) {
    if (actionInProgress) return;
    if (!confirm(`Permanently delete "${item.original_name}"? This removes it from S3 and cannot be undone.`)) return;
    setActionInProgress(item.id);
    try {
      await purgeFile(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      setError(`Failed to permanently delete "${item.original_name}".`);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleFolderRestore(folder: TrashedFolder) {
    if (actionInProgress) return;
    setActionInProgress(folder.id);
    try {
      await restoreFolder(folder.id);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    } catch {
      setError(`Failed to restore folder "${folder.name}".`);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleFolderPurge(folder: TrashedFolder) {
    if (actionInProgress) return;
    const subtree = folder.descendant_count > 0 ? ` and its ${folder.descendant_count} subfolder(s)` : '';
    if (!confirm(`Permanently delete folder "${folder.name}"${subtree}? Files inside are kept in the library, but the folder structure cannot be undone.`)) return;
    setActionInProgress(folder.id);
    try {
      await purgeFolder(folder.id);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    } catch {
      setError(`Failed to permanently delete folder "${folder.name}".`);
    } finally {
      setActionInProgress(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-content-muted">
          Files and folders moved to trash are automatically purged after 30 days. You can restore or permanently delete them here.
        </p>
        <button onClick={load} disabled={loading} className="btn-ghost btn-sm text-xs flex-shrink-0 ml-4">
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg className="w-12 h-12 text-content-muted mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          <p className="text-sm text-content-secondary font-medium">Trash is empty</p>
          <p className="text-xs text-content-muted mt-1">Deleted files and folders will appear here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {folders.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-content-secondary uppercase tracking-wide mb-2">Folders</h3>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Folder</th>
                      <th>Subfolders</th>
                      <th>Deleted</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folders.map((folder) => {
                      const busy = actionInProgress === folder.id;
                      return (
                        <tr key={folder.id} className="hover:bg-surface-1">
                          <td>
                            <div className="flex items-center gap-2 min-w-0">
                              <svg className="w-4 h-4 text-content-muted flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                              </svg>
                              <span className="text-sm text-content-primary truncate max-w-[260px]" title={folder.name}>
                                {folder.name}
                              </span>
                            </div>
                          </td>
                          <td className="text-xs text-content-muted tabular-nums whitespace-nowrap">
                            {folder.descendant_count}
                          </td>
                          <td className="text-xs text-content-muted tabular-nums whitespace-nowrap">
                            {formatDate(folder.deleted_at)}
                          </td>
                          <td className="text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleFolderRestore(folder)}
                                disabled={!!actionInProgress}
                                className="btn-ghost btn-sm text-xs"
                                title="Restore folder and its subfolders"
                              >
                                {busy ? (
                                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                                    </svg>
                                    Restore
                                  </>
                                )}
                              </button>
                              <button
                                onClick={() => handleFolderPurge(folder)}
                                disabled={!!actionInProgress}
                                className="btn-ghost btn-sm text-xs text-danger hover:text-danger"
                                title="Permanently delete folder structure (files are kept)"
                              >
                                {busy ? (
                                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                    Delete permanently
                                  </>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div>
              {folders.length > 0 && (
                <h3 className="text-xs font-semibold text-content-secondary uppercase tracking-wide mb-2">Files</h3>
              )}
              <div className="table-wrapper">
                <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Deleted</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const busy = actionInProgress === item.id;
                return (
                  <tr key={item.id} className="hover:bg-surface-1">
                    <td>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-content-primary truncate max-w-[260px]" title={item.original_name}>
                          {item.original_name}
                        </span>
                        <span className="badge bg-surface-3 text-content-muted flex-shrink-0 text-[10px]">
                          {item.asset_type}
                        </span>
                      </div>
                    </td>
                    <td className="text-xs text-content-muted tabular-nums whitespace-nowrap">
                      {item.size_bytes != null ? formatBytes(item.size_bytes) : '—'}
                    </td>
                    <td className="text-xs text-content-muted tabular-nums whitespace-nowrap">
                      {formatDate(item.deleted_at)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRestore(item)}
                          disabled={!!actionInProgress}
                          className="btn-ghost btn-sm text-xs"
                          title="Restore to library"
                        >
                          {busy ? (
                            <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                              </svg>
                              Restore
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handlePurge(item)}
                          disabled={!!actionInProgress}
                          className="btn-ghost btn-sm text-xs text-danger hover:text-danger"
                          title="Permanently delete from S3"
                        >
                          {busy ? (
                            <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                              Delete permanently
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── About Tab ──────────────────────────────────────────────────────────────

// Single-column key/value layout with room for future rows (git SHA, build
// time, deploy status) as the MAS-730 versioning rollout exposes them.
function AboutTab() {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Version', value: `v${__APP_VERSION__}` },
  ];

  return (
    <div className="max-w-md">
      <div className="card divide-y divide-border/50">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-content-secondary">{row.label}</span>
            <span className="text-sm text-content-primary font-medium tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function AdminSettings() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'storage' | 'email' | 'taxonomy' | 'trash' | 'logs' | 'about'>('storage');

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
        <div className="grid grid-cols-4 gap-3 mb-6">
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

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border mb-6">
        {([
          ['storage', 'Storage'],
          ['email', 'Email'],
          ['taxonomy', 'Taxonomy'],
          ['trash', 'Trash'],
          ['logs', 'Logs'],
          ['about', 'About'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-content-secondary hover:text-content-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Storage tab */}
      {!loading && activeTab === 'storage' && (
        <div>
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
          )}
          <StorageSettings embedded />
        </div>
      )}

      {/* Email tab */}
      {!loading && activeTab === 'email' && <EmailSettings embedded />}

      {/* Taxonomy tab */}
      {!loading && activeTab === 'taxonomy' && <TaxonomyManager embedded />}

      {/* Trash tab */}
      {!loading && activeTab === 'trash' && <TrashTab />}

      {/* Logs tab */}
      {!loading && activeTab === 'logs' && <LogsTab />}

      {/* About tab */}
      {!loading && activeTab === 'about' && <AboutTab />}
    </div>
  );
}
