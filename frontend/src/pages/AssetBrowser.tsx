import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  listFiles,
  listTags,
  uploadFiles,
  deleteFile,
  updateAssetTags,
  listVersions,
  uploadVersion,
  downloadUrl,
  thumbnailUrl,
  versionDownloadUrl,
  type Asset,
  type AssetVersion,
  type Tag,
} from '../api/client.js';
import { listFolderAssets } from '../api/folders.js';
import { AudioPreview } from '../components/AudioPreview.js';
import { FolderPanel } from '../components/FolderPanel.js';
import { Preview3D } from '../components/Preview3D.js';
import { FileViewer } from '../components/FileViewer/index.js';
import { UploadWizard } from '../components/UploadWizard/index.js';
import { useCategoryContext } from '../contexts/CategoryContext.js';

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

function getUrlFilters() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') ?? '',
    types: p.getAll('type'),
    tags: p.getAll('tag'),
    sort: (p.get('sort') ?? 'newest') as SortKey,
    category: p.get('category') ?? null,
    subcategory: p.get('subcategory') ?? null,
    folder: p.get('folder') ?? null,
  };
}

function pushUrlFilters(filters: ReturnType<typeof getUrlFilters>) {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  filters.types.forEach((t) => p.append('type', t));
  filters.tags.forEach((t) => p.append('tag', t));
  if (filters.sort && filters.sort !== 'newest') p.set('sort', filters.sort);
  if (filters.category) p.set('category', filters.category);
  if (filters.subcategory) p.set('subcategory', filters.subcategory);
  if (filters.folder) p.set('folder', filters.folder);
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
}: {
  asset: Asset;
  categoryName?: string;
  onTagClick: (name: string) => void;
  activeTagFilters: string[];
  onClick: () => void;
  onDetails: () => void;
}) {
  const palette = (name: string) => tagPalette(name);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="card flex flex-col overflow-hidden cursor-pointer hover:border-border-light transition-all hover:shadow-lg hover:shadow-black/20 group outline-none focus-visible:ring-2 focus-visible:ring-accent/50 relative"
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-surface-3 overflow-hidden flex items-center justify-center relative">
        <AssetThumbnail asset={asset} />
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          <TypeBadge type={asset.asset_type} />
          {categoryName && (
            <span className="badge bg-surface-0/80 text-content-secondary backdrop-blur-sm text-[10px]">{categoryName}</span>
          )}
        </div>
        {/* Context menu trigger */}
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
                </div>
              </>
            )}
          </div>
        </div>
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
  const [editingTags, setEditingTags] = useState(false);
  const [pendingTags, setPendingTags] = useState<string[]>(asset.tags?.map((t) => t.name) ?? []);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

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
          <button onClick={onClose} className="btn-ghost btn-sm flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">
          {/* Preview */}
          {asset.asset_type === 'image' && asset.thumbnail_key && (
            <div className="rounded-xl overflow-hidden bg-surface-3 flex items-center justify-center">
              <img
                src={thumbnailUrl(asset.id)}
                alt={asset.original_name}
                className="max-w-full max-h-64 object-contain"
              />
            </div>
          )}
          {asset.asset_type === 'audio' && (
            <div className="card p-4 bg-surface-1">
              <AudioPreview assetId={asset.id} />
            </div>
          )}
          {asset.asset_type === '3d' && (
            <div className="card overflow-hidden bg-surface-1" style={{ height: '180px' }}>
              <Preview3D assetId={asset.id} filename={asset.original_name} />
            </div>
          )}

          {/* Metadata */}
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

          {asset.description && (
            <div>
              <div className="label">Description</div>
              <p className="text-sm text-content-secondary leading-relaxed">{asset.description}</p>
            </div>
          )}

          {/* Tags */}
          <div>
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
          </div>

          {/* Version history */}
          <div>
            <div className="label mb-2.5">Version history</div>
            <VersionHistory assetId={asset.id} />
          </div>
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
          </div>
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

// --- Main AssetBrowser ---

const ASSET_TYPES = ['3d', 'audio', 'image', 'other'] as const;

