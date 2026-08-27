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

export type AuditAction =
  | 'UPLOAD' | 'DOWNLOAD' | 'VIEW' | 'UPDATE' | 'DELETE'
  | 'SHARE' | 'REVOKE_SHARE' | 'UPDATE_METADATA'
  | 'LOGIN' | 'LOGOUT' | 'RESTORE';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  asset_id: string | null;
  asset_name: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogsResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  logs: AuditLogEntry[];
}

export interface AuditLogsParams {
  page?: number;
  action?: AuditAction;
  userId?: string;
  from?: string;
  to?: string;
}

export async function fetchAuditLogs(params?: AuditLogsParams): Promise<AuditLogsResponse> {
  const p: Record<string, string> = {};
  if (params?.page) p.page = String(params.page);
  if (params?.action) p.action = params.action;
  if (params?.userId) p.userId = params.userId;
  if (params?.from) p.from = params.from;
  if (params?.to) p.to = params.to;
  const { data } = await api.get<AuditLogsResponse>('/api/admin/audit-logs', { params: p });
  return data;
}

export interface AuditUser {
  id: string;
  email: string;
  name: string | null;
}

export async function fetchAuditUsers(): Promise<AuditUser[]> {
  const { data } = await api.get<AuditUser[]>('/api/admin/audit-users');
  return data;
}
