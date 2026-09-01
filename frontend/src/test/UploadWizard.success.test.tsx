/**
 * MAS-717 — Upload Wizard success screen must be reachable.
 *
 * Regression: AssetBrowser's onComplete used to call closeWizard() in the
 * same tick as SUBMIT_SUCCESS, so the 'done' step (success confirmation +
 * folder/collection attach-failure warnings) never rendered. The contract is
 * now: onComplete must not close the wizard; the wizard stays on 'done' until
 * the user dismisses it via its own Done button (or backdrop/close).
 *
 *  ✓ after a successful upload the 'done' step renders (onComplete fired, onClose not)
 *  ✓ folder + collection attach-failure warnings are visible on the done step
 *  ✓ the Done button closes the wizard via onClose
 *  ✓ "Upload another" resets back to the file step without closing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UploadWizard } from '../components/UploadWizard';
import type { Asset } from '../api/client';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../api/categories.js', () => ({
  listCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../api/client.js', () => ({
  uploadWithMetadata: vi.fn(),
}));

vi.mock('../api/folders.js', () => ({
  listFolders: vi.fn().mockResolvedValue([]),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  listFolderAssets: vi.fn(),
  addAssetsToFolder: vi.fn(),
  removeAssetFromFolder: vi.fn(),
  listFoldersForAsset: vi.fn(),
}));

vi.mock('../api/collections.js', () => ({
  listCollections: vi.fn().mockResolvedValue([]),
  createCollection: vi.fn(),
  addAssetsToCollection: vi.fn(),
}));

import * as clientApi from '../api/client.js';
import * as foldersApi from '../api/folders.js';
import * as collectionsApi from '../api/collections.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFile(name: string, type = 'text/plain'): File {
  return new File(['hello qa'], name, { type });
}

function makeAsset(originalName: string): Asset {
  return {
    id: 'asset-qa-1',
    original_name: originalName,
    mime_type: 'text/plain',
    size_bytes: 8,
    asset_type: 'other',
    thumbnail_key: null,
    description: null,
    uploaded_at: new Date().toISOString(),
    tags: [],
  };
}

async function selectFileViaDropzone(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

/** Drive the wizard from the file step through metadata/review and submit. */
async function driveToSubmit(container: HTMLElement, fileName = 'shot.txt') {
  await selectFileViaDropzone(container, makeFile(fileName));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });
  fireEvent.click(screen.getByRole('button', { name: /next/i })); // file → metadata
  fireEvent.click(screen.getByRole('button', { name: /next/i })); // metadata → review
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UploadWizard — success screen reachability (MAS-717)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([]);
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(makeAsset('shot.txt'));
  });

  it("renders the 'done' step after a successful upload — onComplete fires but does not close the wizard", async () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const { container } = render(
      <UploadWizard open={true} onClose={onClose} onComplete={onComplete} />,
    );

    await driveToSubmit(container);

    await waitFor(() => {
      expect(screen.getByText('Upload complete!')).toBeInTheDocument();
    });
    expect(screen.getByText(/shot\.txt has been added to your vault/i)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows folder and collection attach-failure warnings on the done step', async () => {
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([
      {
        id: 'col-1',
        name: 'Space Shooter',
        description: null,
        asset_count: 0,
        preview_asset: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(foldersApi.addAssetsToFolder).mockRejectedValue(new Error('500'));
    vi.mocked(collectionsApi.addAssetsToCollection).mockRejectedValue(new Error('500'));

    const onClose = vi.fn();
    const { container } = render(
      <UploadWizard
        open={true}
        onClose={onClose}
        onComplete={vi.fn()}
        prefill={{ folder: { id: 'f-1', path: ['Art'] }, collectionId: 'col-1' }}
      />,
    );

    await driveToSubmit(container);

    await waitFor(() => {
      expect(screen.getByText('Upload complete!')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/couldn't be added to the selected folder/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/couldn't be added to the selected collection/i),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the Done button closes the wizard via onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <UploadWizard open={true} onClose={onClose} onComplete={vi.fn()} />,
    );

    await driveToSubmit(container);
    await waitFor(() => {
      expect(screen.getByText('Upload complete!')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Upload another" resets to the file step without closing the wizard', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <UploadWizard open={true} onClose={onClose} onComplete={vi.fn()} />,
    );

    await driveToSubmit(container);
    await waitFor(() => {
      expect(screen.getByText('Upload complete!')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /upload another/i }));

    expect(screen.queryByText('Upload complete!')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
