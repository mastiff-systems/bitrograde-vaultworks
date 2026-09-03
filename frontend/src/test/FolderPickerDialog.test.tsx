/**
 * MAS-712: Tests for the Upload Wizard's FolderPickerDialog (OS-installer-style
 * destination folder picker, per MAS-709 design §5.2/§5.5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderPickerDialog } from '../components/UploadWizard/FolderPickerDialog';
import type { Folder } from '../api/folders';

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

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'folder-1',
    name: 'Characters',
    description: null,
    parent_folder_id: null,
    created_by_user_id: null,
    asset_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderPicker(
  props: Partial<React.ComponentProps<typeof FolderPickerDialog>> = {},
) {
  return render(
    <FolderPickerDialog
      open
      initial={{ id: null, path: [] }}
      onCancel={vi.fn()}
      onChoose={vi.fn()}
      {...props}
    />,
  );
}

describe('FolderPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foldersApi.listFolders).mockResolvedValue([]);
  });

  it('renders nothing when closed', () => {
    renderPicker({ open: false });
    expect(screen.queryByText('Choose a folder')).not.toBeInTheDocument();
  });

  it('shows the fresh-install empty state when no folders exist', async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText(/no folders yet\. uploads go to all assets/i)).toBeInTheDocument();
    });
  });

  it('defaults the staged selection to All assets (root)', async () => {
    renderPicker();
    await waitFor(() => screen.getByText('Choose a folder'));
    expect(screen.getByText('Selected:').parentElement?.textContent).toContain('All assets');
  });

  it('stages a folder on row click and commits it via Choose with its path', async () => {
    const parent = makeFolder({ id: 'p1', name: 'Characters' });
    const child = makeFolder({ id: 'c1', name: 'Heroes', parent_folder_id: 'p1' });
    vi.mocked(foldersApi.listFolders).mockImplementation(async (params) =>
      params?.parentFolderId === 'root' ? [parent] : params?.parentFolderId === 'p1' ? [child] : [],
    );
    const onChoose = vi.fn();
    renderPicker({ onChoose });

    await waitFor(() => screen.getByText('Characters'));

    // Expand Characters, then stage the child Heroes
    fireEvent.click(screen.getByRole('button', { name: /expand characters/i }));
    await waitFor(() => screen.getByText('Heroes'));
    fireEvent.click(screen.getByText('Heroes'));

    // Staging does NOT close the dialog; footer path updates live
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText('Selected:').parentElement?.textContent).toContain(
      'All assets › Characters › Heroes',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(onChoose).toHaveBeenCalledWith({ id: 'c1', path: ['Characters', 'Heroes'] });
  });

  it('root "All assets" row is selectable to explicitly reset to no folder', async () => {
    const parent = makeFolder({ id: 'p1', name: 'Characters' });
    vi.mocked(foldersApi.listFolders).mockResolvedValue([parent]);
    const onChoose = vi.fn();
    renderPicker({ initial: { id: 'p1', path: ['Characters'] }, onChoose });

    await waitFor(() => screen.getByText('Characters'));
    fireEvent.click(screen.getByText('All assets'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(onChoose).toHaveBeenCalledWith({ id: null, path: [] });
  });

  it('cancel closes without committing', async () => {
    const onCancel = vi.fn();
    const onChoose = vi.fn();
    renderPicker({ onCancel, onChoose });

    await waitFor(() => screen.getByText('Choose a folder'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('shows a recoverable error row when a subfolder fetch fails, and Retry refetches', async () => {
    const parent = makeFolder({ id: 'p1', name: 'Characters' });
    const child = makeFolder({ id: 'c1', name: 'Heroes', parent_folder_id: 'p1' });
    let failNext = true;
    vi.mocked(foldersApi.listFolders).mockImplementation(async (params) => {
      if (params?.parentFolderId === 'root') return [parent];
      if (failNext) { failNext = false; throw new Error('network'); }
      return [child];
    });
    renderPicker();

    await waitFor(() => screen.getByText('Characters'));
    fireEvent.click(screen.getByRole('button', { name: /expand characters/i }));

    await waitFor(() => screen.getByText(/couldn't load subfolders/i));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Heroes')).toBeInTheDocument();
      expect(screen.queryByText(/couldn't load subfolders/i)).not.toBeInTheDocument();
    });
  });
});
