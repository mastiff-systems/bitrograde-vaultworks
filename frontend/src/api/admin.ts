import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vaultworks_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface AdminStats {
  users: number;
  admins: number;
  assets: number;
  totalSizeBytes: number;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
}

export async function fetchStats(): Promise<AdminStats> {
  const { data } = await api.get<AdminStats>('/api/admin/stats');
  return data;
}

export async function fetchSettings(): Promise<Record<string, string>> {
  const { data } = await api.get<Record<string, string>>('/api/admin/settings');
  return data;
}

export async function updateSettings(settings: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await api.put<Record<string, string>>('/api/admin/settings', settings);
  return data;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const { data } = await api.get<AdminUser[]>('/api/admin/users');
  return data;
}

export async function updateUserRole(id: string, role: 'admin' | 'user'): Promise<AdminUser> {
  const { data } = await api.patch<AdminUser>(`/api/admin/users/${id}/role`, { role });
  return data;
}

export type AuditAction = 'UPLOAD' | 'DOWNLOAD' | 'VIEW' | 'UPDATE' | 'DELETE';

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  assetId: string | null;
  action: AuditAction;
  metadata: Record<string, unknown>;
  createdAt: string;
  user: { email: string } | null;
  asset: { originalName: string } | null;
}

export interface AuditLogsFilters {
  action?: AuditAction;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditLogsResponse {
  data: AuditLogEntry[];
  nextCursor: string | null;
}

export async function fetchAuditLogs(filters: AuditLogsFilters = {}): Promise<AuditLogsResponse> {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.cursor) params.set('cursor', filters.cursor);
  params.set('limit', String(filters.limit ?? 50));
  const { data } = await api.get<AuditLogsResponse>(`/api/admin/audit-logs?${params.toString()}`);
  return data;
}
