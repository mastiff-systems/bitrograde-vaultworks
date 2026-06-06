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
  size_bytes: number | null;
  asset_type: '3d' | 'audio' | 'image' | 'other';
  thumbnail_key: string | null;
  description: string | null;
  uploaded_at: string;
  tags: { id: string; name: string }[];
}

export interface AssetVersion {
  id: string;
  version_number: number;
  size_bytes: number | null;
  mime_type: string | null;
  message: string | null;
  uploaded_at: string;
  uploader: { id: string; email: string } | null;
}

export interface Tag {
  id: string;
  name: string;
  created_at: string;
  asset_count: number;
}

export interface ListFilesParams {
  q?: string;
  tags?: string[];
  assetType?: string;
  mimeType?: string;
  limit?: number;
}

export async function listFiles(params?: ListFilesParams): Promise<Asset[]> {
  const p: Record<string, string> = {};
  if (params?.q) p.q = params.q;
  if (params?.assetType) p.assetType = params.assetType;
  if (params?.mimeType) p.mimeType = params.mimeType;
  if (params?.limit) p.limit = String(params.limit);
  if (params?.tags?.length) p.tags = params.tags.join(',');
  const { data } = await api.get<Asset[]>('/api/files', { params: p });
  return data;
}

export async function listTags(): Promise<Tag[]> {
  const { data } = await api.get<Tag[]>('/api/tags');
  return data;
}

export async function updateAssetTags(id: string, tags: string[]): Promise<{ id: string; name: string }[]> {
  const { data } = await api.put<{ tags: { id: string; name: string }[] }>(`/api/files/${id}/tags`, { tags });
  return data.tags;
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

export async function listVersions(assetId: string): Promise<AssetVersion[]> {
  const { data } = await api.get<AssetVersion[]>(`/api/files/${assetId}/versions`);
  return data;
}

export async function uploadVersion(
  assetId: string,
  file: File,
  message?: string,
  onProgress?: (pct: number) => void,
): Promise<AssetVersion> {
  const form = new FormData();
  if (message?.trim()) form.append('message', message.trim());
  form.append('file', file, file.name);
  const { data } = await api.post<AssetVersion>(`/api/files/${assetId}/versions`, form, {
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export function versionDownloadUrl(assetId: string, versionId: string): string {
  return `/api/files/${assetId}/versions/${versionId}/download`;
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
