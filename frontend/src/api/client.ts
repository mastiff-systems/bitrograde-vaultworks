import axios from 'axios';

const TOKEN_KEY = 'vaultworks_token';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear stored token and reload so the auth gate shows
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.reload();
    }
    return Promise.reject(err);
  },
);

export interface Asset {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  asset_type: '3d' | 'audio' | 'image' | 'other';
  thumbnail_key: string | null;
  uploaded_at: string;
}

export async function listFiles(): Promise<Asset[]> {
  const { data } = await api.get<Asset[]>('/api/files');
  return data;
}

export async function uploadFiles(
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<Asset[]> {
  const form = new FormData();
  files.forEach((f) => form.append('files', f, f.name));
  const { data } = await api.post<Asset[]>('/api/upload', form, {
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export async function deleteFile(id: string): Promise<void> {
  await api.delete(`/api/files/${id}`);
}

export function downloadUrl(id: string): string {
  return `/api/files/${id}/download`;
}

export function streamUrl(id: string): string {
  return `/api/files/${id}/stream`;
}

export function thumbnailUrl(id: string): string {
  return `/api/files/${id}/thumbnail`;
}
