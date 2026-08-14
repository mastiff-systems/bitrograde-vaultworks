/**
 * MAS-389 — QA: file-rename feature in UploadWizard Step 2 (MAS-388)
 *
 * Test cases from the MAS-389 issue description:
 *
 *  Happy path
 *   ✓ Step 2 File Name input is pre-filled with the original filename (including extension).
 *   ✓ Custom name in Step 2 appears in Step 3 review card.
 *   ✓ Completing the upload sends the custom name as `customName`.
 *
 *  Validation — empty name
 *   ✓ Clearing the field shows the inline error "File name is required."
 *   ✓ Blurring the empty field triggers dispatch to restore the original file.name.
 *
 *  Validation — max length
 *   ✓ A 255-character name shows no length error.
 *   ✓ A 256-character name shows "must be 255 characters or fewer."
 *   ✓ The char-count indicator uses the danger class when over limit.
 *
 *  Extension handling
 *   ✓ Default name includes the file extension (no stripping).
 *   ✓ A changed extension is passed to uploadWithMetadata as-is.
 *
 *  Regression
 *   ✓ Uploading without editing the name uses the original file.name.
 *   ✓ Full wizard flow completes successfully (non-image file, unbroken path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook, act as hookAct } from '@testing-library/react';
import { Step2MetadataForm } from '../components/UploadWizard/Step2MetadataForm';
import { Step3ReviewSubmit } from '../components/UploadWizard/Step3ReviewSubmit';
import { useUploadWizard } from '../components/UploadWizard/useUploadWizard';
import { UploadWizard } from '../components/UploadWizard';
import type { WizardState } from '../components/UploadWizard/useUploadWizard';
import type { Asset } from '../api/client';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../api/categories.js', () => ({
  listCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../api/client.js', () => ({
  uploadWithMetadata: vi.fn(),
}));

import * as clientApi from '../api/client.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a plain text File (avoids browser Image/Video API paths in detectFileMeta). */
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
    uploadedAsset: null,
    uploadProgress: 0,
    error: null,
    ...overrides,
  };
}

/** Render Step2MetadataForm in isolation with a controllable state and spy dispatch. */
function renderStep2(stateOverrides: Partial<WizardState> = {}, dispatch = vi.fn()) {
  const state = makeWizardState(stateOverrides);
  const utils = render(
    <Step2MetadataForm
      state={state}
      dispatch={dispatch}
      categories={[]}
      categoriesLoading={false}
      categoriesError={null}
    />,
  );
  return { ...utils, state, dispatch };
}

/** The File Name input is uniquely identified by its aria-describedby attribute. */
function getFileNameInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector(
    'input[aria-describedby="custom-name-hint"]',
  ) as HTMLInputElement;
}

// ─── Part 1: Step2MetadataForm — Unit tests ───────────────────────────────────

