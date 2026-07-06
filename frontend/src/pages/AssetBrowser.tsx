import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  listFiles,
  listTags,
  uploadFiles,
  deleteFile,
  updateAssetTags,
  updateFile,
  getAssetById,
  listVersions,
  uploadVersion,
  downloadUrl,
  thumbnailUrl,
  versionDownloadUrl,
  bulkDelete,
  bulkDownload,
  type Asset,
  type AssetVersion,
  type Tag,
  createShareLink,
  getShareLinks,
  revokeShareLinks,
  type ShareLink,
} from '../api/client.js';
import {
  listCollections,
  createCollection,
  addAssetsToCollection,
  type Collection,
} from '../api/collections.js';
import { AudioPreview } from '../components/AudioPreview.js';
import { Preview3D } from '../components/Preview3D.js';
import { FileViewer } from '../components/FileViewer/index.js';
import { UploadWizard } from '../components/UploadWizard/index.js';
import { useCategoryContext } from '../contexts/CategoryContext.js';
import { useUpload } from '../contexts/UploadContext.js';

// --- Helpers ---

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_LABELS: Record<string, string> = { '3d': '3D', audio: 'Audio', image: 'Image', other: 'Other' };
const TYPE_BADGE_CLS: Record<string, string> = {
  '3d': 'badge-3d',
  audio: 'badge-audio',
  image: 'badge-image',
  other: 'badge-other',
};
const TYPE_DOT_CLS: Record<string, string> = {
  '3d': 'bg-violet-400',
  audio: 'bg-cyan-400',
  image: 'bg-emerald-400',
  other: 'bg-content-muted',
};

const TAG_PALETTE = [
  { bg: 'bg-violet-500/15', text: 'text-violet-300', ring: 'ring-violet-400/50' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-300', ring: 'ring-cyan-400/50' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-300', ring: 'ring-emerald-400/50' },
  { bg: 'bg-amber-500/15', text: 'text-amber-300', ring: 'ring-amber-400/50' },
  { bg: 'bg-rose-500/15', text: 'text-rose-300', ring: 'ring-rose-400/50' },
  { bg: 'bg-blue-500/15', text: 'text-blue-300', ring: 'ring-blue-400/50' },
  { bg: 'bg-orange-500/15', text: 'text-orange-300', ring: 'ring-orange-400/50' },
  { bg: 'bg-teal-500/15', text: 'text-teal-300', ring: 'ring-teal-400/50' },
];

function tagPalette(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

// --- URL state ---

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 1) return 'unknown';
  return filename.slice(dot + 1).toLowerCase();
}

function getUrlFilters() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') ?? '',
    exts: p.getAll('ext'),
    tags: p.getAll('tag'),
    sort: (p.get('sort') ?? 'newest') as SortKey,
    category: p.get('category') ?? null,
    subcategory: p.get('subcategory') ?? null,
  };
}

function pushUrlFilters(filters: ReturnType<typeof getUrlFilters>) {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  filters.exts.forEach((e) => p.append('ext', e));
  filters.tags.forEach((t) => p.append('tag', t));
  if (filters.sort && filters.sort !== 'newest') p.set('sort', filters.sort);
  if (filters.category) p.set('category', filters.category);
  if (filters.subcategory) p.set('subcategory', filters.subcategory);
  const search = p.toString();
  history.pushState(null, '', search ? `?${search}` : window.location.pathname);
}

// --- Types ---

type SortKey = 'newest' | 'oldest' | 'name-az' | 'name-za' | 'largest' | 'smallest' | 'relevance';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name-az', label: 'Name A–Z' },
  { value: 'name-za', label: 'Name Z–A' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
  { value: 'relevance', label: 'Best match' },
];

const EXT_DOT_CLS: Record<string, string> = {
  obj: 'bg-violet-400',
  fbx: 'bg-violet-500',
  gltf: 'bg-violet-300',
  glb: 'bg-purple-400',
  mp3: 'bg-cyan-400',
  wav: 'bg-cyan-500',
  ogg: 'bg-cyan-300',
  flac: 'bg-sky-400',
  png: 'bg-emerald-400',
  jpg: 'bg-emerald-500',
  jpeg: 'bg-emerald-500',
  gif: 'bg-green-400',
  webp: 'bg-teal-400',
  svg: 'bg-lime-400',
  pdf: 'bg-red-400',
  zip: 'bg-amber-400',
  unknown: 'bg-content-muted',
};

function sortAssets(assets: Asset[], sort: SortKey): Asset[] {
  if (sort === 'relevance') return [...assets];
  return [...assets].sort((a, b) => {
    switch (sort) {
      case 'newest': return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
      case 'oldest': return new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime();
      case 'name-az': return a.original_name.localeCompare(b.original_name);
      case 'name-za': return b.original_name.localeCompare(a.original_name);
      case 'largest': return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
      case 'smallest': return (a.size_bytes ?? 0) - (b.size_bytes ?? 0);
      default: return 0;
    }
  });
}

// --- Sub-components ---

function TypeBadge({ type }: { type: string }) {
  return <span className={TYPE_BADGE_CLS[type] ?? 'badge-other'}>{TYPE_LABELS[type] ?? type}</span>;
}

