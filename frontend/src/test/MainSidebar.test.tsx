/**
 * MAS-712: Integration tests for the unified MainSidebar component.
 *
 * Ports the FolderPanel test contract (create/rename/delete/select/collapse,
 * MAS-367) onto the merged sidebar, and adds coverage for the MAS-712 changes:
 *  - child folder rows are selectable (was a no-op in FolderPanel)
 *  - children are cached across collapse/re-expand
 *  - Filters section renders the children slot with a working "Clear all"
 *
 * API calls are mocked via vi.mock so no running server is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MainSidebar } from '../components/MainSidebar';
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

function renderSidebar(
  activeFolderId: string | null = null,
  onSelectFolder: (id: string | null) => void = vi.fn(),
  extra: { hasFilters?: boolean; onClearFilters?: () => void; children?: React.ReactNode } = {},
) {
  return render(
    <MainSidebar
      activeFolderId={activeFolderId}
      onSelectFolder={onSelectFolder}
      hasFilters={extra.hasFilters ?? false}
      onClearFilters={extra.onClearFilters ?? vi.fn()}
    >
      {extra.children}
    </MainSidebar>,
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('MainSidebar integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  // ── Empty / loaded states ─────────────────────────────────────────────────

  it('shows empty state message when no folders exist', async () => {
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText(/no folders yet/i)).toBeInTheDocument();
    });
  });

  it('renders loaded folders with name and asset count', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([
      makeFolder({ name: 'Marketing', asset_count: 3 }),
    ]);
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText('Marketing')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  // ── Create ────────────────────────────────────────────────────────────────

  it('creates a folder via the section-header [+] and it appears in the sidebar', async () => {
    const newFolder = makeFolder({ id: 'new-id', name: 'Campaign 2026' });
    vi.mocked(foldersApi.createFolder).mockResolvedValue(newFolder);

    renderSidebar();
    await waitFor(() => screen.getByText(/no folders yet/i));

    fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    const input = screen.getByPlaceholderText(/folder name/i);
    await userEvent.type(input, 'Campaign 2026');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(foldersApi.createFolder).toHaveBeenCalledWith({ name: 'Campaign 2026' });
      expect(screen.getByText('Campaign 2026')).toBeInTheDocument();
    });
    expect(screen.queryByText(/no folders yet/i)).not.toBeInTheDocument();
  });

  it('escaping the new-folder input cancels creation', async () => {
    renderSidebar();
    await waitFor(() => screen.getByText(/no folders yet/i));

    fireEvent.click(screen.getByRole('button', { name: /new folder/i }));
    const input = screen.getByPlaceholderText(/folder name/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
      expect(foldersApi.createFolder).not.toHaveBeenCalled();
    });
  });

  // ── Select ────────────────────────────────────────────────────────────────

  it('selecting a folder fires onSelectFolder with the folder id', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([
      makeFolder({ id: 'folder-abc', name: 'Product Photos' }),
    ]);
    const onSelect = vi.fn();
    renderSidebar(null, onSelect);

    await waitFor(() => screen.getByText('Product Photos'));
    fireEvent.click(screen.getByText('Product Photos'));
    expect(onSelect).toHaveBeenCalledWith('folder-abc');
  });

  it('clicking "All assets" fires onSelectFolder with null', async () => {
    const onSelect = vi.fn();
    renderSidebar('some-folder-id', onSelect);

    await waitFor(() => screen.getByText('All assets'));
    fireEvent.click(screen.getByText('All assets'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  // ── Child rows (MAS-712 fix: selection was a no-op in FolderPanel) ────────

  it('expanding a folder loads children and child rows fire onSelectFolder', async () => {
    const parent = makeFolder({ id: 'parent-1', name: 'Characters' });
    const child = makeFolder({ id: 'child-1', name: 'Heroes', parent_folder_id: 'parent-1' });
    vi.mocked(foldersApi.listFolders).mockImplementation(async (params) =>
      params?.parentFolderId === 'root' ? [parent] : params?.parentFolderId === 'parent-1' ? [child] : [],
    );
    const onSelect = vi.fn();
    renderSidebar(null, onSelect);

    await waitFor(() => screen.getByText('Characters'));
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    await waitFor(() => screen.getByText('Heroes'));
    fireEvent.click(screen.getByText('Heroes'));
    expect(onSelect).toHaveBeenCalledWith('child-1');
  });

  it('caches children across collapse/re-expand (no refetch)', async () => {
    const parent = makeFolder({ id: 'parent-1', name: 'Characters' });
    const child = makeFolder({ id: 'child-1', name: 'Heroes', parent_folder_id: 'parent-1' });
    vi.mocked(foldersApi.listFolders).mockImplementation(async (params) =>
      params?.parentFolderId === 'root' ? [parent] : [child],
    );
    renderSidebar();

    await waitFor(() => screen.getByText('Characters'));

    // Expand → children fetched
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => screen.getByText('Heroes'));
    const childFetches = () =>
      vi.mocked(foldersApi.listFolders).mock.calls.filter(
        ([p]) => p?.parentFolderId === 'parent-1',
      ).length;
    expect(childFetches()).toBe(1);

    // Collapse, re-expand → served from cache
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    await waitFor(() => expect(screen.queryByText('Heroes')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => screen.getByText('Heroes'));
    expect(childFetches()).toBe(1);
  });

  // ── Rename ────────────────────────────────────────────────────────────────

  it('double-clicking a folder row opens rename input and PATCH fires on Enter', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([makeFolder({ id: 'r1', name: 'Old Name' })]);
    vi.mocked(foldersApi.updateFolder).mockResolvedValue(makeFolder({ id: 'r1', name: 'New Name' }));

    renderSidebar();
    await waitFor(() => screen.getByText('Old Name'));

    fireEvent.dblClick(screen.getByText('Old Name'));
    await waitFor(() => screen.getByDisplayValue('Old Name'));

    const input = screen.getByDisplayValue('Old Name');
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
    vi.mocked(foldersApi.listFolders).mockResolvedValue([makeFolder({ id: 'esc-1', name: 'Stable Name' })]);

    renderSidebar();
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

  // ── Delete ────────────────────────────────────────────────────────────────

  it('confirming delete removes the folder from the sidebar list', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([makeFolder({ id: 'del-1', name: 'To Be Deleted' })]);
    vi.mocked(foldersApi.deleteFolder).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSidebar();
    await waitFor(() => screen.getByText('To Be Deleted'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete folder to be deleted/i }));
    });

    await waitFor(() => {
      expect(foldersApi.deleteFolder).toHaveBeenCalledWith('del-1');
      expect(screen.queryByText('To Be Deleted')).not.toBeInTheDocument();
    });
  });

  it('deleting active folder triggers onSelectFolder(null) to return to All Assets', async () => {
    vi.mocked(foldersApi.listFolders).mockResolvedValue([makeFolder({ id: 'active-del', name: 'Active Folder' })]);
    vi.mocked(foldersApi.deleteFolder).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSelect = vi.fn();

    renderSidebar('active-del', onSelect);
    await waitFor(() => screen.getByText('Active Folder'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete folder active folder/i }));
    });

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  // ── Collapse / expand ─────────────────────────────────────────────────────

  it('collapses to an icon rail and expands back', async () => {
    renderSidebar();
    await waitFor(() => screen.getByText('Folders'));

    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    await waitFor(() => {
      expect(screen.queryByText('Folders')).not.toBeInTheDocument();
    });
    // Collapsed rail exposes section shortcuts
    expect(screen.getByRole('button', { name: /show folders/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show filters/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /expand sidebar/i }));
    await waitFor(() => {
      expect(screen.getByText('Folders')).toBeInTheDocument();
    });
  });

  it('collapsed-rail section shortcut expands the sidebar', async () => {
    renderSidebar();
    await waitFor(() => screen.getByText('Folders'));

    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    fireEvent.click(screen.getByRole('button', { name: /show filters/i }));

    await waitFor(() => {
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });
  });

  // ── Filters section (children slot) ───────────────────────────────────────

  it('renders filter children inside the Filters section', async () => {
    renderSidebar(null, vi.fn(), { children: <div>My Filter Group</div> });
    await waitFor(() => {
      expect(screen.getByText('Filters')).toBeInTheDocument();
      expect(screen.getByText('My Filter Group')).toBeInTheDocument();
    });
  });

  it('shows Clear all only when filters are active, and it fires onClearFilters', async () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <MainSidebar activeFolderId={null} onSelectFolder={vi.fn()} hasFilters={false} onClearFilters={onClear} />,
    );
    await waitFor(() => screen.getByText('Filters'));
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();

    rerender(
      <MainSidebar activeFolderId={null} onSelectFolder={vi.fn()} hasFilters={true} onClearFilters={onClear} />,
    );
    fireEvent.click(screen.getByText('Clear all'));
    expect(onClear).toHaveBeenCalled();
  });
});
