import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type { Asset } from '../api/client.js';

// ─── Module mocks (hoisted by vitest) ─────────────────────────────────────────

vi.mock('../api/client.js', () => ({
  streamUrl: (id: string) => `/stream/${id}`,
  downloadUrl: (id: string) => `/download/${id}`,
}));

vi.mock('../components/FileViewer/renderers/ImageViewer.js', () => ({
  ImageViewer: ({ filename }: { filename: string }) => (
    <div data-testid="image-viewer" data-renderer="image">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/AudioPlayer.js', () => ({
  AudioPlayer: ({ filename }: { filename: string }) => (
    <div data-testid="audio-player" data-renderer="audio">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/VideoPlayer.js', () => ({
  VideoPlayer: ({ filename }: { filename: string }) => (
    <div data-testid="video-player" data-renderer="video">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/PDFViewer.js', () => ({
  PDFViewer: ({ filename }: { filename: string }) => (
    <div data-testid="pdf-viewer" data-renderer="pdf">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/CodeViewer.js', () => ({
  CodeViewer: ({ filename }: { filename: string }) => (
    <div data-testid="code-viewer" data-renderer="code">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/ModelViewer3D.js', () => ({
  ModelViewer3D: ({ filename }: { filename: string }) => (
    <div data-testid="model-viewer" data-renderer="model">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/OfficeViewer.js', () => ({
  OfficeViewer: ({ filename }: { filename: string }) => (
    <div data-testid="office-viewer" data-renderer="office">{filename}</div>
  ),
}));

vi.mock('../components/FileViewer/renderers/ArchiveViewer.js', () => ({
  ArchiveViewer: ({ filename }: { filename: string }) => (
    <div data-testid="archive-viewer" data-renderer="archive">{filename}</div>
  ),
}));

// Import after mocks
import { FileViewer } from '../components/FileViewer/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAsset(partial: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    original_name: 'sample.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 2048,
    asset_type: 'image',
    thumbnail_key: null,
    description: null,
    uploaded_at: '2024-01-01T00:00:00Z',
    tags: [],
    ...partial,
  };
}

function renderViewer(asset: Asset, extra: Partial<React.ComponentProps<typeof FileViewer>> = {}) {
  const onClose = vi.fn();
  render(<FileViewer asset={asset} onClose={onClose} {...extra} />);
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe('FileViewer — accessibility', () => {
  it('renders a dialog element with aria-modal', () => {
    renderViewer(makeAsset());
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-labelledby that matches the title element', () => {
    renderViewer(makeAsset({ original_name: 'my-photo.png' }));
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const titleEl = document.getElementById(labelId!);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl!.textContent).toBe('my-photo.png');
  });

  it('has a screen-reader hint announcing "Press Escape to close"', () => {
    renderViewer(makeAsset());
    expect(screen.getByText(/press escape to close/i)).toBeInTheDocument();
  });

  it('shows the file name in the header', () => {
    renderViewer(makeAsset({ original_name: 'report.pdf' }));
    expect(screen.getByRole('heading', { name: 'report.pdf' })).toBeInTheDocument();
  });

  it('shows formatted size when size_bytes is provided', () => {
    renderViewer(makeAsset({ size_bytes: 1536 }));
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });

  it('includes a close button', () => {
    renderViewer(makeAsset());
    expect(screen.getByRole('button', { name: /close viewer/i })).toBeInTheDocument();
  });

  it('includes a download link', () => {
    const asset = makeAsset({ id: 'abc123', original_name: 'data.csv' });
    renderViewer(asset);
    const downloadLink = screen.getByRole('link', { name: /download data\.csv/i });
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute('href', '/download/abc123');
  });
});

// ─── Keyboard: Escape / arrows ────────────────────────────────────────────────

describe('FileViewer — keyboard navigation', () => {
  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderViewer(makeAsset());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close button click calls onClose', () => {
    const { onClose } = renderViewer(makeAsset());
    fireEvent.click(screen.getByRole('button', { name: /close viewer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowLeft navigates to previous asset', async () => {
    const assets = [
      makeAsset({ id: '1', original_name: 'first.jpg', mime_type: 'image/jpeg' }),
      makeAsset({ id: '2', original_name: 'second.jpg', mime_type: 'image/jpeg' }),
    ];
    render(<FileViewer asset={assets[1]} assets={assets} onClose={vi.fn()} />);
    // Start on second asset
    expect(screen.getByRole('heading', { name: 'second.jpg' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'first.jpg' })).toBeInTheDocument();
    });
  });

  it('ArrowRight navigates to next asset', async () => {
    const assets = [
      makeAsset({ id: '1', original_name: 'first.jpg', mime_type: 'image/jpeg' }),
      makeAsset({ id: '2', original_name: 'second.jpg', mime_type: 'image/jpeg' }),
    ];
    render(<FileViewer asset={assets[0]} assets={assets} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'first.jpg' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'second.jpg' })).toBeInTheDocument();
    });
  });

  it('ArrowLeft does nothing at the first asset', () => {
    const assets = [
      makeAsset({ id: '1', original_name: 'only.jpg', mime_type: 'image/jpeg' }),
    ];
    render(<FileViewer asset={assets[0]} assets={assets} onClose={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'only.jpg' })).toBeInTheDocument();
  });

  it('renders prev/next nav buttons when multiple assets are provided', () => {
    const assets = [
      makeAsset({ id: '1', original_name: 'a.jpg' }),
      makeAsset({ id: '2', original_name: 'b.jpg' }),
    ];
    render(<FileViewer asset={assets[0]} assets={assets} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /previous asset/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next asset/i })).toBeInTheDocument();
  });
});

