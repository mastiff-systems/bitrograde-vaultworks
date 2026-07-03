import { useEffect, useState } from 'react';
import {
  listCollections,
  createCollection,
  getCollection,
  deleteCollection,
  removeAssetFromCollection,
  addAssetsToCollection,
  type Collection,
  type CollectionDetail,
} from '../api/collections.js';
import { thumbnailUrl } from '../api/client.js';

function CollectionIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25A2.25 2.25 0 004.5 16.5h15a2.25 2.25 0 002.25-2.25V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function NewCollectionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (c: Collection) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const c = await createCollection(name.trim(), description.trim() || undefined);
      onCreate(c);
    } catch {
      setError('Failed to create collection. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-content-primary">New Collection</h2>
          <button onClick={onClose} className="btn-ghost btn-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="label mb-1 block">Name <span className="text-danger">*</span></label>
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Collection name"
              autoFocus
            />
          </div>
          <div>
            <label className="label mb-1 block">Description</label>
            <textarea
              className="input w-full resize-none"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn-ghost btn-sm text-xs" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm text-xs" disabled={saving}>
              {saving ? (
                <>
                  <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                  Creating…
                </>
              ) : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddToCollectionModal({
  assetId,
  collections,
  onClose,
  onAdded,
}: {
  assetId: string;
  collections: Collection[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  async function handleAdd(collectionId: string) {
    setAdding(collectionId);
    try {
      await addAssetsToCollection(collectionId, [assetId]);
      setDone((prev) => new Set([...prev, collectionId]));
      onAdded();
    } catch {
      // silently ignore
    } finally {
      setAdding(null);
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
        <div className="px-5 py-3 max-h-64 overflow-y-auto">
          {collections.length === 0 ? (
            <p className="text-sm text-content-muted text-center py-4">No collections yet. Create one first.</p>
          ) : (
            <div className="space-y-1">
              {collections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleAdd(c.id)}
                  disabled={adding === c.id || done.has(c.id)}
                  className="w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-3 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CollectionIcon className="w-4 h-4 text-accent flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-content-primary truncate">{c.name}</p>
                      <p className="text-xs text-content-muted">{c.asset_count} assets</p>
                    </div>
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
      </div>
    </div>
  );
}

// Export for use in AssetBrowser context menu
export { AddToCollectionModal };

function CollectionCard({
  collection,
  onClick,
  onDelete,
}: {
  collection: Collection;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteCollection(collection.id);
      onDelete();
    } finally {
      setDeleting(false);
    }
  }

  const preview = collection.preview_asset;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="card flex flex-col overflow-hidden cursor-pointer hover:border-border-light transition-all hover:shadow-lg hover:shadow-black/20 group outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      {/* Thumbnail area */}
      <div className="aspect-video bg-surface-3 flex items-center justify-center overflow-hidden relative">
        {preview && preview.assetType === 'image' && preview.thumbnailKey ? (
          <img
            src={thumbnailUrl(preview.id)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <CollectionIcon className="w-10 h-10 text-content-muted" />
        )}
        {/* Delete button */}
        <div
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn-ghost btn-sm p-1 bg-surface-0/80 backdrop-blur-sm rounded text-content-muted hover:text-danger"
            title="Delete collection"
          >
            {deleting ? (
              <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1">
        <p className="text-sm font-medium text-content-primary truncate">{collection.name}</p>
        {collection.description && (
          <p className="text-xs text-content-muted truncate">{collection.description}</p>
        )}
        <p className="text-xs text-content-muted mt-auto pt-1">
          {collection.asset_count} {collection.asset_count === 1 ? 'asset' : 'assets'}
        </p>
      </div>
    </div>
  );
}

function CollectionDetailView({
  collectionId,
  onBack,
}: {
  collectionId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getCollection(collectionId)
      .then(setDetail)
      .catch(() => setError('Failed to load collection.'))
      .finally(() => setLoading(false));
  }, [collectionId]);

  async function handleRemoveAsset(assetId: string) {
    if (!detail) return;
    await removeAssetFromCollection(collectionId, assetId);
    setDetail((prev) => prev ? { ...prev, assets: prev.assets.filter((a) => a.id !== assetId), asset_count: prev.asset_count - 1 } : prev);
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-content-muted">{error ?? 'Collection not found.'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="btn-ghost btn-sm text-content-muted hover:text-content-primary"
          title="Back to collections"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <CollectionIcon className="w-5 h-5 text-accent flex-shrink-0" />
          <h1 className="text-lg font-semibold text-content-primary truncate">{detail.name}</h1>
          <span className="text-sm text-content-muted flex-shrink-0">({detail.asset_count})</span>
        </div>
      </div>

      {detail.description && (
        <p className="text-sm text-content-secondary mb-5 -mt-2">{detail.description}</p>
      )}

      {detail.assets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <CollectionIcon className="w-12 h-12 text-content-muted mx-auto mb-3" />
            <p className="text-sm text-content-muted">No assets in this collection yet.</p>
            <p className="text-xs text-content-muted mt-1">Add assets from the Asset Browser using the context menu.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {detail.assets.map((asset) => (
            <div key={asset.id} className="card flex flex-col overflow-hidden group">
              <div className="aspect-square bg-surface-3 flex items-center justify-center overflow-hidden relative">
                {asset.asset_type === 'image' && asset.thumbnail_key ? (
                  <img src={thumbnailUrl(asset.id)} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <svg className="w-8 h-8 text-content-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                )}
                {/* Remove button */}
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleRemoveAsset(asset.id)}
                    className="btn-ghost btn-sm p-1 bg-surface-0/80 backdrop-blur-sm rounded text-content-muted hover:text-danger"
                    title="Remove from collection"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-content-primary truncate" title={asset.original_name}>{asset.original_name}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Collections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listCollections()
      .then(setCollections)
      .catch(() => setError('Failed to load collections.'))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(c: Collection) {
    setCollections((prev) => [c, ...prev]);
    setShowNewModal(false);
  }

  function handleDeleted(id: string) {
    setCollections((prev) => prev.filter((c) => c.id !== id));
  }

  if (selectedId) {
    return (
      <CollectionDetailView
        collectionId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <CollectionIcon className="w-5 h-5 text-accent" />
          <h1 className="text-lg font-semibold text-content-primary">Collections</h1>
          {!loading && (
            <span className="text-sm text-content-muted">({collections.length})</span>
          )}
        </div>
        <button onClick={() => setShowNewModal(true)} className="btn-primary btn-sm text-sm">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Collection
        </button>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!loading && !error && collections.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <CollectionIcon className="w-14 h-14 text-content-muted mx-auto mb-4" />
            <h2 className="text-base font-medium text-content-primary mb-1">No collections yet</h2>
            <p className="text-sm text-content-muted mb-4">Create a collection to organise your assets.</p>
            <button onClick={() => setShowNewModal(true)} className="btn-primary btn-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Collection
            </button>
          </div>
        </div>
      )}

      {!loading && !error && collections.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              onClick={() => setSelectedId(c.id)}
              onDelete={() => handleDeleted(c.id)}
            />
          ))}
        </div>
      )}

      {showNewModal && (
        <NewCollectionModal onClose={() => setShowNewModal(false)} onCreate={handleCreated} />
      )}
    </div>
  );
}
