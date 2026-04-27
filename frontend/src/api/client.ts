import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
});

export interface Asset {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  asset_type: '3d' | 'audio' | 'image' | 'other';
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
  const base = import.meta.env.VITE_API_URL ?? '';
  return `${base}/api/files/${id}/download`;
}