// ─── Body scroll lock ─────────────────────────────────────────────────────────

describe('FileViewer — scroll lock', () => {
  it('sets body overflow to hidden when open', () => {
    renderViewer(makeAsset());
    expect(document.body.style.overflow).toBe('hidden');
  });
});

// ─── Renderer routing — Phase 1 ──────────────────────────────────────────────

describe('FileViewer — Phase 1 renderer routing', () => {
  it.each([
    ['JPEG', 'photo.jpg', 'image/jpeg', 'image-viewer'],
    ['PNG', 'image.png', 'image/png', 'image-viewer'],
    ['GIF', 'anim.gif', 'image/gif', 'image-viewer'],
    ['WebP', 'modern.webp', 'image/webp', 'image-viewer'],
    ['AVIF', 'next-gen.avif', 'image/avif', 'image-viewer'],
    ['SVG', 'vector.svg', 'image/svg+xml', 'image-viewer'],
  ])('%s → ImageViewer', async (_label, name, mime, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: mime }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });

  it.each([
    ['MP3', 'track.mp3', 'audio/mpeg', 'audio-player'],
    ['WAV', 'sound.wav', 'audio/wav', 'audio-player'],
    ['OGG', 'audio.ogg', 'audio/ogg', 'audio-player'],
    ['FLAC', 'lossless.flac', 'audio/flac', 'audio-player'],
    ['AAC', 'encoded.aac', 'audio/aac', 'audio-player'],
  ])('%s → AudioPlayer', async (_label, name, mime, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: mime }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });

  it.each([
    ['MP4', 'video.mp4', 'video/mp4', 'video-player'],
    ['WebM', 'clip.webm', 'video/webm', 'video-player'],
    ['MOV', 'movie.mov', 'video/quicktime', 'video-player'],
  ])('%s → VideoPlayer', async (_label, name, mime, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: mime }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });

  it('PDF → PDFViewer', async () => {
    renderViewer(makeAsset({ original_name: 'doc.pdf', mime_type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument());
  });

  it.each([
    ['TXT', 'readme.txt', 'text/plain', 'code-viewer'],
    ['MD', 'notes.md', 'text/markdown', 'code-viewer'],
    ['JSON', 'config.json', 'application/json', 'code-viewer'],
    ['XML', 'data.xml', 'application/xml', 'code-viewer'],
    ['CSV', 'table.csv', 'text/csv', 'code-viewer'],
    ['YAML', 'values.yaml', 'application/yaml', 'code-viewer'],
  ])('%s → CodeViewer', async (_label, name, mime, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: mime }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });
});

