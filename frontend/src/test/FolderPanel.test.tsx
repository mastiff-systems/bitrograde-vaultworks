/**
 * MAS-367: Integration tests for the FolderPanel component.
 *
 * Covers the E2E scenarios from MAS-362:
 *  1. Create folder → appears in sidebar
 *  2. Asset count reflects folder membership
 *  3. Folder selection callback fires (Browse folder)
 *  4. Rename folder → name persists in sidebar
 *  5. Delete folder → removed from sidebar; "All Assets" navigation preserved
 *
 * API calls are mocked via vi.mock so no running server is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderPanel } from '../components/FolderPanel';
import type { Folder } from '../api/folders';

// ─── Mock the folders API module ─────────────────────────────────────────────

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

import * as foldersApi from '../api/folders.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'folder-1',
    name: 'Brand Assets',
    description: null,
    parent_folder_id: null,
    created_by_user_id: null,
    asset_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderPanel(
  activeFolderId: string | null = null,
  onSelectFolder: (id: string | null) => void = vi.fn(),
) {
  return render(
    <FolderPanel activeFolderId={activeFolderId} onSelectFolder={onSelectFolder} />,
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('FolderPanel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: listFolders returns empty list (for root queries)
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    // window.confirm defaults to cancel (false) — override per test as needed
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  // ── 1. Shows "No folders yet" on empty state ──────────────────────────────

  it('shows empty state message when no folders exist', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('No folders yet')).toBeInTheDocument();
    });
  });

  // ── 2. Lists existing folders with asset counts ───────────────────────────

  it('renders loaded folders with name and asset count', async () => {
    const folder = makeFolder({ name: 'Marketing', asset_count: 3 });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([folder]);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Marketing')).toBeInTheDocument();
      // Asset count badge
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  // ── 3. E2E: Create folder → appears in sidebar ───────────────────────────

  it('creates a folder and it appears immediately in the sidebar', async () => {
    const newFolder = makeFolder({ id: 'new-id', name: 'Campaign 2026' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    vi.mocked(foldersApi.createFolder).mockResolvedValue(newFolder);

    renderPanel();

    // Wait for initial load
    await waitFor(() => screen.getByText('No folders yet'));

    // Click "New folder"
    const newFolderBtn = screen.getByRole('button', { name: /new folder/i });
    fireEvent.click(newFolderBtn);

    // Inline input appears
    const input = screen.getByPlaceholderText(/folder name/i);
    expect(input).toBeInTheDocument();

    // Type a name and press Enter
    await userEvent.type(input, 'Campaign 2026');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(foldersApi.createFolder).toHaveBeenCalledWith({ name: 'Campaign 2026' });
      expect(screen.getByText('Campaign 2026')).toBeInTheDocument();
    });

    // "No folders yet" message is gone
    expect(screen.queryByText('No folders yet')).not.toBeInTheDocument();
  });

  it('escaping the new-folder input cancels creation', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);

    renderPanel();
    await waitFor(() => screen.getByText('No folders yet'));

    fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    const input = screen.getByPlaceholderText(/folder name/i);

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
      expect(foldersApi.createFolder).not.toHaveBeenCalled();
    });
  });

  // ── 4. E2E: Asset count badge shows updated count via onRenamed ───────────

  it('asset count badge updates when onRenamed is called with a higher count', async () => {
    // Initial: folder has 0 assets
    const initial = makeFolder({ id: 'f1', name: 'Videos', asset_count: 0 });
    // Rename returns the same folder but with asset_count 2 (API always returns current count)
    const afterRename = makeFolder({ id: 'f1', name: 'Videos (Renamed)', asset_count: 2 });

    vi.mocked(foldersApi.listFolders).mockResolvedValue([initial]);
    vi.mocked(foldersApi.updateFolder).mockResolvedValue(afterRename);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Videos')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    // Trigger a rename — the response includes the updated asset_count
    fireEvent.dblClick(screen.getByText('Videos'));
    await waitFor(() => screen.getByDisplayValue('Videos'));

    const input = screen.getByDisplayValue('Videos');
    await userEvent.clear(input);
    await userEvent.type(input, 'Videos (Renamed)');
    fireEvent.keyDown(input, { key: 'Enter' });

    // After rename, the onRenamed callback updates the folder in state
    // including the new asset_count: 2
    await waitFor(() => {
      expect(screen.getByText('Videos (Renamed)')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  // ── 5. E2E: Browse folder → onSelectFolder fires with correct id ─────────

  it('selecting a folder fires onSelectFolder with the folder id', async () => {
    const folder = makeFolder({ id: 'folder-abc', name: 'Product Photos' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([folder]);
    const onSelect = vi.fn();

    renderPanel(null, onSelect);

    await waitFor(() => screen.getByText('Product Photos'));

    fireEvent.click(screen.getByText('Product Photos'));
    expect(onSelect).toHaveBeenCalledWith('folder-abc');
  });

  it('clicking "All assets" fires onSelectFolder with null', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    const onSelect = vi.fn();

    renderPanel('some-folder-id', onSelect);

    await waitFor(() => screen.getByText('All assets'));

    fireEvent.click(screen.getByText('All assets'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  // ── 6. E2E: Rename folder → name persists in sidebar ────────────────────

  it('double-clicking a folder row opens rename input and PATCH fires on Enter', async () => {
    const original = makeFolder({ id: 'r1', name: 'Old Name' });
    const renamed = makeFolder({ id: 'r1', name: 'New Name' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([original]);
    vi.mocked(foldersApi.updateFolder).mockResolvedValue(renamed);

    renderPanel();
    await waitFor(() => screen.getByText('Old Name'));

    // Double-click the folder name span to enter rename mode
    fireEvent.dblClick(screen.getByText('Old Name'));

    // Rename input should now be focused
    await waitFor(() => {
      const input = screen.getByDisplayValue('Old Name');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('Old Name');

    // Clear and type new name
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(foldersApi.updateFolder).toHaveBeenCalledWith('r1', { name: 'New Name' });
      expect(screen.getByText('New Name')).toBeInTheDocument();
      expect(screen.queryByText('Old Name')).not.toBeInTheDocument();
    });
  });

  it('pressing Escape during rename restores original name without PATCH', async () => {
    const folder = makeFolder({ id: 'esc-1', name: 'Stable Name' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([folder]);

    renderPanel();
    await waitFor(() => screen.getByText('Stable Name'));

    fireEvent.dblClick(screen.getByText('Stable Name'));
    await waitFor(() => screen.getByDisplayValue('Stable Name'));

    const input = screen.getByDisplayValue('Stable Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Changed');
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(foldersApi.updateFolder).not.toHaveBeenCalled();
      expect(screen.getByText('Stable Name')).toBeInTheDocument();
    });
  });

  // ── 7. E2E: Delete folder → removed from sidebar; assets persist ─────────

  it('confirming delete removes the folder from the sidebar list', async () => {
    const folder = makeFolder({ id: 'del-1', name: 'To Be Deleted' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([folder]);
    vi.mocked(foldersApi.deleteFolder).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true); // user confirms

    renderPanel();
    await waitFor(() => screen.getByText('To Be Deleted'));

    // Click the trash icon — aria-label includes folder name
    const deleteBtn = screen.getByRole('button', { name: /delete folder to be deleted/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(foldersApi.deleteFolder).toHaveBeenCalledWith('del-1');
      expect(screen.queryByText('To Be Deleted')).not.toBeInTheDocument();
    });
  });

  it('cancelling the delete dialog leaves the folder in place', async () => {
    const folder = makeFolder({ id: 'keep-1', name: 'Keep Me' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([folder]);
    vi.spyOn(window, 'confirm').mockReturnValue(false); // user cancels

    renderPanel();
    await waitFor(() => screen.getByText('Keep Me'));

    const deleteBtn = screen.getByRole('button', { name: /delete folder keep me/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(foldersApi.deleteFolder).not.toHaveBeenCalled();
      expect(screen.getByText('Keep Me')).toBeInTheDocument();
    });
  });

  it('deleting active folder triggers onSelectFolder(null) to return to All Assets', async () => {
    const folder = makeFolder({ id: 'active-del', name: 'Active Folder' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([folder]);
    vi.mocked(foldersApi.deleteFolder).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSelect = vi.fn();

    renderPanel('active-del', onSelect);
    await waitFor(() => screen.getByText('Active Folder'));

    const deleteBtn = screen.getByRole('button', { name: /delete folder active folder/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  // ── 8. Collapse / expand sidebar ─────────────────────────────────────────

  it('collapses and expands the sidebar panel', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    renderPanel();

    await waitFor(() => screen.getByText('Folders'));

    const collapseBtn = screen.getByRole('button', { name: /collapse sidebar/i });
    fireEvent.click(collapseBtn);

    // Folders heading and "All assets" are hidden when collapsed
    await waitFor(() => {
      expect(screen.queryByText('Folders')).not.toBeInTheDocument();
    });

    const expandBtn = screen.getByRole('button', { name: /expand sidebar/i });
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByText('Folders')).toBeInTheDocument();
    });
  });

  // ── 9. Multiple folders render and sort alphabetically ───────────────────

  it('renders multiple folders sorted alphabetically', async () => {
    const folders = [
      makeFolder({ id: 'z', name: 'Zebra Shots', asset_count: 1 }),
      makeFolder({ id: 'a', name: 'Aerial Photos', asset_count: 5 }),
      makeFolder({ id: 'm', name: 'Marketing', asset_count: 0 }),
    ];
    // API already returns them sorted (per route), but component should still render all
    vi.mocked(foldersApi.listFolders).mockResolvedValue(
      [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    );

    renderPanel();

    await waitFor(() => {
      const names = screen
        .getAllByRole('listitem')
        .map((li) => li.textContent ?? '');
      const folderNames = names.filter((t) => t.includes('Photos') || t.includes('Marketing') || t.includes('Zebra'));
      expect(folderNames.length).toBe(3);
    });

    // Aerial comes before Marketing, Marketing before Zebra
    const items = screen.getAllByRole('listitem');
    const texts = items.map((li) => li.textContent ?? '');
    const aerialIdx = texts.findIndex((t) => t.includes('Aerial'));
    const marketingIdx = texts.findIndex((t) => t.includes('Marketing'));
    const zebraIdx = texts.findIndex((t) => t.includes('Zebra'));
    expect(aerialIdx).toBeLessThan(marketingIdx);
    expect(marketingIdx).toBeLessThan(zebraIdx);
  });
});
