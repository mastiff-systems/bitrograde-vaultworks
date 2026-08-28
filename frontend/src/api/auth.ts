import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

export interface AuthUser {
  userId: string;
  email: string;
  role?: 'admin' | 'user';
  mustChangePassword?: boolean;
}

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; role?: 'admin' | 'user'; mustChangePassword?: boolean };
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/api/auth/register', { email, password });
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/api/auth/login', { email, password });
  return data;
}

export async function fetchMe(token: string): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>('/api/auth/forgot-password', { email });
  return data;
}

export async function resetPassword(token: string, password: string): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>('/api/auth/reset-password', { token, password });
  return data;
}

/** Change the current user's password. Exempt from the mustChangePassword 403 gate. */
export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>(
    '/api/auth/change-password',
    { currentPassword, newPassword },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data;
}
