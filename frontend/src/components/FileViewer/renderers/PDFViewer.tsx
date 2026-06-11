import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

interface Props {
  url: string;
  filename: string;
  downloadHref: string;
  onError: (err: Error) => void;
}

const ZOOM_STEP = 25;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

export function PDFViewer({ url, filename, downloadHref, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [pageInput, setPageInput] = useState('1');
  const [loading, setLoading] = useState(true);

  const renderPage = useCallback(async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number) => {
    const pdfPage = await pdf.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: scale / 100 });
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  }, []);

  useEffect(() => {
    setLoading(true);
    setZoom(100);
    setPage(1);
    setPageInput('1');
    pdfjsLib.getDocument(url).promise
      .then(async (pdf) => {
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        await renderPage(pdf, 1, 100);
        setLoading(false);
      })
      .catch((e) => {
        setLoading(false);
        onError(e instanceof Error ? e : new Error(String(e)));
      });
  }, [url]);

  useEffect(() => {
    if (!pdfRef.current) return;
    renderPage(pdfRef.current, page, zoom).catch(() => {});
  }, [page, zoom, renderPage]);

  const goTo = (n: number) => {
    const clamped = Math.max(1, Math.min(numPages, n));
    setPage(clamped);
    setPageInput(String(clamped));
  };

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, ZOOM_MIN));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(page - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(page + 1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-') { e.preventDefault(); zoomOut(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, numPages]);

  return (
    <div className="flex flex-col h-full" aria-label="PDF viewer">
      {/* Content */}
      <div className="flex-1 bg-surface-0 flex items-center justify-center overflow-auto p-4">
        {loading ? (
          <div role="status" aria-label="Loading file preview" className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-accent animate-spin" />
            <p className="text-sm text-content-secondary">Loading PDF…</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ maxWidth: '100%', maxHeight: '100%' }}
            aria-label={`Page ${page} of ${numPages} — ${filename}`}
          />
        )}
      </div>

      {/* Footer */}
      <div className="bg-surface-1 border-t border-border px-5 py-3 flex items-center gap-3 flex-shrink-0 text-xs">
        <button onClick={() => goTo(page - 1)} disabled={page <= 1} className="btn-ghost btn-sm" aria-label="Previous page">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-content-muted">Page</span>
          <input
            className="input py-0.5 text-xs w-14 text-center"
            value={pageInput}
            aria-label="Page number"
            min={1}
            max={numPages}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const n = parseInt(pageInput, 10); if (!isNaN(n)) goTo(n); }
            }}
            onBlur={() => { const n = parseInt(pageInput, 10); if (!isNaN(n)) goTo(n); else setPageInput(String(page)); }}
          />
          <span className="text-xs text-content-muted">/ {numPages}</span>
        </div>
        <button onClick={() => goTo(page + 1)} disabled={page >= numPages} className="btn-ghost btn-sm" aria-label="Next page">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        <button onClick={zoomOut} className="btn-ghost btn-sm" aria-label="Zoom out">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
          </svg>
        </button>
        <span className="text-xs text-content-secondary tabular-nums w-12 text-center">{zoom}%</span>
        <button onClick={zoomIn} className="btn-ghost btn-sm" aria-label="Zoom in">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
          </svg>
        </button>

        <a href={downloadHref} download={filename} className="btn-secondary btn-sm text-xs ml-auto" aria-label={`Download ${filename}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </a>
      </div>
    </div>
  );
}
