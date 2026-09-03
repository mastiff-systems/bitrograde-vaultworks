/**
 * MAS-726: Select All/None on the filtered visible set + Bulk Edit
 * (Category/Collection/Tags).
 *
 * - The "All (N)" checkbox appears only in selection mode, targets `displayed`
 *   (the filtered/sorted visible set), and toggles between select-all and none.
 * - The selection is pruned when a filter change hides selected assets — a bulk
 *   edit must never touch assets the user can no longer see.
 * - The Bulk Edit modal sends one bulk-update call with the selected ids and
 *   only the touched fields, then refetches and exits selection mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AssetBrowser } from '../pages/AssetBrowser';

const ctxState = vi.hoisted(() => ({ searchQuery: '' }));

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
  bulkUpdate: vi.fn(),
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
  removeAssetsFromFolder: vi.fn(),
  listFoldersForAsset: vi.fn(),
}));

vi.mock('../api/collections.js', () => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  addAssetsToCollection: vi.fn(),
  removeAssetsFromCollection: vi.fn(),
}));

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

vi.mock('../contexts/CategoryContext.js', () => ({
  useCategoryContext: () => ({
    searchQuery: ctxState.searchQuery,
    categories: [
      {
        id: 'cat-1',
        name: 'Textures',
        slug: 'textures',
        allowed_mime_types: [],
        created_at: '',
        updated_at: '',
        asset_count: 0,
        subcategories: [
          { id: 'sub-1', name: 'Wood', slug: 'wood', asset_count: 0 },
        ],
      },
    ],
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
import * as collectionsApi from '../api/collections.js';
import * as foldersApi from '../api/folders.js';

function makeAsset(id: string, name: string, tags: string[] = []): clientApi.Asset {
  return {
    id,
    original_name: name,
    mime_type: 'image/png',
    size_bytes: 100,
    asset_type: 'image',
    thumbnail_key: null,
    description: null,
    uploaded_at: '2026-01-01T00:00:00.000Z',
    tags: tags.map((t) => ({ id: `tag-${t}`, name: t })),
    category_id: null,
    subcategory_id: null,
  };
}

function makeFolder(id: string, name: string): foldersApi.Folder {
  return {
    id,
    name,
    description: null,
    parent_folder_id: null,
    created_by_user_id: null,
    asset_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
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

async function enterSelectionMode() {
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
}

describe('AssetBrowser bulk select-all + bulk edit (MAS-726)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctxState.searchQuery = '';
    vi.mocked(clientApi.listFiles).mockResolvedValue(page([]));
    vi.mocked(clientApi.listTags).mockResolvedValue([]);
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([]);
    vi.mocked(collectionsApi.addAssetsToCollection).mockResolvedValue(undefined);
    vi.mocked(collectionsApi.removeAssetsFromCollection).mockResolvedValue({ removed: 0 });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    vi.mocked(foldersApi.addAssetsToFolder).mockResolvedValue({ added: 1 });
    vi.mocked(foldersApi.removeAssetsFromFolder).mockResolvedValue({ removed: 1 });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('shows the All (N) checkbox only in selection mode and selects/deselects the whole visible set', async () => {
    const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png'), makeAsset('a3', 'three.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    expect(screen.queryByLabelText(/select all/i)).not.toBeInTheDocument();

    await enterSelectionMode();
    const selectAll = screen.getByLabelText('Select all 3 visible assets') as HTMLInputElement;
    expect(selectAll.checked).toBe(false);

    fireEvent.click(selectAll);
    expect(screen.getByText('3 assets selected')).toBeInTheDocument();
    expect(selectAll.checked).toBe(true);

    // Toggling again clears the selection (Select None)
    fireEvent.click(selectAll);
    expect(screen.queryByText(/assets selected/)).not.toBeInTheDocument();
  });

  it('is indeterminate when only part of the visible set is selected', async () => {
    const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    // Select just one card via its overlay checkbox (w-5 = card overlay size;
    // excludes the select-all checkbox and sidebar filter checkboxes)
    const cardCheckboxes = screen.getAllByRole('checkbox').filter((c) => c.className.includes('w-5'));
    expect(cardCheckboxes).toHaveLength(2);
    fireEvent.click(cardCheckboxes[0]);
    await waitFor(() => expect(screen.getByText('1 asset selected')).toBeInTheDocument());

    const selectAll = screen.getByLabelText('Select all 2 visible assets') as HTMLInputElement;
    await waitFor(() => expect(selectAll.indeterminate).toBe(true));
    expect(selectAll.checked).toBe(false);
  });

  it('prunes the selection when a filter change hides selected assets', async () => {
    const all = [makeAsset('a1', 'one.png', ['red']), makeAsset('a2', 'two.png', ['blue'])];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(all));
    vi.mocked(clientApi.listTags).mockResolvedValue([
      { id: 'tag-red', name: 'red', asset_count: 1 } as clientApi.Tag,
      { id: 'tag-blue', name: 'blue', asset_count: 1 } as clientApi.Tag,
    ]);
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 2 visible assets'));
    expect(screen.getByText('2 assets selected')).toBeInTheDocument();

    // Applying the 'red' tag filter refetches and only a1 stays visible
    vi.mocked(clientApi.listFiles).mockResolvedValue(page([all[0]]));
    fireEvent.click(screen.getByRole('checkbox', { name: /red/i }));

    await waitFor(() => expect(screen.queryByText('two.png')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('1 asset selected')).toBeInTheDocument());
  });

  it('bulk-edits the selected assets: one bulkUpdate call with only touched fields, then refetch + exit', async () => {
    const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    vi.mocked(clientApi.bulkUpdate).mockResolvedValue({ updated: ['a1', 'a2'], errors: [] });
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 2 visible assets'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    await waitFor(() => expect(screen.getByText('Bulk Edit — 2 assets')).toBeInTheDocument());

    // Category: pick Textures + Wood
    const selects = screen.getAllByRole('combobox');
    const categorySelect = selects.find((s) => (s as HTMLSelectElement).options[0]?.text === 'Leave unchanged') as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: 'cat-1' } });
    const subSelect = screen.getAllByRole('combobox').find((s) => (s as HTMLSelectElement).options[0]?.text === 'No subcategory') as HTMLSelectElement;
    fireEvent.change(subSelect, { target: { value: 'sub-1' } });

    // Tags: add 'hero', remove 'draft'
    const inputs = screen.getAllByPlaceholderText('Type a tag and press Enter…');
    fireEvent.change(inputs[0], { target: { value: 'hero' } });
    fireEvent.keyDown(inputs[0], { key: 'Enter' });
    fireEvent.change(inputs[1], { target: { value: 'draft' } });
    fireEvent.keyDown(inputs[1], { key: 'Enter' });

    const listCallsBefore = vi.mocked(clientApi.listFiles).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /apply to 2 assets/i }));

    await waitFor(() => expect(clientApi.bulkUpdate).toHaveBeenCalledTimes(1));
    expect(clientApi.bulkUpdate).toHaveBeenCalledWith(
      expect.arrayContaining(['a1', 'a2']),
      { categoryId: 'cat-1', subcategoryId: 'sub-1', addTags: ['hero'], removeTags: ['draft'] },
    );

    // Modal closed, selection mode exited, success toast shown, assets refetched
    await waitFor(() => expect(screen.queryByText('Bulk Edit — 2 assets')).not.toBeInTheDocument());
    expect(screen.getByText('2 assets updated.')).toBeInTheDocument();
    expect(screen.queryByText('2 assets selected')).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(clientApi.listFiles).mock.calls.length).toBeGreaterThan(listCallsBefore));
  });

  it('applies collection add/remove marks via the collection endpoints', async () => {
    const assets = [makeAsset('a1', 'one.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([
      { id: 'col-1', name: 'Winter', description: null, asset_count: 0, preview_asset: null, created_at: '', updated_at: '' },
      { id: 'col-2', name: 'Summer', description: null, asset_count: 1, preview_asset: null, created_at: '', updated_at: '' },
    ]);
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 1 visible assets'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.getByText('Winter')).toBeInTheDocument());

    // Add to Winter, remove from Summer — no metadata changes at all
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[0]);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: /apply to 1 asset/i }));

    await waitFor(() => expect(collectionsApi.addAssetsToCollection).toHaveBeenCalledWith('col-1', ['a1']));
    expect(collectionsApi.removeAssetsFromCollection).toHaveBeenCalledWith('col-2', ['a1']);
    expect(clientApi.bulkUpdate).not.toHaveBeenCalled();
  });

  it('applies folder add/remove marks via the folder endpoints (MAS-834)', async () => {
    const assets = [makeAsset('a1', 'one.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    vi.mocked(foldersApi.listFolders).mockResolvedValue([
      makeFolder('f1', 'Renders'),
      makeFolder('f2', 'Archive'),
    ]);
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 1 visible assets'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.getByText('Renders')).toBeInTheDocument());

    // Add to Renders, remove from Archive — no metadata changes, no collections
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[0]);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: /apply to 1 asset/i }));

    await waitFor(() => expect(foldersApi.addAssetsToFolder).toHaveBeenCalledWith('f1', ['a1']));
    expect(foldersApi.removeAssetsFromFolder).toHaveBeenCalledWith('f2', ['a1']);
    expect(clientApi.bulkUpdate).not.toHaveBeenCalled();
    expect(collectionsApi.addAssetsToCollection).not.toHaveBeenCalled();
  });

  it('"Remove from all folders" is opt-in and strips membership from every folder, superseding marks', async () => {
    const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    vi.mocked(foldersApi.listFolders).mockResolvedValue([
      makeFolder('f1', 'Renders'),
      makeFolder('f2', 'Archive'),
      makeFolder('f3', 'WIP'),
    ]);
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 2 visible assets'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.getByText('Renders')).toBeInTheDocument());

    // Mark an Add first, then opt into the full reset — the mark must be superseded
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: /remove from all folders/i }));

    fireEvent.click(screen.getByRole('button', { name: /apply to 2 assets/i }));

    await waitFor(() => expect(foldersApi.removeAssetsFromFolder).toHaveBeenCalledTimes(3));
    expect(foldersApi.removeAssetsFromFolder).toHaveBeenCalledWith('f1', ['a1', 'a2']);
    expect(foldersApi.removeAssetsFromFolder).toHaveBeenCalledWith('f2', ['a1', 'a2']);
    expect(foldersApi.removeAssetsFromFolder).toHaveBeenCalledWith('f3', ['a1', 'a2']);
    expect(foldersApi.addAssetsToFolder).not.toHaveBeenCalled();
  });

  it('does not touch folder membership when folders are left unmarked (non-destructive default)', async () => {
    const assets = [makeAsset('a1', 'one.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    vi.mocked(clientApi.bulkUpdate).mockResolvedValue({ updated: ['a1'], errors: [] });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([makeFolder('f1', 'Renders')]);
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 1 visible assets'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.getByText('Renders')).toBeInTheDocument());

    // Only a tag change — folder section untouched
    const addInput = screen.getAllByPlaceholderText('Type a tag and press Enter…')[0];
    fireEvent.change(addInput, { target: { value: 'hero' } });
    fireEvent.keyDown(addInput, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /apply to 1 asset/i }));

    await waitFor(() => expect(clientApi.bulkUpdate).toHaveBeenCalledTimes(1));
    expect(foldersApi.addAssetsToFolder).not.toHaveBeenCalled();
    expect(foldersApi.removeAssetsFromFolder).not.toHaveBeenCalled();
  });

  it('surfaces partial failures in the summary toast', async () => {
    const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png')];
    vi.mocked(clientApi.listFiles).mockResolvedValue(page(assets));
    vi.mocked(clientApi.bulkUpdate).mockResolvedValue({
      updated: ['a1'],
      errors: [{ id: 'a2', reason: 'Unauthorized' }],
    });
    render(<AssetBrowser />);
    await waitFor(() => expect(screen.getByText('one.png')).toBeInTheDocument());

    await enterSelectionMode();
    fireEvent.click(screen.getByLabelText('Select all 2 visible assets'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.getByText('Bulk Edit — 2 assets')).toBeInTheDocument());

    const addInput = screen.getAllByPlaceholderText('Type a tag and press Enter…')[0];
    fireEvent.change(addInput, { target: { value: 'x' } });
    fireEvent.keyDown(addInput, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /apply to 2 assets/i }));

    await waitFor(() => expect(screen.getByText('1 updated; 1 failed.')).toBeInTheDocument());
  });
});
