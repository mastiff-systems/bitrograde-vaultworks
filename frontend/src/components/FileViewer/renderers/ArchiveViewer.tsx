import { useEffect, useRef, useState } from 'react';
import type { FileEntry as ZipFileEntry } from '@zip.js/zip.js';
import { FallbackViewer } from './FallbackViewer.js';

interface Props {
  url: string;
  filename: string;
  downloadHref: string;
  onError: (err: Error) => void;
}

interface FileEntry {
  name: string;
  size: number;
  compressedSize: number;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
  txt: 'text/plain', json: 'application/json', xml: 'application/xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
  zip: 'application/zip',
};

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export function ArchiveViewer({ url, filename, downloadHref, onError }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    blobRef.current = null;

    (async () => {
      try {
        const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;

        blobRef.current = blob;

        const reader = new ZipReader(new BlobReader(blob));
        const rawEntries = await reader.getEntries();
        await reader.close();
        if (cancelled) return;

        setEntries(
          rawEntries
            .filter((e) => !e.directory)
            .map((e) => ({
              name: e.filename,
              size: e.uncompressedSize,
              compressedSize: e.compressedSize,
            })),
        );
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setLoadError(true);
        setLoading(false);
        onError(e);
      }
    })();

    return () => { cancelled = true; };
  }, [url, onError]);

  const extract = async (entry: FileEntry) => {
    if (!blobRef.current || extracting) return;
    setExtracting(entry.name);
    try {
      const { BlobReader, BlobWriter, ZipReader } = await import('@zip.js/zip.js');
      const reader = new ZipReader(new BlobReader(blobRef.current));
      const rawEntries = await reader.getEntries();
      const target = rawEntries.find((e) => e.filename === entry.name && !e.directory) as ZipFileEntry | undefined;
      if (!target) { await reader.close(); return; }
      const blob = await target.getData(new BlobWriter(guessMime(entry.name)));
      await reader.close();

      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = entry.name.split('/').pop() ?? entry.name;
      a.click();
      // Defer revocation to give the browser time to read the blob URL
      setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
    } finally {
      setExtracting(null);
    }
  };

  if (loadError) {
    return <FallbackViewer downloadHref={downloadHref} filename={filename} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-32" role="status" aria-label="Loading archive">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-accent animate-spin" />
              <p className="text-sm text-content-secondary">Reading archive…</p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-32 gap-2 text-content-muted">
            <p className="text-sm">Archive is empty</p>
          </div>
        ) : (
          <table className="w-full text-sm" aria-label="Archive contents">
            <thead className="bg-surface-1 border-b border-border sticky top-0 z-10">
              <tr>
                <th className="text-left px-5 py-2 font-medium text-content-secondary text-xs">Name</th>
                <th className="text-right px-5 py-2 font-medium text-content-secondary text-xs w-28">Size</th>
                <th className="text-right px-5 py-2 font-medium text-content-secondary text-xs w-16">Type</th>
                <th className="px-5 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.name}
                  className="border-b border-border hover:bg-surface-1 transition-colors"
                >
                  <td className="px-5 py-2 font-mono text-xs text-content-primary break-all">{entry.name}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-content-secondary text-xs">
                    {formatBytes(entry.size)}
                  </td>
                  <td className="px-5 py-2 text-right text-content-muted text-xs uppercase tracking-wide">
                    {entry.name.split('.').pop()?.toLowerCase() ?? '—'}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button
                      onClick={() => extract(entry)}
                      disabled={!!extracting}
                      className="btn-ghost btn-sm text-xs"
                      aria-label={`Download ${entry.name}`}
                    >
                      {extracting === entry.name ? (
                        <div className="w-3.5 h-3.5 rounded-full border border-current border-t-transparent animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-surface-1 border-t border-border px-5 py-3 flex items-center gap-4 flex-shrink-0 text-xs">
        {!loading && (
          <span className="text-content-secondary">
            {entries.length} file{entries.length !== 1 ? 's' : ''}
          </span>
        )}
        <a
          href={downloadHref}
          download={filename}
          className="btn-secondary btn-sm text-xs ml-auto"
          aria-label={`Download ${filename}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download archive
        </a>
      </div>
    </div>
  );
}
