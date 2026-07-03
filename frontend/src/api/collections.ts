import axios from 'axios';
import type { Asset } from './client.js';

const TOKEN_KEY = 'vaultworks_token';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
});

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
    return Promise.reject(err);
  },
);

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  asset_count: number;
  preview_asset: { id: string; thumbnailKey: string | null; assetType: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionDetail extends Omit<Collection, 'preview_asset'> {
  assets: (Asset & { added_at: string })[];
}

export async function listCollections(): Promise<Collection[]> {
  const { data } = await api.get<Collection[]>('/api/collections');
  return data;
}

export async function createCollection(name: string, description?: string): Promise<Collection> {
  const { data } = await api.post<Collection>('/api/collections', { name, description });
  return data;
}

export async function getCollection(id: string): Promise<CollectionDetail> {
  const { data } = await api.get<CollectionDetail>(`/api/collections/${id}`);
  return data;
}

export async function updateCollection(
  id: string,
  payload: { name?: string; description?: string | null },
): Promise<Collection> {
  const { data } = await api.patch<Collection>(`/api/collections/${id}`, payload);
  return data;
}

export async function deleteCollection(id: string): Promise<void> {
  await api.delete(`/api/collections/${id}`);
}

export async function addAssetsToCollection(id: string, assetIds: string[]): Promise<void> {
  await api.post(`/api/collections/${id}/assets`, { assetIds });
}

export async function removeAssetFromCollection(id: string, assetId: string): Promise<void> {
  await api.delete(`/api/collections/${id}/assets/${assetId}`);
}
