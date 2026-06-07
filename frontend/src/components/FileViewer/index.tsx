import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { type Asset } from '../../api/client.js';
import { useFilePreview } from './useFilePreview.js';
import { ImageViewer } from './renderers/ImageViewer.js';
import { AudioPlayer } from './renderers/AudioPlayer.js';
import { VideoPlayer } from './renderers/VideoPlayer.js';
import { FallbackViewer } from './renderers/FallbackViewer.js';

const PDFViewer = lazy(() => import('./renderers/PDFViewer.js').then((m) => ({ default: m.PDFViewer })));
const CodeViewer = lazy(() => import('./renderers/CodeViewer.js').then((m) => ({ default: m.CodeViewer })));
const ModelViewer3D = lazy(() => import('./renderers/ModelViewer3D.js').then((m) => ({ default: m.ModelViewer3D })));
const OfficeViewer = lazy(() => import('./renderers/OfficeViewer.js').then((m) => ({ default: m.OfficeViewer })));
const ArchiveViewer = lazy(() => import('./renderers/ArchiveViewer.js').then((m) => ({ default: m.ArchiveViewer })));

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function RendererLoadingSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center" role="status" aria-label="Loading file preview">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-accent animate-spin" />
        <p className="text-sm text-content-secondary">Loading preview…</p>
      </div>
    </div>
  );
}

interface FileViewerProps {
  asset: Asset;
  assets?: Asset[];
  onClose: () => void;
  onOpenDetails?: () => void;
}

export function FileViewer({ asset, assets, onClose, onOpenDetails }: FileViewerProps) {
  const [currentAsset, setCurrentAsset] = useState(asset);
  const [renderError, setRenderError] = useState<Error | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const returnFocusRef = useRef<Element | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const { url, downloadHref, renderer } = useFilePreview(currentAsset);

  const curIndex = assets ? assets.findIndex((a) => a.id === currentAsset.id) : -1;
  const hasPrev = curIndex > 0;
  const hasNext = assets ? curIndex >= 0 && curIndex < assets.length - 1 : false;

  const goTo = useCallback((idx: number) => {
    if (!assets || idx < 0 || idx >= assets.length) return;
    setCurrentAsset(assets[idx]);
    setRenderError(null);
  }, [assets]);

  const goPrev = useCallback(() => goTo(curIndex - 1), [curIndex, goTo]);
  const goNext = useCallback(() => goTo(curIndex + 1), [curIndex, goTo]);

  // Capture return focus target and move focus to close button
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (returnFocusRef.current && (returnFocusRef.current as HTMLElement).focus) {
        (returnFocusRef.current as HTMLElement).focus();
      }
    };
  }, []);

  // Keyboard: Esc closes; arrows navigate; Tab trapped within dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }

      // Tab focus trap
      if (e.key === 'Tab') {
        const modal = modalRef.current;
        if (!modal) return;
        const focusable = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.closest('[aria-hidden="true"]'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return;
      }

      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'VIDEO' || tag === 'AUDIO') return;
      // Audio/video renderers own arrow keys for seek/skip — skip navigation
      if (renderer === 'audio' || renderer === 'video') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, renderer]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleError = (e: Error) => setRenderError(e);

  const containerCls = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col bg-surface-0'
    : 'fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4';

  const modalCls = fullscreen
    ? 'flex flex-col w-full h-full'
    : 'card w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden';

  return (
    <div
      className={containerCls}
      onClick={fullscreen ? undefined : onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fileviewer-title"
        aria-describedby="fileviewer-hint"
        className={modalCls}
        onClick={(e) => e.stopPropagation()}
      >
        <p id="fileviewer-hint" className="sr-only">File preview. Press Escape to close.</p>

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          {assets && assets.length > 1 && (
            <>
              <button
                onClick={goPrev}
                disabled={!hasPrev}
                className={`btn-ghost btn-sm w-8 h-8 p-0 flex items-center justify-center flex-shrink-0 ${!hasPrev ? 'opacity-30 cursor-not-allowed' : ''}`}
                aria-label="Previous asset"
                aria-disabled={!hasPrev}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={goNext}
                disabled={!hasNext}
                className={`btn-ghost btn-sm w-8 h-8 p-0 flex items-center justify-center flex-shrink-0 ${!hasNext ? 'opacity-30 cursor-not-allowed' : ''}`}
                aria-label="Next asset"
                aria-disabled={!hasNext}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </>
          )}

          <h2
            id="fileviewer-title"
            className="font-semibold text-sm text-content-primary truncate flex-1 min-w-0"
          >
            {currentAsset.original_name}
          </h2>

          {currentAsset.size_bytes !== null && (
            <span className="text-xs text-content-muted tabular-nums flex-shrink-0">
              {formatBytes(currentAsset.size_bytes)}
            </span>
          )}

          {onOpenDetails && (
            <button onClick={onOpenDetails} className="btn-ghost btn-sm flex-shrink-0" aria-label="Open details">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </button>
          )}

          <a
            href={downloadHref}
            download={currentAsset.original_name}
            className="btn-ghost btn-sm flex-shrink-0"
            aria-label={`Download ${currentAsset.original_name}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </a>

          <button
            onClick={() => setFullscreen((f) => !f)}
            className="btn-ghost btn-sm flex-shrink-0"
            aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
          >
            {fullscreen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>

          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="btn-ghost btn-sm flex-shrink-0"
            aria-label="Close viewer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {renderError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12" role="alert" aria-live="assertive">
              <svg className="w-8 h-8 text-warning" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-content-primary font-semibold">Could not load preview</p>
              <p className="text-sm text-content-secondary text-center max-w-xs">{renderError.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setRenderError(null)} className="btn-secondary btn-sm">Retry</button>
                <a href={downloadHref} download={currentAsset.original_name} className="btn-primary btn-sm">Download file</a>
              </div>
            </div>
          ) : renderer === 'image' ? (
            <ImageViewer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
          ) : renderer === 'audio' ? (
            <AudioPlayer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
          ) : renderer === 'video' ? (
            <VideoPlayer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
          ) : renderer === 'pdf' ? (
            <Suspense fallback={<RendererLoadingSpinner />}>
              <PDFViewer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
            </Suspense>
          ) : renderer === 'code' ? (
            <Suspense fallback={<RendererLoadingSpinner />}>
              <CodeViewer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
            </Suspense>
          ) : renderer === 'model' ? (
            <Suspense fallback={<RendererLoadingSpinner />}>
              <ModelViewer3D url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
            </Suspense>
          ) : renderer === 'office' ? (
            <Suspense fallback={<RendererLoadingSpinner />}>
              <OfficeViewer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
            </Suspense>
          ) : renderer === 'archive' ? (
            <Suspense fallback={<RendererLoadingSpinner />}>
              <ArchiveViewer url={url} filename={currentAsset.original_name} downloadHref={downloadHref} onError={handleError} />
            </Suspense>
          ) : (
            <FallbackViewer downloadHref={downloadHref} filename={currentAsset.original_name} />
          )}
        </div>
      </div>
    </div>
  );
}
