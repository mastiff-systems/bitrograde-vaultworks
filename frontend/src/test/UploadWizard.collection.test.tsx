/**
 * MAS-713 — Collection field in the Upload Wizard + smart prefill.
 *
 *  Step 2 Collection field
 *   ✓ renders a Collection select with the loaded collections
 *   ✓ picking a collection dispatches SET_COLLECTION
 *   ✓ inline "New" flow calls onCreateCollection with the typed name
 *
 *  useUploadWizard hook
 *   ✓ createNewCollection creates via API, adds to the list, and selects it
 *   ✓ submit attaches the uploaded asset to the selected collection
 *   ✓ submit does not call the attach API when no collection is selected
 *   ✓ a failed collection attach sets collectionAttachFailed (upload still succeeds)
 *
 *  Smart prefill (wizard shell)
 *   ✓ prefill.collectionId seeds the Step 2 select and stays overridable
 *   ✓ prefill.folder seeds the Step 2 Location breadcrumb
 *
 *  Step 3 review
 *   ✓ shows the selected collection's name
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderHook, act as hookAct } from '@testing-library/react';
import { Step2MetadataForm } from '../components/UploadWizard/Step2MetadataForm';
import { Step3ReviewSubmit } from '../components/UploadWizard/Step3ReviewSubmit';
import { useUploadWizard } from '../components/UploadWizard/useUploadWizard';
import { UploadWizard } from '../components/UploadWizard';
import type { WizardState, WizardAction } from '../components/UploadWizard/useUploadWizard';
import type { Dispatch } from 'react';
import type { Asset } from '../api/client';
import type { Collection } from '../api/collections';

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

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'col-1',
    name: 'Space Shooter',
    description: null,
    asset_count: 0,
    preview_asset: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeWizardState(overrides: Partial<WizardState> = {}): WizardState {
  const file = makeFile('photo.jpg');
  return {
    step: 'metadata',
    file,
    customName: 'photo.jpg',
    detectedType: null,
    detectedDimensions: null,
    detectedDuration: null,
    metadata: {
      categoryId: null,
      subcategoryId: null,
      license: null,
      description: '',
      tags: [],
    },
    folder: { id: null, path: [] },
    collectionId: null,
    folderAttachFailed: false,
    collectionAttachFailed: false,
    uploadedAsset: null,
    uploadProgress: 0,
    error: null,
    ...overrides,
  };
}

function renderStep2(
  stateOverrides: Partial<WizardState> = {},
  opts: {
    dispatch?: ReturnType<typeof vi.fn>;
    collections?: Collection[];
    onCreateCollection?: (name: string) => Promise<void>;
  } = {},
) {
  const dispatch = (opts.dispatch ?? vi.fn()) as ReturnType<typeof vi.fn> & ((action: WizardAction) => void);
  const state = makeWizardState(stateOverrides);
  const utils = render(
    <Step2MetadataForm
      state={state}
      dispatch={dispatch as Dispatch<WizardAction>}
      categories={[]}
      categoriesLoading={false}
      categoriesError={null}
      collections={opts.collections ?? []}
      collectionsLoading={false}
      collectionsError={null}
      onCreateCollection={opts.onCreateCollection ?? vi.fn()}
    />,
  );
  return { ...utils, state, dispatch };
}

function getCollectionSelect(): HTMLSelectElement {
  return screen.getByLabelText('Collection') as HTMLSelectElement;
}

async function selectFileViaDropzone(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

async function advanceToStep2(container: HTMLElement, fileName = 'texture.jpg') {
  await selectFileViaDropzone(container, makeFile(fileName));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await waitFor(() => expect(getCollectionSelect()).toBeInTheDocument());
}

// ─── Step 2: Collection field ─────────────────────────────────────────────────

describe('Step2MetadataForm — Collection field', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a Collection select listing the loaded collections', () => {
    renderStep2({}, {
      collections: [
        makeCollection({ id: 'c1', name: 'Space Shooter' }),
        makeCollection({ id: 'c2', name: 'Platformer' }),
      ],
    });
    const select = getCollectionSelect();
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['No collection', 'Space Shooter', 'Platformer']);
  });

  it('picking a collection dispatches SET_COLLECTION with its id', () => {
    const dispatch = vi.fn();
    renderStep2({}, { dispatch, collections: [makeCollection({ id: 'c1' })] });

    fireEvent.change(getCollectionSelect(), { target: { value: 'c1' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_COLLECTION', collectionId: 'c1' });
  });

  it('picking "No collection" dispatches SET_COLLECTION with null', () => {
    const dispatch = vi.fn();
    renderStep2({ collectionId: 'c1' }, { dispatch, collections: [makeCollection({ id: 'c1' })] });

    fireEvent.change(getCollectionSelect(), { target: { value: '' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_COLLECTION', collectionId: null });
  });

  it('inline "New" flow calls onCreateCollection with the typed name', async () => {
    const onCreateCollection = vi.fn().mockResolvedValue(undefined);
    renderStep2({}, { onCreateCollection });

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const input = screen.getByPlaceholderText(/collection name/i);
    fireEvent.change(input, { target: { value: 'Racing Game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreateCollection).toHaveBeenCalledWith('Racing Game');
      // Input closes on success
      expect(screen.queryByPlaceholderText(/collection name/i)).not.toBeInTheDocument();
    });
  });

  it('shows an inline error and keeps the input open when creation fails', async () => {
    const onCreateCollection = vi.fn().mockRejectedValue(new Error('nope'));
    renderStep2({}, { onCreateCollection });

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const input = screen.getByPlaceholderText(/collection name/i);
    fireEvent.change(input, { target: { value: 'Racing Game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText(/could not create collection/i)).toBeInTheDocument();
    });
    expect((screen.getByPlaceholderText(/collection name/i) as HTMLInputElement).value).toBe('Racing Game');
  });
});

// ─── Hook: create + attach ────────────────────────────────────────────────────

describe('useUploadWizard — collection create and attach', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createNewCollection creates via API, adds it to the list, and selects it', async () => {
    const created = makeCollection({ id: 'new-col', name: 'Fresh' });
    vi.mocked(collectionsApi.createCollection).mockResolvedValue(created);
    const { result } = renderHook(() => useUploadWizard(vi.fn()));

    await hookAct(async () => {
      await result.current.createNewCollection('Fresh');
    });

    expect(collectionsApi.createCollection).toHaveBeenCalledWith('Fresh');
    expect(result.current.collections.map((c) => c.id)).toContain('new-col');
    expect(result.current.state.collectionId).toBe('new-col');
  });

  it('submit attaches the uploaded asset to the selected collection', async () => {
    const asset = makeAsset('doc.txt');
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(asset);
    vi.mocked(collectionsApi.addAssetsToCollection).mockResolvedValue(undefined);
    const { result } = renderHook(() => useUploadWizard(vi.fn()));

    await hookAct(async () => {
      await result.current.selectFile(makeFile('doc.txt'));
    });
    hookAct(() => {
      result.current.dispatch({ type: 'SET_COLLECTION', collectionId: 'col-9' });
    });
    await hookAct(async () => {
      await result.current.submit();
    });

    expect(collectionsApi.addAssetsToCollection).toHaveBeenCalledWith('col-9', [asset.id]);
    expect(result.current.state.step).toBe('done');
    expect(result.current.state.collectionAttachFailed).toBe(false);
  });

  it('submit does not call the attach API when no collection is selected', async () => {
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(makeAsset('doc.txt'));
    const { result } = renderHook(() => useUploadWizard(vi.fn()));

    await hookAct(async () => {
      await result.current.selectFile(makeFile('doc.txt'));
    });
    await hookAct(async () => {
      await result.current.submit();
    });

    expect(collectionsApi.addAssetsToCollection).not.toHaveBeenCalled();
  });

  it('a failed collection attach sets collectionAttachFailed but the upload still completes', async () => {
    const asset = makeAsset('doc.txt');
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(asset);
    vi.mocked(collectionsApi.addAssetsToCollection).mockRejectedValue(new Error('500'));
    const onComplete = vi.fn();
    const { result } = renderHook(() => useUploadWizard(onComplete));

    await hookAct(async () => {
      await result.current.selectFile(makeFile('doc.txt'));
    });
    hookAct(() => {
      result.current.dispatch({ type: 'SET_COLLECTION', collectionId: 'col-9' });
    });
    await hookAct(async () => {
      await result.current.submit();
    });

    expect(result.current.state.step).toBe('done');
    expect(result.current.state.collectionAttachFailed).toBe(true);
    expect(onComplete).toHaveBeenCalledWith(asset);
  });
});

// ─── Smart prefill (wizard shell) ─────────────────────────────────────────────

describe('UploadWizard — smart prefill (MAS-713)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectionsApi.listCollections).mockResolvedValue([
      makeCollection({ id: 'col-active', name: 'Active Filter Collection' }),
    ]);
  });

  it('prefill.collectionId seeds the Step 2 Collection select', async () => {
    const { container } = render(
      <UploadWizard
        open={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        prefill={{ collectionId: 'col-active' }}
      />,
    );

    await advanceToStep2(container);
    await waitFor(() => {
      expect(getCollectionSelect().value).toBe('col-active');
    });
  });

  it('a prefilled collection remains overridable', async () => {
    const { container } = render(
      <UploadWizard
        open={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        prefill={{ collectionId: 'col-active' }}
      />,
    );

    await advanceToStep2(container);
    await waitFor(() => expect(getCollectionSelect().value).toBe('col-active'));

    fireEvent.change(getCollectionSelect(), { target: { value: '' } });
    await waitFor(() => {
      expect(getCollectionSelect().value).toBe('');
    });
  });

  it('prefill.folder seeds the Step 2 Location breadcrumb', async () => {
    const { container } = render(
      <UploadWizard
        open={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        prefill={{ folder: { id: 'f-1', path: ['Art', 'Sprites'] } }}
      />,
    );

    await advanceToStep2(container);
    expect(screen.getByText('Art')).toBeInTheDocument();
    expect(screen.getByText('Sprites')).toBeInTheDocument();
  });

  it('no prefill leaves the Collection select on "No collection"', async () => {
    const { container } = render(
      <UploadWizard open={true} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await advanceToStep2(container);
    expect(getCollectionSelect().value).toBe('');
  });
});

// ─── Step 3 review ────────────────────────────────────────────────────────────

describe('Step3ReviewSubmit — collection display', () => {
  it('shows the selected collection name in the review card', () => {
    const state = makeWizardState({ step: 'review', collectionId: 'c1' });
    render(
      <Step3ReviewSubmit
        state={state}
        categories={[]}
        collections={[makeCollection({ id: 'c1', name: 'Space Shooter' })]}
      />,
    );
    expect(screen.getByText('Collection')).toBeInTheDocument();
    expect(screen.getByText('Space Shooter')).toBeInTheDocument();
  });
});
