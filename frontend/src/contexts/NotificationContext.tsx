import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from './AuthContext.js';
import { listNotifications, markRead, markAllRead, sseUrl, type Notification } from '../api/notifications.js';

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  markOneRead: (id: string) => Promise<void>;
  markEverythingRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // Load initial list
  useEffect(() => {
    if (!token) return;
    listNotifications().then(setNotifications).catch(() => {});
  }, [token]);

  // SSE for real-time pushes
  useEffect(() => {
    if (!token) return;

    const url = sseUrl();
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const incoming: Notification & { type: string } = JSON.parse(e.data);
        // Ignore the connection-ack event
        if ((incoming as { type?: string }).type === 'connected') return;
        setNotifications((prev) => [incoming, ...prev]);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [token]);

  const markOneRead = useCallback(async (id: string) => {
    const updated = await markRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? updated : n)));
  }, []);

  const markEverythingRead = useCallback(async () => {
    await markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markOneRead, markEverythingRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