function AssetIcon({ type, className }: { type: string; className?: string }) {
  const cls = className ?? 'w-8 h-8';
  const colorMap: Record<string, string> = {
    '3d': 'text-violet-400',
    audio: 'text-cyan-400',
    image: 'text-emerald-400',
    other: 'text-content-muted',
  };
  const color = colorMap[type] ?? 'text-content-muted';

  if (type === '3d') return (
    <svg className={`${cls} ${color}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  );
  if (type === 'audio') return (
    <svg className={`${cls} ${color}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
    </svg>
  );
  if (type === 'image') return (
    <svg className={`${cls} ${color}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
  return (
    <svg className={`${cls} ${color}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function AssetThumbnail({ asset, className }: { asset: Asset; className?: string }) {
  if (asset.asset_type === 'image' && asset.thumbnail_key) {
    return (
      <img
        src={thumbnailUrl(asset.id)}
        alt=""
        className={`w-full h-full object-cover ${className ?? ''}`}
        loading="lazy"
      />
    );
  }
  return (
    <div className="flex items-center justify-center w-full h-full">
      <AssetIcon type={asset.asset_type} className={className ? undefined : 'w-8 h-8'} />
    </div>
  );
}

// --- Asset Card ---

function LicenseBadge({ license }: { license: string }) {
  const normalized = license.toLowerCase();
  let cls = 'bg-surface-4 text-content-secondary';
  if (normalized.includes('commercial')) cls = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  else if (normalized.includes('royalty')) cls = 'bg-blue-500/15 text-blue-700 dark:text-blue-300';
  else if (normalized.includes('personal')) cls = 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return (
    <span className={`badge ${cls}`} title={`License: ${license}`}>
      <svg className="w-2.5 h-2.5 mr-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      {license}
    </span>
  );
}

function AssetCard({
  asset,
  categoryName,
  onTagClick,
  activeTagFilters,
  onClick,
  onDetails,
  onAddToCollection,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  asset: Asset;
  categoryName?: string;
  onTagClick: (name: string) => void;
  activeTagFilters: string[];
  onClick: () => void;
  onDetails: () => void;
  onAddToCollection?: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const palette = (name: string) => tagPalette(name);
  const [menuOpen, setMenuOpen] = useState(false);

  function handleCardClick() {
    if (selectionMode) {
      onToggleSelect?.(asset.id);
    } else {
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className={`card flex flex-col overflow-hidden cursor-pointer hover:border-border-light transition-all hover:shadow-lg hover:shadow-black/20 group outline-none focus-visible:ring-2 focus-visible:ring-accent/50 relative ${selected ? 'ring-2 ring-accent border-accent' : ''}`}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-surface-3 overflow-hidden flex items-center justify-center relative">
        <AssetThumbnail asset={asset} />
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {!selectionMode && <TypeBadge type={asset.asset_type} />}
          {!selectionMode && categoryName && (
            <span className="badge bg-surface-0/80 text-content-secondary backdrop-blur-sm text-[10px]">{categoryName}</span>
          )}
        </div>
        {/* Checkbox overlay in selection mode */}
        {selectionMode && (
          <div
            className="absolute inset-0 flex items-start justify-start p-2"
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(asset.id); }}
          >
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={() => onToggleSelect?.(asset.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-5 h-5 rounded cursor-pointer accent-violet-500"
            />
          </div>
        )}
        {/* Context menu trigger (hidden in selection mode) */}
        {!selectionMode && (
        <div
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <button
              className="btn-ghost btn-sm p-1 bg-surface-0/80 backdrop-blur-sm rounded"
              aria-label="Asset options"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 6a2 2 0 110-4 2 2 0 010 4zm0 8a2 2 0 110-4 2 2 0 010 4zm0 8a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 card py-1 min-w-[120px] shadow-xl">
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-3 transition-colors flex items-center gap-2"
                    onClick={() => { setMenuOpen(false); onClick(); }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Preview
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-3 transition-colors flex items-center gap-2"
                    onClick={() => { setMenuOpen(false); onDetails(); }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    Details
                  </button>
                  {onAddToCollection && (
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-3 transition-colors flex items-center gap-2"
                      onClick={() => { setMenuOpen(false); onAddToCollection(); }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25A2.25 2.25 0 004.5 16.5h15a2.25 2.25 0 002.25-2.25V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      Add to Collection
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <p
          className="text-sm font-medium text-content-primary leading-tight truncate"
          title={asset.original_name}
        >
          {asset.original_name}
        </p>

        {asset.tags && asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
            {asset.tags.slice(0, 3).map((tag) => {
              const p = palette(tag.name);
              const active = activeTagFilters.includes(tag.name);
              return (
                <button
                  key={tag.id}
                  onClick={() => onTagClick(tag.name)}
                  className={`text-xs px-1.5 py-0.5 rounded-full font-medium transition-all ${p.bg} ${p.text} ${active ? `ring-1 ${p.ring}` : 'hover:opacity-80'}`}
                >
                  {tag.name}
                </button>
              );
            })}
            {asset.tags.length > 3 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-4 text-content-muted">
                +{asset.tags.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between text-xs text-content-muted pt-1">
          <span className="tabular-nums">{formatBytes(asset.size_bytes ?? 0)}</span>
          {asset.license ? (
            <LicenseBadge license={asset.license} />
          ) : (
            <span>{formatDate(asset.uploaded_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Version History ---

function VersionHistory({ assetId }: { assetId: string }) {
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    listVersions(assetId)
      .then(setVersions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [assetId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const v = await uploadVersion(assetId, file, message);
      setVersions((prev) => {
        const withoutOld = prev.filter((p) => p.version_number !== 1);
        return [...withoutOld, ...(prev.length === 0 ? [{ ...v, version_number: 1 } as AssetVersion] : []), v]
          .sort((a, b) => a.version_number - b.version_number);
      });
      // Reload to get accurate snapshot
      const updated = await listVersions(assetId);
      setVersions(updated);
      setMessage('');
      setShowUpload(false);
    } catch {
      // ignore
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="w-4 h-4 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {versions.length === 0 ? (
        <div className="card p-4 bg-surface-1 text-center">
          <p className="text-xs text-content-muted">No versions saved yet.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...versions].reverse().map((v, idx) => (
            <div
              key={v.id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${idx === 0 ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface-1'}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-accent text-white' : 'bg-surface-3 text-content-muted'}`}>
                  v{v.version_number}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {idx === 0 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-light">
                      Latest
                    </span>
                  )}
                  <span className="text-xs text-content-muted">
                    {formatDate(v.uploaded_at)}
                  </span>
                  {v.uploader && (
                    <span className="text-xs text-content-muted truncate">
                      · {v.uploader.email.split('@')[0]}
                    </span>
                  )}
                </div>
                {v.message && (
                  <p className="text-xs text-content-secondary mt-0.5 leading-relaxed truncate">
                    "{v.message}"
                  </p>
                )}
                {v.size_bytes !== null && (
                  <p className="text-[10px] text-content-muted mt-0.5 tabular-nums">
                    {formatBytes(v.size_bytes)}
                  </p>
                )}
              </div>
              <a
                href={versionDownloadUrl(assetId, v.id)}
                download
                className="flex-shrink-0 btn-ghost btn-sm text-[11px] text-content-muted hover:text-content-primary"
                title="Download this version"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Upload new version */}
      {!showUpload ? (
        <button
          onClick={() => setShowUpload(true)}
          className="btn-secondary btn-sm text-xs w-full"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload new version
        </button>
      ) : (
        <div className="card p-3 bg-surface-1 space-y-2.5">
          <input
            className="input py-1.5 text-xs w-full"
            placeholder="Commit message (optional)…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setShowUpload(false)}
          />
          <div className="flex items-center gap-2">
            <label className="btn-primary btn-sm text-xs flex-1 justify-center cursor-pointer">
              {uploading ? (
                <>
                  <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Choose file…
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={handleUpload}
              />
            </label>
            <button
              onClick={() => { setShowUpload(false); setMessage(''); }}
              className="btn-ghost btn-sm text-xs"
              disabled={uploading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Share Modal ---

function ShareModal({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getShareLinks(assetId)
      .then(setLinks)
      .catch(() => setError('Failed to load share links.'))
      .finally(() => setLoading(false));
  }, [assetId]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const link = await createShareLink(assetId, 30);
      setLinks([{ id: '', token: link.token, url: link.url, expiresAt: link.expiresAt, createdAt: new Date().toISOString(), createdByUserId: null }]);
    } catch {
      setError('Failed to create share link.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    setError(null);
    try {
      await revokeShareLinks(assetId);
      setLinks([]);
    } catch {
      setError('Failed to revoke share link.');
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeLink = links[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-content">Share Asset</h2>
          <button onClick={onClose} className="text-content-muted hover:text-content" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeLink ? (
          <div className="space-y-3">
            <p className="text-xs text-content-muted">Anyone with this link can download the asset.</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={activeLink.url}
                className="flex-1 text-xs bg-surface-raised border border-border rounded px-2.5 py-1.5 text-content font-mono truncate"
              />
              <button
                onClick={() => handleCopy(activeLink.url)}
                className="btn-secondary btn-sm shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            {activeLink.expiresAt && (
              <p className="text-xs text-content-muted">
                Expires {new Date(activeLink.expiresAt).toLocaleDateString()}
              </p>
            )}
            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="btn-ghost btn-sm text-xs text-danger hover:text-danger w-full mt-1"
            >
              {revoking ? 'Revoking…' : 'Revoke link'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-content-muted">
              Generate a link to share this asset with external reviewers. Links expire in 30 days.
            </p>
            <button onClick={handleCreate} disabled={creating} className="btn-primary btn-sm w-full">
              {creating ? 'Generating…' : 'Generate share link'}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

// --- Asset Detail Modal ---

function AssetDetailModal({
  asset,
  onClose,
  onTagClick,
  onUpdate,
}: {
  asset: Asset;
  onClose: () => void;
  onTagClick: (name: string) => void;
  onUpdate: (updated: Asset) => void;
}) {
  const { categories } = useCategoryContext();
  const [editingTags, setEditingTags] = useState(false);
  const [pendingTags, setPendingTags] = useState<string[]>(asset.tags?.map((t) => t.name) ?? []);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const [editingMeta, setEditingMeta] = useState(false);
  const [editForm, setEditForm] = useState({
    name: asset.original_name,
    description: asset.description ?? '',
    categoryId: asset.category_id ?? '',
    subcategoryId: asset.subcategory_id ?? '',
    tags: asset.tags?.map((t) => t.name) ?? [],
  });
  const [editTagInput, setEditTagInput] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFieldErrors, setSaveFieldErrors] = useState<Record<string, string[]>>({});

  const subcategoriesForEdit = categories.find((c) => c.id === editForm.categoryId)?.subcategories ?? [];

  function startEdit() {
    setEditForm({
      name: asset.original_name,
      description: asset.description ?? '',
      categoryId: asset.category_id ?? '',
      subcategoryId: asset.subcategory_id ?? '',
      tags: asset.tags?.map((t) => t.name) ?? [],
    });
    setEditTagInput('');
    setSaveError(null);
    setSaveFieldErrors({});
    setEditingMeta(true);
  }

  function addEditTag() {
    const name = editTagInput.trim().toLowerCase();
    if (name && !editForm.tags.includes(name)) {
      setEditForm((f) => ({ ...f, tags: [...f.tags, name] }));
    }
    setEditTagInput('');
  }

  function removeEditTag(name: string) {
    setEditForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== name) }));
  }

  async function handleSaveMeta() {
    if (!editForm.name.trim()) { setSaveError('Name is required'); return; }
    setSavingMeta(true);
    setSaveError(null);
    setSaveFieldErrors({});
    try {
      const updated = await updateFile(asset.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        categoryId: editForm.categoryId || null,
        subcategoryId: editForm.subcategoryId || null,
        tags: editForm.tags,
      });
      onUpdate(updated);
      setEditingMeta(false);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string; fields?: Record<string, string[]> } } })?.response?.data;
      const fieldErrs = data?.fields;
      if (fieldErrs && Object.keys(fieldErrs).length > 0) {
        setSaveFieldErrors(fieldErrs);
      } else {
        setSaveError(data?.error ?? 'Save failed. Please try again.');
      }
    } finally {
      setSavingMeta(false);
    }
  }

  useEffect(() => {
    if (!editingTags) setPendingTags(asset.tags?.map((t) => t.name) ?? []);
  }, [asset.tags, editingTags]);

  useEffect(() => {
    if (editingTags) tagInputRef.current?.focus();
  }, [editingTags]);

  const addTag = () => {
    const name = tagInput.trim().toLowerCase();
    if (name && !pendingTags.includes(name)) setPendingTags((prev) => [...prev, name]);
    setTagInput('');
  };

  const removeTag = (name: string) => setPendingTags((prev) => prev.filter((t) => t !== name));

  const handleSaveTags = async () => {
    setSavingTags(true);
    try {
      const updatedTags = await updateAssetTags(asset.id, pendingTags);
      onUpdate({ ...asset, tags: updatedTags });
      setEditingTags(false);
    } finally {
      setSavingTags(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${asset.original_name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteFile(asset.id);
      onUpdate({ ...asset, id: '' }); // sentinel for deletion
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {asset.asset_type === 'image' && asset.thumbnail_key ? (
                <img
                  src={thumbnailUrl(asset.id)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <AssetIcon type={asset.asset_type} className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-content-primary text-sm truncate pr-2">
                {asset.original_name}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <TypeBadge type={asset.asset_type} />
                <span className="text-xs text-content-muted tabular-nums">
                  {formatBytes(asset.size_bytes ?? 0)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!editingMeta && (
              <button
                onClick={startEdit}
                className="btn-ghost btn-sm text-xs text-content-muted hover:text-accent"
                title="Edit metadata"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                Edit
              </button>
            )}
            <button onClick={onClose} className="btn-ghost btn-sm flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">
          {/* Edit form */}
          {editingMeta && (
            <div className="space-y-4">
              <div>
                <label className="label mb-1 block">Name <span className="text-danger">*</span></label>
                <input
                  className="input w-full"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Asset name"
                  autoFocus
                />
                {saveFieldErrors.name?.map((e, i) => (
                  <p key={i} className="text-xs text-danger mt-1">{e}</p>
                ))}
              </div>
              <div>
                <label className="label mb-1 block">Description</label>
                <textarea
                  className="input w-full resize-none"
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description…"
                />
                {saveFieldErrors.description?.map((e, i) => (
                  <p key={i} className="text-xs text-danger mt-1">{e}</p>
                ))}
              </div>
              <div>
                <label className="label mb-1 block">Category</label>
                <select
                  className="input w-full"
                  value={editForm.categoryId}
                  onChange={(e) => setEditForm((f) => ({ ...f, categoryId: e.target.value, subcategoryId: '' }))}
                >
                  <option value="">— None —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {subcategoriesForEdit.length > 0 && (
                <div>
                  <label className="label mb-1 block">Subcategory</label>
                  <select
                    className="input w-full"
                    value={editForm.subcategoryId}
                    onChange={(e) => setEditForm((f) => ({ ...f, subcategoryId: e.target.value }))}
                  >
                    <option value="">— None —</option>
                    {subcategoriesForEdit.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="label mb-1 block">Tags</label>
                <div className="flex flex-wrap gap-1.5 mb-2 min-h-6">
                  {editForm.tags.map((name) => {
                    const p = tagPalette(name);
                    return (
                      <span
                        key={name}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${p.bg} ${p.text}`}
                      >
                        {name}
                        <button
                          onClick={() => removeEditTag(name)}
                          className="opacity-60 hover:opacity-100 ml-0.5"
                          aria-label={`Remove tag ${name}`}
                        >
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    className="input py-1.5 text-xs flex-1"
                    placeholder="Type a tag and press Enter…"
                    value={editTagInput}
                    onChange={(e) => setEditTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addEditTag(); }
                    }}
                  />
                  <button onClick={addEditTag} className="btn-secondary btn-sm text-xs">Add</button>
                </div>
                {saveFieldErrors.tags?.map((e, i) => (
                  <p key={i} className="text-xs text-danger mt-1">{e}</p>
                ))}
              </div>
              {saveError && (
                <p className="text-xs text-danger">{saveError}</p>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => { setEditingMeta(false); setSaveError(null); setSaveFieldErrors({}); }}
                  className="btn-ghost btn-sm text-xs"
                  disabled={savingMeta}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMeta}
                  className="btn-primary btn-sm text-xs"
                  disabled={savingMeta}
                >
                  {savingMeta ? (
                    <>
                      <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save changes'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Preview */}
          {!editingMeta && asset.asset_type === 'image' && asset.thumbnail_key && (
            <div className="rounded-xl overflow-hidden bg-surface-3 flex items-center justify-center">
              <img
                src={thumbnailUrl(asset.id)}
                alt={asset.original_name}
                className="max-w-full max-h-64 object-contain"
              />
            </div>
          )}
          {!editingMeta && asset.asset_type === 'audio' && (
            <div className="card p-4 bg-surface-1">
              <AudioPreview assetId={asset.id} />
            </div>
          )}
          {!editingMeta && asset.asset_type === '3d' && (
            <div className="card overflow-hidden bg-surface-1" style={{ height: '180px' }}>
              <Preview3D assetId={asset.id} filename={asset.original_name} />
            </div>
          )}

          {/* Metadata */}
          {!editingMeta && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <div className="label">Uploaded</div>
              <div className="text-content-primary">{formatDate(asset.uploaded_at)}</div>
            </div>
            <div>
              <div className="label">File size</div>
              <div className="text-content-primary tabular-nums">{formatBytes(asset.size_bytes ?? 0)}</div>
            </div>
            <div className="col-span-2">
              <div className="label">MIME type</div>
              <div className="text-content-primary font-mono text-xs">{asset.mime_type ?? '—'}</div>
            </div>
          </div>
          )}

          {!editingMeta && asset.description && (
            <div>
              <div className="label">Description</div>
              <p className="text-sm text-content-secondary leading-relaxed">{asset.description}</p>
            </div>
          )}

          {/* Tags */}
          {!editingMeta && <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="label mb-0">Tags</span>
              {!editingTags && (
                <button
                  onClick={() => setEditingTags(true)}
                  className="text-xs text-accent-light hover:text-accent transition-colors"
                >
                  Edit tags
                </button>
              )}
            </div>

            {!editingTags ? (
              <div className="flex flex-wrap gap-1.5 min-h-6">
                {asset.tags && asset.tags.length > 0 ? (
                  asset.tags.map((tag) => {
                    const p = tagPalette(tag.name);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => { onClose(); onTagClick(tag.name); }}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium transition-opacity ${p.bg} ${p.text} hover:opacity-80`}
                      >
                        {tag.name}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs text-content-muted italic">No tags — click "Edit tags" to add some</span>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5 min-h-6">
                  {pendingTags.length === 0 && (
                    <span className="text-xs text-content-muted italic">No tags</span>
                  )}
                  {pendingTags.map((name) => {
                    const p = tagPalette(name);
                    return (
                      <span
                        key={name}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${p.bg} ${p.text}`}
                      >
                        {name}
                        <button
                          onClick={() => removeTag(name)}
                          className="opacity-60 hover:opacity-100 ml-0.5"
                          aria-label={`Remove tag ${name}`}
                        >
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    ref={tagInputRef}
                    className="input py-1.5 text-xs flex-1"
                    placeholder="Type a tag name and press Enter…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                      if (e.key === 'Escape') setEditingTags(false);
                    }}
                  />
                  <button onClick={addTag} className="btn-secondary btn-sm text-xs">Add</button>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setEditingTags(false); setPendingTags(asset.tags?.map((t) => t.name) ?? []); }}
                    className="btn-ghost btn-sm text-xs"
                    disabled={savingTags}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveTags}
                    className="btn-primary btn-sm text-xs"
                    disabled={savingTags}
                  >
                    {savingTags ? (
                      <>
                        <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save tags'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>}

          {/* Version history */}
          {!editingMeta && (
          <div>
            <div className="label mb-2.5">Version history</div>
            <VersionHistory assetId={asset.id} />
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <a href={downloadUrl(asset.id)} download className="btn-primary btn-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download
            </a>
            <button onClick={() => setSharingOpen(true)} className="btn-secondary btn-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185z" />
              </svg>
              Share
            </button>
          </div>
          {sharingOpen && <ShareModal assetId={asset.id} onClose={() => setSharingOpen(false)} />}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn-ghost btn-sm text-xs text-content-muted hover:text-danger"
          >
            {deleting ? (
              <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Asset List Row (list view) ---

function AssetListRow({
  asset,
  categoryName,
  onTagClick,
  activeTagFilters,
  onClick,
  onDetails,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  asset: Asset;
  categoryName?: string;
  onTagClick: (name: string) => void;
  activeTagFilters: string[];
  onClick: () => void;
  onDetails: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const ext = asset.original_name.includes('.') ? asset.original_name.split('.').pop()!.toLowerCase() : null;

  function handleRowClick() {
    if (selectionMode) {
      onToggleSelect?.(asset.id);
    } else {
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={(e) => e.key === 'Enter' && handleRowClick()}
      className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/50 hover:bg-surface-2 cursor-pointer transition-colors group outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${selected ? 'bg-accent/5' : ''}`}
    >
      {/* Checkbox in selection mode */}
      {selectionMode && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect?.(asset.id)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded cursor-pointer accent-violet-500 flex-shrink-0"
        />
      )}
      {/* Thumbnail / icon */}
      <div className="w-10 h-10 rounded-lg bg-surface-3 flex-shrink-0 overflow-hidden flex items-center justify-center">
        {asset.asset_type === 'image' && asset.thumbnail_key ? (
          <img src={`/api/files/${asset.id}/thumbnail`} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <AssetIcon type={asset.asset_type} className="w-5 h-5" />
        )}
      </div>

      {/* Name + ext badge */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-content-primary truncate" title={asset.original_name}>
          {asset.original_name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {ext && (
            <span className="text-[10px] font-mono text-content-muted bg-surface-3 px-1.5 py-0.5 rounded uppercase">{ext}</span>
          )}
          {categoryName && (
            <span className="text-[10px] text-content-muted">{categoryName}</span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="hidden md:flex items-center gap-1 flex-shrink-0 max-w-[160px]" onClick={(e) => e.stopPropagation()}>
        {asset.tags?.slice(0, 2).map((tag) => {
          const p = tagPalette(tag.name);
          const active = activeTagFilters.includes(tag.name);
          return (
            <button
              key={tag.id}
              onClick={() => onTagClick(tag.name)}
              className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${p.bg} ${p.text} ${active ? 'ring-1 ring-offset-0' : 'hover:opacity-80'} truncate max-w-[72px]`}
            >
              {tag.name}
            </button>
          );
        })}
        {(asset.tags?.length ?? 0) > 2 && (
          <span className="text-[10px] text-content-muted">+{(asset.tags?.length ?? 0) - 2}</span>
        )}
      </div>

      {/* Size */}
      <span className="hidden sm:block text-xs text-content-muted tabular-nums flex-shrink-0 w-16 text-right">
        {formatBytes(asset.size_bytes ?? 0)}
      </span>

      {/* Date */}
      <span className="hidden lg:block text-xs text-content-muted flex-shrink-0 w-24 text-right">
        {formatDate(asset.uploaded_at)}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClick}
          className="btn-ghost btn-sm p-1.5"
          aria-label="Preview"
          title="Preview"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button
          onClick={onDetails}
          className="btn-ghost btn-sm p-1.5"
          aria-label="Details"
          title="Details"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- Add to Collection Inline Modal ---

function AddToCollectionInlineModal({
  assetId,
  collections,
  onClose,
  onCollectionCreated,
}: {
  assetId: string;
  collections: Collection[];
  onClose: () => void;
  onCollectionCreated: (c: Collection) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleAdd(collectionId: string) {
    setAdding(collectionId);
    try {
      await addAssetsToCollection(collectionId, [assetId]);
      setDone((prev) => new Set([...prev, collectionId]));
    } catch {
      // silently ignore duplicate / network error
    } finally {
      setAdding(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const c = await createCollection(newName.trim());
      onCollectionCreated(c);
      await handleAdd(c.id);
      setNewName('');
      setShowCreate(false);
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-content-primary">Add to Collection</h2>
          <button onClick={onClose} className="btn-ghost btn-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 max-h-56 overflow-y-auto">
          {collections.length === 0 && !showCreate ? (
            <p className="text-sm text-content-muted text-center py-3">No collections yet.</p>
          ) : (
            <div className="space-y-1">
              {collections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleAdd(c.id)}
                  disabled={adding === c.id || done.has(c.id)}
                  className="w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-3 transition-colors disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content-primary truncate">{c.name}</p>
                    <p className="text-xs text-content-muted">{c.asset_count} assets</p>
                  </div>
                  {done.has(c.id) ? (
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : adding === c.id ? (
                    <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-4 pt-2 border-t border-border">
          {showCreate ? (
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                className="input py-1.5 text-xs flex-1"
                placeholder="Collection name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              <button type="submit" disabled={creating || !newName.trim()} className="btn-primary btn-sm text-xs">
                {creating ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : 'Create'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost btn-sm text-xs">Cancel</button>
            </form>
          ) : (
            <button onClick={() => setShowCreate(true)} className="btn-secondary btn-sm text-xs w-full">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main AssetBrowser ---

export function AssetBrowser({ initialDetailAssetId }: { initialDetailAssetId?: string | null } = {}) {
  const initial = getUrlFilters();
  const {
    searchQuery,
    categories,
    selectedCategoryId,
    selectedSubcategoryId,
    setSearchQuery: setGlobalSearch,
    setSelectedCategoryId,
    setSelectedSubcategoryId,
  } = useCategoryContext();
  const [debouncedQuery, setDebouncedQuery] = useState(initial.q);
  const [selectedExts, setSelectedExts] = useState<string[]>(initial.exts);
  const [selectedTags, setSelectedTags] = useState<string[]>(initial.tags);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const upload = useUpload();
  const [sort, setSort] = useState<SortKey>(initial.sort);

  const categoryMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  const subcategoryMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) {
      for (const s of c.subcategories) m[s.id] = s.name;
    }
    return m;
  }, [categories]);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionPending, setBulkActionPending] = useState(false);

  // Add to Collection state
  const [addToCollectionAssetId, setAddToCollectionAssetId] = useState<string | null>(null);
  const [collectionsForModal, setCollectionsForModal] = useState<Collection[]>([]);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);

  async function openAddToCollection(assetId: string) {
    setAddToCollectionAssetId(assetId);
    if (!collectionsLoaded) {
      try {
        const cols = await listCollections();
        setCollectionsForModal(cols);
        setCollectionsLoaded(true);
      } catch {
        setCollectionsForModal([]);
      }
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === displayed.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayed.map((a) => a.id)));
    }
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkDownload() {
    if (selectedIds.size === 0) return;
    setBulkActionPending(true);
    try {
      await bulkDownload(Array.from(selectedIds));
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setBulkActionPending(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected asset${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkActionPending(true);
    try {
      const result = await bulkDelete(Array.from(selectedIds));
      setAssets((prev) => prev.filter((a) => !result.deleted.includes(a.id)));
      listTags().then(setAllTags).catch(() => {});
      exitSelectionMode();
      if (result.errors.length > 0) {
        setError(`${result.deleted.length} deleted; ${result.errors.length} failed.`);
      }
    } catch {
      setError('Bulk delete failed. Please try again.');
    } finally {
      setBulkActionPending(false);
    }
  }

  useEffect(() => {
    if (!initialDetailAssetId) return;
    getAssetById(initialDetailAssetId).then(setDetailAsset).catch(() => {});
  }, [initialDetailAssetId]);

  // Debounce search from context
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // Track popstate restores to avoid pushing a duplicate history entry
  const isRestoringFromHistory = useRef(false);

  // Restore filter state on browser back/forward
  useEffect(() => {
    function handlePopState() {
      const filters = getUrlFilters();
      isRestoringFromHistory.current = true;
      setGlobalSearch(filters.q);
      setDebouncedQuery(filters.q);
      setSelectedExts(filters.exts);
      setSelectedTags(filters.tags);
      setSort(filters.sort);
      setSelectedCategoryId(filters.category);
      setSelectedSubcategoryId(filters.subcategory);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Restore category/subcategory from URL once categories are loaded
  const urlRestoredRef = useRef(false);
  useEffect(() => {
    if (urlRestoredRef.current || categories.length === 0) return;
    const { category: catId, subcategory: subId } = initial;
    if (catId) {
      const cat = categories.find((c) => c.id === catId);
      if (cat) {
        setSelectedCategoryId(catId);
        if (subId) {
          const sub = cat.subcategories.find((s) => s.id === subId);
          if (sub) setSelectedSubcategoryId(subId);
        }
      }
    }
    urlRestoredRef.current = true;
  }, [categories]);

  // Auto-switch to relevance sort when search becomes active
  useEffect(() => {
    if (debouncedQuery && sort === 'newest') setSort('relevance');
    if (!debouncedQuery && sort === 'relevance') setSort('newest');
  }, [debouncedQuery]);

  // Sync URL (skip during popstate restores to avoid creating a duplicate forward entry)
  useEffect(() => {
    if (isRestoringFromHistory.current) {
      isRestoringFromHistory.current = false;
      return;
    }
    pushUrlFilters({ q: debouncedQuery, exts: selectedExts, tags: selectedTags, sort, category: selectedCategoryId, subcategory: selectedSubcategoryId });
  }, [debouncedQuery, selectedExts, selectedTags, sort, selectedCategoryId, selectedSubcategoryId]);


  // Load tags
  useEffect(() => {
    listTags().then(setAllTags).catch(() => {});
  }, []);

  // Available file extensions computed from loaded assets (dynamic per taxonomy context)
  const availableExts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assets) {
      const ext = getExtension(a.original_name);
      counts[ext] = (counts[ext] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => ({ ext, count }));
  }, [assets]);

  // Load assets on filter change
  useEffect(() => {
    setLoading(true);
    setError(null);
    listFiles({
      q: debouncedQuery || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      categoryId: selectedCategoryId ?? undefined,
      subcategoryId: selectedSubcategoryId ?? undefined,
    })
      .then(setAssets)
      .catch(() => setError('Failed to load assets.'))
      .finally(() => setLoading(false));
  }, [debouncedQuery, selectedTags.join(','), selectedCategoryId, selectedSubcategoryId]);

  const displayed = useMemo(() => {
    let result = assets;
    if (selectedExts.length > 0) {
      result = result.filter((a) => selectedExts.includes(getExtension(a.original_name)));
    }
    if (selectedCategoryId) {
      result = result.filter((a) => a.category_id === selectedCategoryId);
    }
    if (selectedSubcategoryId) {
      result = result.filter((a) => a.subcategory_id === selectedSubcategoryId);
    }
    return sortAssets(result, sort);
  }, [assets, selectedExts, selectedCategoryId, selectedSubcategoryId, sort]);

  const hasFilters = !!(debouncedQuery || selectedExts.length || selectedTags.length || selectedCategoryId || selectedSubcategoryId);

  function clearFilters() {
    setGlobalSearch('');
    setSelectedCategoryId(null);
    setSelectedSubcategoryId(null);
    setSelectedExts([]);
    setSelectedTags([]);
    setSort('newest');
  }

  function toggleExt(ext: string) {
    setSelectedExts((prev) =>
      prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext],
    );
  }

  function toggleTag(name: string) {
    setSelectedTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  // Upload drop
  const onDrop = useCallback(async (files: File[]) => {
    if (!files.length) return;
    upload.setUploading(true);
    upload.setProgress(0);
    try {
      const added = await uploadFiles(files, upload.setProgress);
      setAssets((prev) => [...added, ...prev]);
      listTags().then(setAllTags).catch(() => {});
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      upload.setUploading(false);
      upload.setProgress(0);
    }
  }, [upload]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  function handleWizardComplete(asset: Asset) {
    setAssets((prev) => [asset, ...prev]);
    listTags().then(setAllTags).catch(() => {});
    upload.closeWizard();
  }

  function handleAssetUpdate(updated: Asset) {
    if (!updated.id) {
      // Deletion sentinel
      setAssets((prev) => prev.filter((a) => a.id !== detailAsset?.id));
      listTags().then(setAllTags).catch(() => {});
      return;
    }
    setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setDetailAsset(updated);
    listTags().then(setAllTags).catch(() => {});
  }

  const sortOptions = debouncedQuery
    ? SORT_OPTIONS
    : SORT_OPTIONS.filter((o) => o.value !== 'relevance');

  return (
    <div {...getRootProps()} className="flex flex-1 h-full overflow-hidden">
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="fixed inset-0 z-50 bg-accent/20 border-2 border-accent border-dashed flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-accent-light font-semibold text-xl">Drop to upload</p>
            <p className="text-accent/70 text-sm mt-1">Files will be added to your vault</p>
          </div>
        </div>
      )}

      {/* Filter sidebar */}
      <aside className={`flex-shrink-0 border-r border-border flex flex-col bg-surface-1 transition-all duration-200 ${sidebarOpen ? 'w-60' : 'w-10'}`}>
        {/* Sidebar header with collapse toggle */}
        <div className={`px-2 py-3.5 border-b border-border flex items-center ${sidebarOpen ? 'justify-between px-4' : 'justify-center'}`}>
          {sidebarOpen && (
            <>
              <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">Filters</span>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-accent-light hover:text-accent transition-colors"
                >
                  Clear all
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Collapse filters' : 'Expand filters'}
            className={`flex-shrink-0 p-1 rounded text-content-muted hover:text-content-primary hover:bg-surface-3 transition-colors ${sidebarOpen ? '' : 'mx-auto'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              {sidebarOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              }
            </svg>
          </button>
        </div>

        {sidebarOpen && (
          <div className="overflow-y-auto flex-1">
            {/* File type filter — dynamic from loaded assets */}
            {availableExts.length > 0 && (
              <div className="px-4 py-3 border-b border-border/50">
                <div className="text-[10px] font-semibold text-content-muted uppercase tracking-widest mb-2">
                  File type
                </div>
                {availableExts.map(({ ext, count }) => (
                  <label
                    key={ext}
                    className="flex items-center gap-2.5 py-1.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedExts.includes(ext)}
                      onChange={() => toggleExt(ext)}
                      className="w-3.5 h-3.5 rounded cursor-pointer accent-violet-500"
                    />
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${EXT_DOT_CLS[ext] ?? 'bg-content-muted'}`} />
                    <span className="text-sm text-content-secondary group-hover:text-content-primary transition-colors flex-1 font-mono">
                      .{ext}
                    </span>
                    <span className="text-[10px] text-content-muted tabular-nums flex-shrink-0">{count}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Tags filter */}
            {allTags.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[10px] font-semibold text-content-muted uppercase tracking-widest mb-2">
                  Tags
                </div>
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {allTags.map((tag) => {
                    const p = tagPalette(tag.name);
                    return (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2.5 py-1.5 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTags.includes(tag.name)}
                          onChange={() => toggleTag(tag.name)}
                          className="w-3.5 h-3.5 rounded cursor-pointer accent-violet-500 flex-shrink-0"
                        />
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-1 min-w-0 truncate ${p.bg} ${p.text}`}
                        >
                          {tag.name}
                        </span>
                        <span className="text-[10px] text-content-muted tabular-nums flex-shrink-0">
                          {tag.asset_count}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-border flex-shrink-0 bg-surface-0/60">
          <div className="flex items-center gap-2 ml-auto">
            {/* Select toggle */}
            <button
              onClick={() => { if (selectionMode) { exitSelectionMode(); } else { setSelectionMode(true); } }}
              className={`btn-sm text-xs px-3 py-1.5 rounded-lg border transition-colors ${selectionMode ? 'bg-accent/15 text-accent-light border-accent/30 hover:bg-accent/25' : 'border-border text-content-muted hover:text-content-primary hover:bg-surface-3'}`}
            >
              {selectionMode ? 'Cancel' : 'Select'}
            </button>
            {/* View toggle */}
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                aria-label="Card view"
                title="Card view"
                className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-surface-3 text-content-primary' : 'text-content-muted hover:text-content-primary hover:bg-surface-2'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                aria-label="List view"
                title="List view"
                className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-surface-3 text-content-primary' : 'text-content-muted hover:text-content-primary hover:bg-surface-2'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </button>
            </div>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="input py-2 w-auto text-sm bg-surface-2 cursor-pointer"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Active filter chips + result count */}
        {(!loading && (hasFilters || displayed.length > 0)) && (
          <div className="px-6 py-2 flex items-center gap-2 flex-wrap border-b border-border/50 flex-shrink-0 bg-surface-0/30 min-h-[40px]">
            <span className="text-xs text-content-muted">
              {loading ? '…' : `${displayed.length} ${displayed.length === 1 ? 'asset' : 'assets'}`}
            </span>
            {selectedCategoryId && (
              <button
                onClick={() => setSelectedCategoryId(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/15 text-accent-light hover:bg-accent/25 transition-colors"
              >
                {categoryMap[selectedCategoryId] ?? 'Category'}
                <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {selectedSubcategoryId && (
              <button
                onClick={() => setSelectedSubcategoryId(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/10 text-accent-light hover:bg-accent/20 transition-colors"
              >
                {subcategoryMap[selectedSubcategoryId] ?? 'Subcategory'}
                <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {selectedExts.map((ext) => (
              <button
                key={ext}
                onClick={() => toggleExt(ext)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-surface-3 text-content-secondary hover:bg-surface-4 transition-colors font-mono"
              >
                .{ext}
                <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ))}
            {selectedTags.map((t) => {
              const p = tagPalette(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${p.bg} ${p.text}`}
                >
                  {t}
                  <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm flex-shrink-0">
            {error}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
            </div>
          )}

          {/* Empty — no assets in vault */}
          {!loading && assets.length === 0 && !hasFilters && (
            <div
              className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-border rounded-2xl cursor-pointer hover:border-accent/40 transition-colors"
              onClick={upload.openWizard}
            >
              <div className="w-16 h-16 rounded-2xl bg-surface-3 flex items-center justify-center mb-5">
                <svg className="w-8 h-8 text-content-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-content-secondary font-semibold text-base">Your vault is empty</p>
              <p className="text-content-muted text-sm mt-1.5 max-w-xs text-center leading-relaxed">
                Drop files here or click Upload to add your first assets. Supports 3D models, audio, images, and more.
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); upload.openWizard(); }}
                className="btn-primary mt-5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Upload assets
              </button>
            </div>
          )}

          {/* Empty — no results for active filters */}
          {!loading && displayed.length === 0 && hasFilters && (
            <div className="flex flex-col items-center justify-center py-24">
              <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-content-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <p className="text-content-secondary font-semibold">No results found</p>
              <p className="text-content-muted text-sm mt-1.5">Try adjusting your search or removing some filters</p>
              <button onClick={clearFilters} className="btn-secondary mt-4 text-xs">
                Clear all filters
              </button>
            </div>
          )}

          {/* Asset grid / list */}
          {!loading && displayed.length > 0 && viewMode === 'grid' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {displayed.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  categoryName={asset.category_id ? categoryMap[asset.category_id] : undefined}
                  onTagClick={toggleTag}
                  activeTagFilters={selectedTags}
                  onClick={() => setPreviewAsset(asset)}
                  onDetails={() => setDetailAsset(asset)}
                  onAddToCollection={() => openAddToCollection(asset.id)}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(asset.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}

          {!loading && displayed.length > 0 && viewMode === 'list' && (
            <div className="card overflow-hidden">
              {/* List header */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-1 text-[10px] font-semibold uppercase tracking-widest text-content-muted">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.size === displayed.length && displayed.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded cursor-pointer accent-violet-500 flex-shrink-0"
                    aria-label="Select all"
                  />
                )}
                <div className="w-10 flex-shrink-0" />
                <div className="flex-1">Name</div>
                <div className="hidden md:block w-40">Tags</div>
                <div className="hidden sm:block w-16 text-right">Size</div>
                <div className="hidden lg:block w-24 text-right">Date</div>
                <div className="w-16" />
              </div>
              {displayed.map((asset) => (
                <AssetListRow
                  key={asset.id}
                  asset={asset}
                  categoryName={asset.category_id ? categoryMap[asset.category_id] : undefined}
                  onTagClick={toggleTag}
                  activeTagFilters={selectedTags}
                  onClick={() => setPreviewAsset(asset)}
                  onDetails={() => setDetailAsset(asset)}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(asset.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upload wizard */}
      <UploadWizard
        open={upload.showWizard}
        onClose={upload.closeWizard}
        onComplete={handleWizardComplete}
      />

      {/* Detail modal */}
      {detailAsset && (
        <AssetDetailModal
          asset={detailAsset}
          onClose={() => setDetailAsset(null)}
          onTagClick={toggleTag}
          onUpdate={handleAssetUpdate}
        />
      )}

      {/* File viewer */}
      {previewAsset && (
        <FileViewer
          asset={previewAsset}
          assets={displayed}
          onClose={() => setPreviewAsset(null)}
          onOpenDetails={() => {
            setDetailAsset(previewAsset);
            setPreviewAsset(null);
          }}
        />
      )}

      {/* Add to Collection modal */}
      {addToCollectionAssetId && (
        <AddToCollectionInlineModal
          assetId={addToCollectionAssetId}
          collections={collectionsForModal}
          onClose={() => setAddToCollectionAssetId(null)}
          onCollectionCreated={(c) => setCollectionsForModal((prev) => [c, ...prev])}
        />
      )}

      {/* Floating bulk action bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface-1 border border-border shadow-2xl shadow-black/40">
          <span className="text-sm font-medium text-content-primary whitespace-nowrap">
            {selectedIds.size} {selectedIds.size === 1 ? 'asset' : 'assets'} selected
          </span>
          <div className="w-px h-5 bg-border flex-shrink-0" />
          <button
            onClick={handleBulkDownload}
            disabled={bulkActionPending}
            className="btn-secondary btn-sm text-xs flex items-center gap-1.5"
          >
            {bulkActionPending ? (
              <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            Download ZIP
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkActionPending}
            className="btn-sm text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger/15 text-danger hover:bg-danger/25 transition-colors border border-danger/20"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