describe('Step2MetadataForm — file rename unit tests', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Happy path: pre-fill ──────────────────────────────────────────────────

  it('File Name input is pre-filled with the original filename including extension', () => {
    const { container } = renderStep2({ customName: 'texture.png' });
    const input = getFileNameInput(container);
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('texture.png');
  });

  it('File Name input reflects a non-image filename (regression: any extension)', () => {
    const { container } = renderStep2({
      file: makeFile('report.pdf'),
      customName: 'report.pdf',
    });
    expect(getFileNameInput(container).value).toBe('report.pdf');
  });

  // ── Dispatches SET_CUSTOM_NAME on input change ────────────────────────────

  it('typing in the File Name input dispatches SET_CUSTOM_NAME', async () => {
    const dispatch = vi.fn();
    const { container } = renderStep2({ customName: 'original.txt' }, dispatch);
    const input = getFileNameInput(container);

    fireEvent.change(input, { target: { value: 'renamed.txt' } });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_CUSTOM_NAME',
      name: 'renamed.txt',
    });
  });

  // ── Validation — empty name ───────────────────────────────────────────────

  it('shows "File name is required." error when customName is empty string', () => {
    const { container } = renderStep2({ customName: '' });
    expect(screen.getByText(/file name is required/i)).toBeInTheDocument();
    // Error class applied to input border
    const input = getFileNameInput(container);
    expect(input.className).toMatch(/border-danger/);
  });

  it('shows "File name is required." error when customName is whitespace-only', () => {
    renderStep2({ customName: '   ' });
    expect(screen.getByText(/file name is required/i)).toBeInTheDocument();
  });

  it('blurring the empty File Name input dispatches SET_CUSTOM_NAME with file.name', () => {
    const dispatch = vi.fn();
    const file = makeFile('slides.pptx');
    const { container } = renderStep2({ file, customName: '' }, dispatch);

    const input = getFileNameInput(container);
    fireEvent.blur(input);

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_CUSTOM_NAME',
      name: 'slides.pptx',
    });
  });

  it('blurring a non-empty File Name input does NOT dispatch SET_CUSTOM_NAME', () => {
    const dispatch = vi.fn();
    const { container } = renderStep2({ customName: 'my-asset.jpg' }, dispatch);

    fireEvent.blur(getFileNameInput(container));

    expect(dispatch).not.toHaveBeenCalled();
  });

  // ── Validation — max length ───────────────────────────────────────────────

  it('a 255-character name shows no length error and no "required" error', () => {
    const longName = 'a'.repeat(255);
    renderStep2({ customName: longName });
    expect(screen.queryByText(/must be 255 characters or fewer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/file name is required/i)).not.toBeInTheDocument();
  });

  it('a 256-character name shows "must be 255 characters or fewer" error', () => {
    const tooLong = 'b'.repeat(256);
    renderStep2({ customName: tooLong });
    expect(screen.getByText(/must be 255 characters or fewer/i)).toBeInTheDocument();
  });

  it('the char-count indicator uses the danger color class when name exceeds 255 chars', () => {
    const { container } = renderStep2({ customName: 'x'.repeat(256) });
    // The counter span shows N / 255 and switches to text-danger
    const counter = container.querySelector('span.text-\\[10px\\]');
    // Find any span that contains the count and has text-danger
    const spans = Array.from(container.querySelectorAll('span'));
    const dangerCounter = spans.find(
      (s) => s.className.includes('text-danger') && s.textContent?.includes('/ 255'),
    );
    expect(dangerCounter).toBeTruthy();
  });

  it('no error is shown when customName is a valid non-empty name', () => {
    renderStep2({ customName: 'valid-name.jpg' });
    expect(screen.queryByText(/file name is required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/must be 255 characters or fewer/i)).not.toBeInTheDocument();
  });
});

// ─── Part 2: Step3ReviewSubmit — display tests ────────────────────────────────

describe('Step3ReviewSubmit — file rename display', () => {
  it('review card shows state.customName as the Name row', () => {
    const state = makeWizardState({
      step: 'review',
      customName: 'my-custom-asset.jpg',
    });
    render(<Step3ReviewSubmit state={state} categories={[]} />);
    expect(screen.getByText('my-custom-asset.jpg')).toBeInTheDocument();
  });

  it('review card falls back to file.name when customName is empty', () => {
    const state = makeWizardState({
      step: 'review',
      file: makeFile('original.txt'),
      customName: '',
    });
    render(<Step3ReviewSubmit state={state} categories={[]} />);
    expect(screen.getByText('original.txt')).toBeInTheDocument();
  });

  it('review card shows changed extension correctly', () => {
    const state = makeWizardState({
      step: 'review',
      file: makeFile('image.jpg'),
      customName: 'image.webp',
    });
    render(<Step3ReviewSubmit state={state} categories={[]} />);
    expect(screen.getByText('image.webp')).toBeInTheDocument();
  });
});

// ─── Part 3: useUploadWizard hook — upload integration tests ─────────────────

