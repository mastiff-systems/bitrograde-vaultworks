import { useEffect, useRef, useState } from 'react';
import { FallbackViewer } from './FallbackViewer.js';

interface Props {
  url: string;
  filename: string;
  downloadHref: string;
  onError: (err: Error) => void;
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;font-size:13px;padding:16px 24px;margin:0;color:#e2e8f0;background:#0f172a;line-height:1.6}
    table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:1em}
    th,td{border:1px solid #334155;padding:4px 8px;text-align:left;white-space:nowrap}
    th{background:#1e293b;position:sticky;top:0;z-index:1}
    tr:nth-child(even) td{background:#151f2e}
    p{margin:0.5em 0}
    h1,h2,h3,h4,h5,h6{color:#f1f5f9;margin:0.8em 0 0.4em}
    a{color:#60a5fa}
    strong,b{color:#f8fafc}
    em{color:#cbd5e1}
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sheetToHtml(ws: any): string {
  const rows: string[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow({ includeEmpty: false }, (row: any) => {
    const cells: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cells.push(String(cell.text ?? ''));
    });
    rows.push(cells);
  });

  if (rows.length === 0) return '<p>Empty sheet</p>';

  const [header, ...body] = rows;
  const ths = header.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = body.map(row =>
    `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
  ).join('');

  return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function OfficeViewer({ url, filename, downloadHref, onError }: Props) {
  const [srcdoc, setSrcdoc] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workbookRef = useRef<any>(null);

  const ext = filename.split('.').pop()?.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setSrcdoc('');
    setSheetNames([]);
    setActiveSheet(0);
    workbookRef.current = null;

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        if (ext === 'docx') {
          // mammoth has no TS types — loaded as any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mammoth = (await import('mammoth')) as any;
          if (cancelled) return;
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (cancelled) return;
          if (!result.value) throw new Error('DOCX conversion produced no output');
          setSrcdoc(wrapHtml(result.value));
        } else if (ext === 'xlsx') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ExcelJS = (await import('exceljs')) as any;
          if (cancelled) return;
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          workbookRef.current = wb;
          if (cancelled) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setSheetNames(wb.worksheets.map((ws: any) => ws.name));
          setSrcdoc(wrapHtml(sheetToHtml(wb.worksheets[0])));
        } else {
          throw new Error(`Unsupported office format: .${ext}`);
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setLoadError(true);
        setLoading(false);
        onError(e);
      }
    })();

    return () => { cancelled = true; };
  }, [url, ext, onError]);

  const switchSheet = (idx: number) => {
    if (!workbookRef.current) return;
    setActiveSheet(idx);
    setSrcdoc(wrapHtml(sheetToHtml(workbookRef.current.worksheets[idx])));
  };

  if (loadError) {
    return <FallbackViewer downloadHref={downloadHref} filename={filename} />;
  }

  return (
    <div className="flex flex-col h-full">
      {sheetNames.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface-1 flex-shrink-0 overflow-x-auto">
          {sheetNames.map((name, idx) => (
            <button
              key={name}
              onClick={() => switchSheet(idx)}
              className={`text-xs px-3 py-1 rounded transition-colors flex-shrink-0 ${
                activeSheet === idx
                  ? 'bg-accent text-white'
                  : 'btn-ghost text-content-secondary'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {loading ? (
          <div
            className="absolute inset-0 flex items-center justify-center bg-surface-0"
            role="status"
            aria-label="Loading file preview"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-accent animate-spin" />
              <p className="text-sm text-content-secondary">Loading document…</p>
            </div>
          </div>
        ) : (
          <iframe
            title={filename}
            srcDoc={srcdoc}
            sandbox="allow-same-origin"
            className="w-full h-full border-0"
            aria-label={`Document preview: ${filename}`}
          />
        )}
      </div>

      <div className="bg-surface-1 border-t border-border px-5 py-3 flex items-center gap-4 flex-shrink-0 text-xs">
        <span className="text-content-muted uppercase tracking-wide">{ext?.toUpperCase()}</span>
        <a
          href={downloadHref}
          download={filename}
          className="btn-secondary btn-sm text-xs ml-auto"
          aria-label={`Download ${filename}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </a>
      </div>
    </div>
  );
}
