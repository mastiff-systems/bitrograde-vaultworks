/**
 * MAS-762 (child of MAS-752): `?asset=<id>` must survive the AssetBrowser
 * URL-sync effect.
 *
 * getUrlFilters()/pushUrlFilters() used to track a fixed param set that didn't
 * include `asset`, so the mount-time replaceState rebuilt the URL without it —
 * a Logs-tab click-through to /?asset=<id> was silently rewritten to bare `/`
 * even though the detail panel opened fine. The param is now tracked like the
 * others: preserved through mount, restored on refresh, and cleared when the
 * detail panel closes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AssetBrowser } from '../pages/AssetBrowser';

// ─── Hoisted mutable state for context mocks ─────────────────────────────────

const ctxState = vi.hoisted(() => ({ searchQuery: '' }));

// ─── Mock API modules ─────────────────────────────────────────────────────────

vi.mock('../api/client.js', () => ({
  listFiles: vi.fn(),
  listTags: vi.fn(),
  uploadFiles: vi.fn(),
  deleteFile: vi.fn(),
  updateAssetTags: vi.fn(),
  updateFile: vi.fn(),
  getAssetById: vi.fn(),
  listVersions: vi.fn(),
  uploadVersion: vi.fn(),
  getAsset: vi.fn(),
  bulkDelete: vi.fn(),
  bulkDownload: vi.fn(),
  createShareLink: vi.fn(),
  getShareLinks: vi.fn(),
  revokeShareLinks: vi.fn(),
  findAssetByExactName: vi.fn(),
  downloadUrl: vi.fn(() => 'http://test/download'),
  thumbnailUrl: vi.fn(() => 'http://test/thumb'),
  versionDownloadUrl: vi.fn(() => 'http://test/vdownload'),
  versionStreamUrl: vi.fn(() => 'http://test/vstream'),
}));

vi.mock('../api/folders.js', () => ({
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  listFolderAssets: vi.fn(),
  addAssetsToFolder: vi.fn(),
  removeAssetFromFolder: vi.fn(),
  listFoldersForAsset: vi.fn(),
}));

vi.mock('../api/collections.js', () => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  addAssetsToCollection: vi.fn(),
}));

// ─── Mock heavy child components (three.js / pdfjs / wavesurfer imports) ─────

vi.mock('../components/MainSidebar.js', () => ({
  MainSidebar: ({ children }: { children?: React.ReactNode }) => (
    <aside data-testid="main-sidebar">{children}</aside>
  ),
}));
vi.mock('../components/FileViewer/index.js', () => ({
  FileViewer: () => <div data-testid="file-viewer" />,
}));
vi.mock('../components/UploadWizard/index.js', () => ({
  UploadWizard: () => <div data-testid="upload-wizard" />,
}));
vi.mock('../components/Preview3D.js', () => ({
  Preview3D: () => <div data-testid="preview-3d" />,
}));
vi.mock('../components/AudioPreview.js', () => ({
  AudioPreview: () => <div data-testid="audio-preview" />,
}));

// ─── Mock contexts ────────────────────────────────────────────────────────────

vi.mock('../contexts/CategoryContext.js', () => ({
  useCategoryContext: () => ({
    searchQuery: ctxState.searchQuery,
    categories: [],
    selectedCategoryId: null,
    selectedSubcategoryId: null,
    setSearchQuery: vi.fn(),
    setSelectedCategoryId: vi.fn(),
    setSelectedSubcategoryId: vi.fn(),
  }),
}));

vi.mock('../contexts/UploadContext.js', () => ({
  useUpload: () => ({
    showWizard: false,
    uploading: false,
    progress: 0,
    openWizard: vi.fn(),
    closeWizard: vi.fn(),
    setProgress: vi.fn(),
    setUploading: vi.fn(),
  }),
}));

import * as clientApi from '../api/client.js';
import * as foldersApi from '../api/folders.js';
import * as collectionsApi from '../api/collections.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAsset(id: string, name: string): clientApi.Asset {
  return {
    id,
    original_name: name,
    mime_type: 'image/png',
    size_bytes: 100,
    asset_type: 'image',
    thumbnail_key: null,
    description: null,
    uploaded_at: '2026-01-01T00:00:00.000Z',
    tags: [],
    category_id: null,
    subcategory_id: null,
  };
}

function page(data: clientApi.Asset[]) {
  return {
    data,
    total: data.length,
    page: 1,
    limit: 60,
    totalPages: 1,
  } as clientApi.PaginatedFilesResponse;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AssetBrowser ?asset= deep link (MAS-762)', () => {
  const linked = makeAsset('asset-1', 'deep-linked.png');

  beforeEach(() => {
    vi.clearAllMocks();
    ctxState.searchQuery = '';
    vi.mocked(clientApi.listFiles).mockResolvedValue(page([]));
    vi.mocked(clientApi.listTags).mockResolvedValue([]);
    vi.mocked(clientApi.getAssetById).mockResolvedValue(linked);
    // AssetDetailModal fetches these on mount
    vi.mocked(clientApi.getAsset).mockResolvedValue(linked);
    vi.mocked(clientApi.listVersions).mockResolvedValue([]);
    vi.mocked(clientApi.getShareLinks).mockResolvedValue([]);
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    vi.mocked(foldersApi.listFoldersForAsset).mockResolvedValue([]);
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([]);
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('preserves ?asset= through the mount-time URL sync and opens the detail panel', async () => {
    window.history.replaceState(null, '', '/?asset=asset-1');
    render(<AssetBrowser initialDetailAssetId="asset-1" />);

    // Detail panel opens from the deep link (refresh-safe path)
    await waitFor(() => expect(clientApi.getAssetById).toHaveBeenCalledWith('asset-1'));
    await waitFor(() => expect(screen.getByText('deep-linked.png')).toBeInTheDocument());

    // The mount-time replaceState must NOT have dropped the param
    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    expect(new URLSearchParams(window.location.search).get('asset')).toBe('asset-1');
  });

  it('keeps ?asset= alongside existing tracked params', async () => {
    window.history.replaceState(null, '', '/?folder=folder-1&asset=asset-1');
    render(<AssetBrowser initialDetailAssetId="asset-1" />);

    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    // Existing param behavior unchanged…
    expect(clientApi.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1' }),
    );
    // …and both params survive the rebuild
    const p = new URLSearchParams(window.location.search);
    expect(p.get('folder')).toBe('folder-1');
    expect(p.get('asset')).toBe('asset-1');
  });

  it('removes ?asset= from the URL when the detail panel is closed', async () => {
    window.history.replaceState(null, '', '/?asset=asset-1');
    render(<AssetBrowser initialDetailAssetId="asset-1" />);

    await waitFor(() => expect(screen.getByText('deep-linked.png')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('asset')).toBeNull(),
    );
    expect(screen.queryByText('deep-linked.png')).not.toBeInTheDocument();
  });

  it('does not add ?asset= when no deep link is present', async () => {
    window.history.replaceState(null, '', '/');
    render(<AssetBrowser />);

    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    expect(clientApi.getAssetById).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('asset')).toBeNull();
  });
});