describe('useUploadWizard — customName upload integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('customName is set to file.name immediately after selectFile', async () => {
    const { result } = renderHook(() => useUploadWizard(vi.fn()));
    const file = makeFile('dataset.csv');

    await hookAct(async () => {
      await result.current.selectFile(file);
    });

    expect(result.current.state.customName).toBe('dataset.csv');
  });

  it('upload without renaming sends customName equal to original file.name', async () => {
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(
      makeAsset('dataset.csv'),
    );
    const onComplete = vi.fn();
    const { result } = renderHook(() => useUploadWizard(onComplete));
    const file = makeFile('dataset.csv');

    await hookAct(async () => {
      await result.current.selectFile(file);
    });

    await hookAct(async () => {
      await result.current.submit();
    });

    expect(clientApi.uploadWithMetadata).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ customName: 'dataset.csv' }),
      expect.any(Function),
    );
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ original_name: 'dataset.csv' }),
    );
  });

  it('upload after renaming sends the custom name', async () => {
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(
      makeAsset('renamed-asset.txt'),
    );
    const onComplete = vi.fn();
    const { result } = renderHook(() => useUploadWizard(onComplete));
    const file = makeFile('original.txt');

    await hookAct(async () => {
      await result.current.selectFile(file);
    });

    // Simulate the user editing the name in Step 2
    hookAct(() => {
      result.current.dispatch({ type: 'SET_CUSTOM_NAME', name: 'renamed-asset.txt' });
    });

    await hookAct(async () => {
      await result.current.submit();
    });

    expect(clientApi.uploadWithMetadata).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ customName: 'renamed-asset.txt' }),
      expect.any(Function),
    );
  });

  it('upload with changed extension stores the new extension', async () => {
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(
      makeAsset('photo.png'),
    );
    const { result } = renderHook(() => useUploadWizard(vi.fn()));
    const file = makeFile('photo.jpg');

    await hookAct(async () => {
      await result.current.selectFile(file);
    });

    hookAct(() => {
      result.current.dispatch({ type: 'SET_CUSTOM_NAME', name: 'photo.png' });
    });

    await hookAct(async () => {
      await result.current.submit();
    });

    expect(clientApi.uploadWithMetadata).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ customName: 'photo.png' }),
      expect.any(Function),
    );
  });

  it('upload falls back to file.name when customName is empty string', async () => {
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(
      makeAsset('fallback.txt'),
    );
    const { result } = renderHook(() => useUploadWizard(vi.fn()));
    const file = makeFile('fallback.txt');

    await hookAct(async () => {
      await result.current.selectFile(file);
    });

    // Force customName to empty (edge-case; normally prevented by onBlur restore)
    hookAct(() => {
      result.current.dispatch({ type: 'SET_CUSTOM_NAME', name: '' });
    });

    await hookAct(async () => {
      await result.current.submit();
    });

    // The hook falls back: customName: state.customName || state.file.name
    expect(clientApi.uploadWithMetadata).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ customName: 'fallback.txt' }),
      expect.any(Function),
    );
  });
});

// ─── Part 4: UploadWizard — full wizard E2E (via dropzone input) ──────────────

describe('UploadWizard — E2E navigation and rename', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Drive a file through the dropzone's hidden <input type="file">.
   * react-dropzone v14 processes the change event and calls onDrop.
   */
  async function selectFileViaDropzone(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  }

  async function waitForNextEnabled() {
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /next/i });
      expect(btn).not.toBeDisabled();
    });
  }

  it('selects a file, advances to Step 2, and File Name input shows filename with extension', async () => {
    const { container } = render(
      <UploadWizard open={true} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    const file = makeFile('texture.jpg');
    await selectFileViaDropzone(container, file);
    await waitForNextEnabled();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      const nameInput = getFileNameInput(container);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput.value).toBe('texture.jpg');
    });
  });

  it('custom name entered in Step 2 appears in Step 3 review card', async () => {
    const { container } = render(
      <UploadWizard open={true} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    const file = makeFile('original.txt');
    await selectFileViaDropzone(container, file);
    await waitForNextEnabled();

    // Go to Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => expect(getFileNameInput(container)).toBeInTheDocument());

    const nameInput = getFileNameInput(container);
    fireEvent.change(nameInput, { target: { value: 'my-renamed-file.txt' } });

    // Go to Step 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('my-renamed-file.txt')).toBeInTheDocument();
    });
  });

  it('clearing the name and blurring the input restores the original filename', async () => {
    const { container } = render(
      <UploadWizard open={true} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    const file = makeFile('report.pdf');
    await selectFileViaDropzone(container, file);
    await waitForNextEnabled();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => expect(getFileNameInput(container)).toBeInTheDocument());

    const nameInput = getFileNameInput(container);
    // Clear the name
    fireEvent.change(nameInput, { target: { value: '' } });
    expect(screen.getByText(/file name is required/i)).toBeInTheDocument();

    // Blur → should restore original name
    fireEvent.blur(nameInput);

    await waitFor(() => {
      expect(nameInput.value).toBe('report.pdf');
    });
  });

  it('full wizard completes successfully for a non-image file (regression)', async () => {
    const onComplete = vi.fn();
    vi.mocked(clientApi.uploadWithMetadata).mockResolvedValue(
      makeAsset('document.txt'),
    );

    const { container } = render(
      <UploadWizard open={true} onClose={vi.fn()} onComplete={onComplete} />,
    );

    const file = makeFile('document.txt');
    await selectFileViaDropzone(container, file);
    await waitForNextEnabled();

    // Step 1 → Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(getFileNameInput(container)).toBeInTheDocument());

    // Step 2 → Step 3 (unchanged name)
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => screen.getByRole('button', { name: /upload/i }));

    // Upload
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    });

    await waitFor(() => {
      expect(clientApi.uploadWithMetadata).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ customName: 'document.txt' }),
        expect.any(Function),
      );
      expect(onComplete).toHaveBeenCalled();
    });

    // Success screen
    expect(screen.getByText(/upload complete/i)).toBeInTheDocument();
  });
});
