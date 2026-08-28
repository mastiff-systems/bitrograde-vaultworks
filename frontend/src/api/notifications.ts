import axios from 'axios';
import { isPasswordChangeRequired, emitPasswordChangeRequired } from './passwordGate.js';

const TOKEN_KEY = 'vaultworks_token';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.reload();
    }
    if (isPasswordChangeRequired(err)) emitPasswordChangeRequired();
    return Promise.reject(err);
  },
);

export interface Notification {
  id: string;
  user_id: string;
  type: 'upload_complete' | 'new_asset' | 'new_version' | 'system';
  title: string;
  body: string;
  resource_id: string | null;
  read: boolean;
  created_at: string;
}

export async function listNotifications(): Promise<Notification[]> {
  const { data } = await api.get<Notification[]>('/api/notifications');
  return data;
}

export async function markRead(id: string): Promise<Notification> {
  const { data } = await api.patch<Notification>(`/api/notifications/${id}/read`);
  return data;
}

export async function markAllRead(): Promise<void> {
  await api.patch('/api/notifications/read-all');
}

export function sseUrl(): string {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const base = import.meta.env.VITE_API_URL ?? '';
  return `${base}/api/notifications/stream?token=${encodeURIComponent(token)}`;
}
