/**
 * MAS-721 (child of MAS-719): folder view must keep collection/tag/search
 * filters.
 *
 * The asset browser used to branch to `listFolderAssets()` whenever a folder
 * was active, silently dropping q / tags / collectionId. It must now ALWAYS
 * fetch through `listFiles()` (GET /api/files), passing `folderId` so the
 * backend composes all filters in one query — and folder view gets real
 * pagination back.
 *
 * Initial filter state is driven by URL params (getUrlFilters), so each test
 * seeds window.location via history.replaceState before rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function emptyPage(overrides: Partial<clientApi.PaginatedFilesResponse> = {}) {
  return {
    data: [],
    total: 0,
    page: 1,
    limit: 60,
    totalPages: 1,
    ...overrides,
  } as clientApi.PaginatedFilesResponse;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AssetBrowser folder view filter composition (MAS-721)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctxState.searchQuery = '';
    vi.mocked(clientApi.listFiles).mockResolvedValue(emptyPage());
    vi.mocked(clientApi.listTags).mockResolvedValue([]);
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([]);
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('folder + collection state calls listFiles with both folderId and collectionId', async () => {
    window.history.replaceState(null, '', '/?folder=folder-1&collection=col-1');
    render(<AssetBrowser />);

    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    expect(clientApi.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1', collectionId: 'col-1', page: 1 }),
    );
    // The old branch must be gone: the folder endpoint is never used for listing.
    expect(foldersApi.listFolderAssets).not.toHaveBeenCalled();
  });

  it('folder + search + tag compose into a single listFiles call', async () => {
    ctxState.searchQuery = 'logo';
    window.history.replaceState(null, '', '/?folder=folder-1&q=logo&tag=red');
    render(<AssetBrowser />);

    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    expect(clientApi.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1', q: 'logo', tags: ['red'] }),
    );
    expect(foldersApi.listFolderAssets).not.toHaveBeenCalled();
  });

  it('folder view with no other filters passes only folderId; all-assets view omits it', async () => {
    window.history.replaceState(null, '', '/?folder=folder-1');
    const { unmount } = render(<AssetBrowser />);

    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    expect(clientApi.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1', collectionId: undefined, q: undefined }),
    );

    unmount();
    vi.mocked(clientApi.listFiles).mockClear();

    window.history.replaceState(null, '', '/');
    render(<AssetBrowser />);
    await waitFor(() => expect(clientApi.listFiles).toHaveBeenCalled());
    expect(clientApi.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: undefined }),
    );
  });

  it('pagination controls render in folder view when results exceed a page', async () => {
    vi.mocked(clientApi.listFiles).mockResolvedValue(
      emptyPage({ total: 120, totalPages: 3 }),
    );
    window.history.replaceState(null, '', '/?folder=folder-1');
    render(<AssetBrowser />);

    await waitFor(() => {
      expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    });
  });
});
