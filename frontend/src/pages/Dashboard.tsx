import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { listFiles, uploadFiles, deleteFile, downloadUrl, thumbnailUrl } from '../api/client.js';
import type { Asset } from '../api/client.js';
import { AudioPreview } from '../components/AudioPreview.js';
import { Preview3D } from '../components/Preview3D.js';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TypeBadge({ type }: { type: Asset['asset_type'] }) {
  const cls = { '3d': 'badge-3d', audio: 'badge-audio', image: 'badge-image', other: 'badge-other' }[type];
  const label = { '3d': '3D', audio: 'Audio', image: 'Image', other: 'Other' }[type];
  return <span className={cls}>{label}</span>;
}

function AssetIcon({ type }: { type: Asset['asset_type'] }) {
  const icons = {
    '3d': (
      <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
      </svg>
    ),
    audio: (
      <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
      </svg>
    ),
    image: (
      <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    other: (
      <svg className="w-6 h-6 text-content-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  };
  return icons[type];
}

type PreviewState = { asset: Asset; type: 'audio' | '3d' | 'image' } | null;

export function Dashboard() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listFiles().then(setAssets).catch(() => setError('Failed to load assets.')).finally(() => setLoading(false));
  }, []);

  const onDrop = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const added = await uploadFiles(files, setUploadProgress);
      setAssets((prev) => [...added, ...prev]);
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteFile(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      if (preview?.asset.id === id) setPreview(null);
    } finally {
      setDeletingId(null);
    }
  };

  const openPreview = (asset: Asset) => {
    if (asset.asset_type === 'audio' || asset.asset_type === '3d' || asset.asset_type === 'image') {
      setPreview({ asset, type: asset.asset_type });
    }
  };

  const filtered = assets.filter((a) =>
    a.original_name.toLowerCase().includes(search.toLowerCase()),
  );

  const totals = {
    size: assets.reduce((s, a) => s + (a.size_bytes ?? 0), 0),
    byType: assets.reduce((m, a) => { m[a.asset_type] = (m[a.asset_type] ?? 0) + 1; return m; }, {} as Record<string, number>),
  };

  return (
    <div {...getRootProps()} className="flex-1 p-8">
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="fixed inset-0 z-50 bg-accent/20 border-2 border-accent border-dashed flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-3">⬆️</div>
            <p className="text-accent-light font-semibold text-lg">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Assets</h1>
          <p className="page-subtitle">{assets.length} files · {formatBytes(totals.size)}</p>
        </div>
        <button onClick={open} disabled={uploading} className="btn-primary">
          {uploading ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {uploadProgress}%
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Upload
            </>
          )}
        </button>
      </div>

      {/* Type summary */}
      {assets.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {(['3d', 'audio', 'image', 'other'] as const).map((t) => (
            <div key={t} className="stat-card">
              <span className="stat-label">{t === '3d' ? '3D Models' : t.charAt(0).toUpperCase() + t.slice(1)}</span>
              <span className="stat-value">{totals.byType[t] ?? 0}</span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {assets.length > 3 && (
        <div className="mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              className="input pl-9"
              placeholder="Search assets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && assets.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-border rounded-2xl cursor-pointer hover:border-accent/40 transition-colors"
          onClick={open}
        >
          <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-content-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <p className="text-content-secondary font-medium">Drop files here or click to upload</p>
          <p className="text-content-muted text-sm mt-1">3D models, audio, images, and more · up to 500 MB each</p>
        </div>
      )}

      {/* Asset grid */}
      {!loading && filtered.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <button
                      onClick={() => openPreview(asset)}
                      disabled={asset.asset_type !== 'audio' && asset.asset_type !== '3d' && asset.asset_type !== 'image'}
                      className="flex items-center gap-3 text-left disabled:cursor-default group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {asset.asset_type === 'image' && asset.thumbnail_key ? (
                          <img
                            src={thumbnailUrl(asset.id)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <AssetIcon type={asset.asset_type} />
                        )}
                      </div>
                      <span className={`font-medium text-content-primary truncate max-w-xs ${(asset.asset_type === 'audio' || asset.asset_type === '3d' || asset.asset_type === 'image') ? 'group-hover:text-accent-light transition-colors' : ''}`}>
                        {asset.original_name}
                      </span>
                    </button>
                  </td>
                  <td><TypeBadge type={asset.asset_type} /></td>
                  <td className="tabular-nums">{formatBytes(asset.size_bytes ?? 0)}</td>
                  <td>{formatDate(asset.uploaded_at)}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={downloadUrl(asset.id)}
                        download
                        className="btn-ghost btn-sm"
                        title="Download"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                      </a>
                      <button
                        onClick={() => handleDelete(asset.id)}
                        disabled={deletingId === asset.id}
                        className="btn-ghost btn-sm text-content-muted hover:text-danger"
                        title="Delete"
                      >
                        {deletingId === asset.id ? (
                          <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="card w-full max-w-2xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <p className="font-medium text-content-primary text-sm">{preview.asset.original_name}</p>
                <p className="text-xs text-content-muted mt-0.5">{formatBytes(preview.asset.size_bytes ?? 0)}</p>
              </div>
              <button onClick={() => setPreview(null)} className="btn-ghost btn-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              {preview.type === 'audio' && <AudioPreview assetId={preview.asset.id} />}
              {preview.type === '3d' && <Preview3D assetId={preview.asset.id} filename={preview.asset.original_name} />}
              {preview.type === 'image' && (
                <img
                  src={thumbnailUrl(preview.asset.id)}
                  alt={preview.asset.original_name}
                  className="max-w-full max-h-[60vh] mx-auto rounded-lg object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
