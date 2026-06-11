import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../contexts/NotificationContext.js';
import type { Notification } from '../api/notifications.js';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const typeIcon: Record<string, string> = {
  upload_complete: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  new_asset: 'M12 4v16m8-8H4',
  new_version: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  system: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

interface Props {
  onNavigateDashboard: () => void;
}

export function NotificationBell({ onNavigateDashboard }: Props) {
  const { notifications, unreadCount, markOneRead, markEverythingRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleNotificationClick(n: Notification) {
    if (!n.read) await markOneRead(n.id);
    if (n.resource_id) {
      onNavigateDashboard();
      setOpen(false);
    }
  }

  const recent = notifications.slice(0, 20);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        className="relative flex-shrink-0 p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-surface-4 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-border bg-surface-1 shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-content-primary">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markEverythingRead()}
                className="text-xs text-accent-light hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-content-muted">
                No notifications yet
              </div>
            ) : (
              recent.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`w-full flex gap-3 px-4 py-3 text-left border-b border-border/50 last:border-0 hover:bg-surface-3 transition-colors ${
                    !n.read ? 'bg-accent/5' : ''
                  }`}
                >
                  <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${!n.read ? 'bg-accent/20' : 'bg-surface-3'}`}>
                    <svg className={`w-3.5 h-3.5 ${!n.read ? 'text-accent-light' : 'text-content-muted'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={typeIcon[n.type] ?? typeIcon.system} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-xs font-medium truncate ${!n.read ? 'text-content-primary' : 'text-content-secondary'}`}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-content-muted flex-shrink-0">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-content-muted mt-0.5 truncate">{n.body}</p>
                  </div>
                  {!n.read && <div className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
