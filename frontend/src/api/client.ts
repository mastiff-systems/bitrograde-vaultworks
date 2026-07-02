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
  category_id?: string | null;
  subcategory_id?: string | null;
  license?: string | null;
  resolution_w?: number | null;
  resolution_h?: number | null;
  duration_seconds?: number | null;
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
  categoryId?: string;
  subcategoryId?: string;
  format?: string;
  limit?: number;
}

export async function listFiles(params?: ListFilesParams): Promise<Asset[]> {
  const p: Record<string, string> = {};
  if (params?.q) p.q = params.q;
  if (params?.assetType) p.assetType = params.assetType;
  if (params?.mimeType) p.mimeType = params.mimeType;
  if (params?.categoryId) p.categoryId = params.categoryId;
  if (params?.subcategoryId) p.subcategoryId = params.subcategoryId;
  if (params?.format) p.format = params.format;
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

export async function uploadWithMetadata(
  file: File,
  meta: {
    categoryId?: string | null;
    subcategoryId?: string | null;
    license?: string | null;
    description?: string;
    tags?: string[];
    resolutionW?: number | null;
    resolutionH?: number | null;
    durationSeconds?: number | null;
  },
  onProgress?: (pct: number) => void,
): Promise<Asset> {
  const form = new FormData();
  form.append('files', file, file.name);
  if (meta.categoryId) form.append('category_id', meta.categoryId);
  if (meta.subcategoryId) form.append('subcategory_id', meta.subcategoryId);
  if (meta.license) form.append('license', meta.license);
  if (meta.description?.trim()) form.append('description', meta.description.trim());
  if (meta.tags && meta.tags.length > 0) form.append('tags', JSON.stringify(meta.tags));
  if (meta.resolutionW != null) form.append('resolution_w', String(meta.resolutionW));
  if (meta.resolutionH != null) form.append('resolution_h', String(meta.resolutionH));
  if (meta.durationSeconds != null) form.append('duration_seconds', String(meta.durationSeconds));
  const { data } = await api.post<Asset[]>('/api/upload', form, {
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data[0];
}

export interface UpdateFilePayload {
  name?: string;
  description?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  tags?: string[];
}

export async function getAssetById(id: string): Promise<Asset> {
  const { data } = await api.get<Asset>(`/api/files/${id}`);
  return data;
}

export async function updateFile(id: string, payload: UpdateFilePayload): Promise<Asset> {
  const { data } = await api.patch<Asset>(`/api/files/${id}`, payload);
  return data;
}

export async function deleteFile(id: string): Promise<void> {
  await api.delete(`/api/files/${id}`);
}

export interface BulkDeleteResult {
  deleted: string[];
  errors: { id: string; reason: string }[];
}

export async function bulkDelete(ids: string[]): Promise<BulkDeleteResult> {
  const { data } = await api.post<BulkDeleteResult>('/api/files/bulk-delete', { ids });
  return data;
}

export async function bulkDownload(ids: string[]): Promise<void> {
  const resp = await api.post('/api/files/bulk-download', { ids }, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'assets.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

function withToken(path: string): string {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

export function versionDownloadUrl(assetId: string, versionId: string): string {
  return withToken(`/api/files/${assetId}/versions/${versionId}/download`);
}

export function downloadUrl(id: string): string {
  return withToken(`/api/files/${id}/download`);
}

export function streamUrl(id: string): string {
  return withToken(`/api/files/${id}/stream`);
}

export function thumbnailUrl(id: string): string {
  return withToken(`/api/files/${id}/thumbnail`);
}
