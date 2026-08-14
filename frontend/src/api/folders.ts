/**
 * MAS-368: Typed async functions for the /api/folders endpoints.
 *
 * Follows the same pattern as client.ts: shared axios instance, no
 * React Query, plain useState+useEffect callers handle errors.
 */
import { api } from './client.js';
import type { Asset } from './client.js';

export interface Folder {
  id: string;
  name: string;
  description: string | null;
  parent_folder_id: string | null;
  created_by_user_id: string | null;
  asset_count: number;
  created_at: string;
  updated_at: string;
}

export interface FolderAssetsPage {
  assets: Asset[];
  nextCursor: string | null;
}

/** List folders. Pass `parentFolderId: 'root'` for top-level only. */
export async function listFolders(params?: { parentFolderId?: string }): Promise<Folder[]> {
  const p: Record<string, string> = {};
  if (params?.parentFolderId) p.parentFolderId = params.parentFolderId;
  const { data } = await api.get<Folder[]>('/api/folders', { params: p });
  return data;
}

export async function createFolder(body: {
  name: string;
  description?: string;
  parentFolderId?: string;
}): Promise<Folder> {
  const { data } = await api.post<Folder>('/api/folders', body);
  return data;
}

export async function updateFolder(
  id: string,
  body: { name?: string; description?: string | null; parentFolderId?: string | null },
): Promise<Folder> {
  const { data } = await api.patch<Folder>(`/api/folders/${id}`, body);
  return data;
}

export async function deleteFolder(id: string): Promise<void> {
  await api.delete(`/api/folders/${id}`);
}

export async function listFolderAssets(
  folderId: string,
  params?: { limit?: number; cursor?: string },
): Promise<FolderAssetsPage> {
  const p: Record<string, string> = {};
  if (params?.limit) p.limit = String(params.limit);
  if (params?.cursor) p.cursor = params.cursor;
  const { data } = await api.get<FolderAssetsPage>(`/api/folders/${folderId}/assets`, { params: p });
  return data;
}

export async function addAssetsToFolder(folderId: string, assetIds: string[]): Promise<{ added: number }> {
  const { data } = await api.post<{ added: number }>(`/api/folders/${folderId}/assets`, { assetIds });
  return data;
}

export async function removeAssetFromFolder(folderId: string, assetId: string): Promise<void> {
  await api.delete(`/api/folders/${folderId}/assets/${assetId}`);
}
