import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

export interface AuthUser {
  userId: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: { id: string; email: string };
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