// ─── Renderer routing — Phase 2 ──────────────────────────────────────────────

describe('FileViewer — Phase 2 renderer routing', () => {
  it.each([
    ['GLB', 'model.glb', 'model/gltf-binary', 'model-viewer'],
    ['GLTF', 'scene.gltf', 'model/gltf+json', 'model-viewer'],
  ])('%s → ModelViewer3D', async (_label, name, mime, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: mime }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });

  it.each([
    ['DOCX', 'document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office-viewer'],
    ['XLSX', 'spreadsheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'office-viewer'],
  ])('%s → OfficeViewer', async (_label, name, mime, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: mime }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });

  it('ZIP → ArchiveViewer', async () => {
    renderViewer(makeAsset({ original_name: 'files.zip', mime_type: 'application/zip' }));
    await waitFor(() => expect(screen.getByTestId('archive-viewer')).toBeInTheDocument());
  });
});

// ─── Fallback — unsupported formats ──────────────────────────────────────────

describe('FileViewer — fallback for unsupported formats', () => {
  // NOTE: PSD with mime 'image/vnd.adobe.photoshop' routes to ImageViewer (image/* prefix match) —
  // that is a separate tracked bug (see QA findings). Here we verify the fallback using mime types
  // that are truly unsupported (no image/* / audio/* / video/* prefix).
  it.each([
    ['EXE', 'program.exe', 'application/octet-stream'],
    ['PSD (octet-stream)', 'design.psd', 'application/x-photoshop'],
    ['BLEND', 'scene.blend', 'application/x-blender'],
  ])('%s shows "No preview available" CTA', (_label, name, mime) => {
    // FallbackViewer renders synchronously — no waitFor needed.
    const { container } = render(<FileViewer asset={makeAsset({ original_name: name, mime_type: mime })} onClose={vi.fn()} />);
    expect(within(container).getByText(/no preview available/i)).toBeInTheDocument();
  });

  it.each([
    ['EXE', 'program.exe', 'application/octet-stream'],
    ['PSD (octet-stream)', 'design.psd', 'application/x-photoshop'],
    ['BLEND', 'scene.blend', 'application/x-blender'],
  ])('%s Download button is present and functional', (_label, name, mime) => {
    // FallbackViewer renders synchronously — no waitFor needed.
    const asset = makeAsset({ id: 'fallback-id', original_name: name, mime_type: mime });
    const { container } = render(<FileViewer asset={asset} onClose={vi.fn()} />);
    // Scope to this render's container to avoid cross-test DOM leakage
    const scope = within(container);
    // "Download file" text is unique to the FallbackViewer CTA; the header link is icon-only
    const btn = scope.getByText('Download file').closest('a')!;
    expect(btn).toHaveAttribute('href', '/download/fallback-id');
    expect(btn).toHaveAttribute('download', name);
  });

  it('unknown extension with no mime falls back to FallbackViewer', () => {
    const { container } = render(<FileViewer asset={makeAsset({ original_name: 'data.unknownext', mime_type: null })} onClose={vi.fn()} />);
    expect(within(container).getByText(/no preview available/i)).toBeInTheDocument();
  });
});

// ─── Renderer routing via extension fallback (null mime) ─────────────────────

describe('FileViewer — renderer routing via filename extension when mime is null', () => {
  it.each([
    ['jpg', 'photo.jpg', 'image-viewer'],
    ['mp3', 'track.mp3', 'audio-player'],
    ['mp4', 'clip.mp4', 'video-player'],
    ['pdf', 'doc.pdf', 'pdf-viewer'],
    ['json', 'data.json', 'code-viewer'],
    ['glb', 'model.glb', 'model-viewer'],
    ['docx', 'report.docx', 'office-viewer'],
    ['zip', 'archive.zip', 'archive-viewer'],
  ])('.%s extension routes to correct renderer', async (ext, name, testId) => {
    renderViewer(makeAsset({ original_name: name, mime_type: null }));
    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
  });
});