export function AssetBrowser() {
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
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initial.types);
  const [selectedTags, setSelectedTags] = useState<string[]>(initial.tags);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  // Active folder: null = show all assets, uuid = show folder assets
  const [activeFolderId, setActiveFolderId] = useState<string | null>(initial.folder);

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

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showWizard, setShowWizard] = useState(false);

  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

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
      setSelectedTypes(filters.types);
      setSelectedTags(filters.tags);
      setSort(filters.sort);
      setSelectedCategoryId(filters.category);
      setSelectedSubcategoryId(filters.subcategory);
      setActiveFolderId(filters.folder);
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
    pushUrlFilters({ q: debouncedQuery, types: selectedTypes, tags: selectedTags, sort, category: selectedCategoryId, subcategory: selectedSubcategoryId, folder: activeFolderId });
  }, [debouncedQuery, selectedTypes, selectedTags, sort, selectedCategoryId, selectedSubcategoryId, activeFolderId]);


  // Load tags
  useEffect(() => {
    listTags().then(setAllTags).catch(() => {});
  }, []);

  // Load assets: branch on activeFolderId — folder view vs. all-assets view
  useEffect(() => {
    setLoading(true);
    setError(null);

    const fetch = activeFolderId
      ? listFolderAssets(activeFolderId, { limit: 200 }).then((page) => page.assets)
      : listFiles({
          q: debouncedQuery || undefined,
          // Pass single type to API; multi-type handled client-side below
          assetType: selectedTypes.length === 1 ? selectedTypes[0] : undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          categoryId: selectedCategoryId ?? undefined,
          subcategoryId: selectedSubcategoryId ?? undefined,
        });

    fetch
      .then(setAssets)
      .catch(() => setError('Failed to load assets.'))
      .finally(() => setLoading(false));
  }, [activeFolderId, debouncedQuery, selectedTypes.join(','), selectedTags.join(','), selectedCategoryId, selectedSubcategoryId]);

  const displayed = useMemo(() => {
    let result = assets;
    if (selectedTypes.length > 1) {
      result = result.filter((a) => selectedTypes.includes(a.asset_type));
    }
    if (selectedCategoryId) {
      result = result.filter((a) => a.category_id === selectedCategoryId);
    }
    if (selectedSubcategoryId) {
      result = result.filter((a) => a.subcategory_id === selectedSubcategoryId);
    }
    return sortAssets(result, sort);
  }, [assets, selectedTypes, selectedCategoryId, selectedSubcategoryId, sort]);

  const hasFilters = !!(debouncedQuery || selectedTypes.length || selectedTags.length || selectedCategoryId || selectedSubcategoryId);

  function clearFilters() {
    setGlobalSearch('');
    setSelectedCategoryId(null);
    setSelectedSubcategoryId(null);
    setSelectedTypes([]);
    setSelectedTags([]);
    setSort('newest');
  }

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
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
    setUploading(true);
    setUploadProgress(0);
    try {
      const added = await uploadFiles(files, setUploadProgress);
      setAssets((prev) => [...added, ...prev]);
      // Refresh tags in case new tags were implied
      listTags().then(setAllTags).catch(() => {});
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

  function handleWizardComplete(asset: Asset) {
    setAssets((prev) => [asset, ...prev]);
    listTags().then(setAllTags).catch(() => {});
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
      <aside className="w-60 flex-shrink-0 border-r border-border overflow-y-auto flex flex-col bg-surface-1">
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">Filters</span>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-accent-light hover:text-accent transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="px-4 py-3 border-b border-border/50">
          <div className="text-[10px] font-semibold text-content-muted uppercase tracking-widest mb-2">
            Asset type
          </div>
          {ASSET_TYPES.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2.5 py-1.5 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={selectedTypes.includes(type)}
                onChange={() => toggleType(type)}
                className="w-3.5 h-3.5 rounded cursor-pointer accent-violet-500"
              />
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT_CLS[type]}`} />
              <span className="text-sm text-content-secondary group-hover:text-content-primary transition-colors flex-1">
                {TYPE_LABELS[type]}
              </span>
            </label>
          ))}
        </div>

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
      </aside>

      {/* Folder sidebar */}
      <FolderPanel activeFolderId={activeFolderId} onSelectFolder={setActiveFolderId} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-border flex-shrink-0 bg-surface-0/60">
          <div className="flex items-center gap-2 ml-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="input py-2 w-auto text-sm bg-surface-2 cursor-pointer"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <button onClick={() => setShowWizard(true)} disabled={uploading} className="btn-primary py-2">
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
            {selectedTypes.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-surface-3 text-content-secondary hover:bg-surface-4 transition-colors"
              >
                {TYPE_LABELS[t]}
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
              onClick={() => setShowWizard(true)}
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
                onClick={(e) => { e.stopPropagation(); setShowWizard(true); }}
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

          {/* Asset grid */}
          {!loading && displayed.length > 0 && (
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
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upload wizard */}
      <UploadWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
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
    </div>
  );
}
