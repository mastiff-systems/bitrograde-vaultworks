import { useEffect, useRef, useState } from 'react';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
} from '../../api/categories.js';
import type { Category, SubcategoryRef } from '../../api/categories.js';

// ── Delete confirmation dialog ────────────────────────────────────────────────

interface DeleteDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

function DeleteDialog({ title, message, onConfirm, onCancel, busy }: DeleteDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface-1 border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-danger/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-danger" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-content-primary text-sm">{title}</h3>
            <p className="text-xs text-content-muted mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="btn-secondary btn-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger btn-sm">
            {busy ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline editable name row ──────────────────────────────────────────────────

interface EditRowProps {
  value: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}

function EditRow({ value, onSave, onCancel }: EditRowProps) {
  const [name, setName] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === value) { onCancel(); return; }
    setBusy(true);
    try { await onSave(trimmed); } finally { setBusy(false); }
  };

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="input py-1.5 text-xs h-8"
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      />
      <button type="submit" disabled={busy} className="btn-primary btn-sm flex-shrink-0">
        {busy ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Save'}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost btn-sm flex-shrink-0">Cancel</button>
    </form>
  );
}

// ── Create row (appended at bottom of list) ───────────────────────────────────

interface CreateRowProps {
  placeholder: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}

function CreateRow({ placeholder, onSave, onCancel }: CreateRowProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onCancel(); return; }
    setBusy(true);
    try { await onSave(trimmed); } finally { setBusy(false); }
  };

  return (
    <form
      className="flex items-center gap-2 px-4 py-2.5 border-t border-border/50"
      onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="input py-1.5 text-xs h-8 flex-1"
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      />
      <button type="submit" disabled={busy || !name.trim()} className="btn-primary btn-sm flex-shrink-0">
        {busy ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Add'}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost btn-sm flex-shrink-0">Cancel</button>
    </form>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DeleteTarget {
  kind: 'category' | 'subcategory';
  id: string;
  name: string;
  assetCount: number;
  categoryId?: string;
}

interface TaxonomyManagerProps {
  /** When true, renders without page chrome for embedding in a Settings tab. */
  embedded?: boolean;
}

export function TaxonomyManager({ embedded = false }: TaxonomyManagerProps = {}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;

  useEffect(() => {
    listCategories()
      .then((cats) => {
        setCategories(cats);
        if (cats.length > 0) setSelectedCategoryId(cats[0].id);
      })
      .catch(() => setError('Failed to load categories.'))
      .finally(() => setLoading(false));
  }, []);

  // ── Category CRUD ────────────────────────────────────────────────────────

  const handleCreateCategory = async (name: string) => {
    const cat = await createCategory(name);
    setCategories((prev) => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedCategoryId(cat.id);
    setShowCreateCategory(false);
  };

  const handleUpdateCategory = async (id: string, name: string) => {
    const updated = await updateCategory(id, name);
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...updated, subcategories: c.subcategories } : c))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditingCategoryId(null);
  };

  const handleDeleteCategory = async () => {
    if (!deleteTarget || deleteTarget.kind !== 'category') return;
    setDeleting(true);
    try {
      await deleteCategory(deleteTarget.id);
      setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      if (selectedCategoryId === deleteTarget.id) {
        setSelectedCategoryId(categories.find((c) => c.id !== deleteTarget.id)?.id ?? null);
      }
      setDeleteTarget(null);
    } catch {
      setError('Failed to delete category.');
    } finally {
      setDeleting(false);
    }
  };

  // ── Subcategory CRUD ─────────────────────────────────────────────────────

  const handleCreateSub = async (name: string) => {
    if (!selectedCategoryId) return;
    const sub = await createSubcategory(selectedCategoryId, name);
    setCategories((prev) =>
      prev.map((c) =>
        c.id === selectedCategoryId
          ? {
              ...c,
              subcategories: [...c.subcategories, { id: sub.id, name: sub.name, slug: sub.slug, asset_count: sub.asset_count }]
                .sort((a, b) => a.name.localeCompare(b.name)),
            }
          : c,
      ),
    );
    setShowCreateSub(false);
  };

  const handleUpdateSub = async (id: string, name: string) => {
    if (!selectedCategoryId) return;
    const updated = await updateSubcategory(selectedCategoryId, id, name);
    setCategories((prev) =>
      prev.map((c) =>
        c.id === selectedCategoryId
          ? {
              ...c,
              subcategories: c.subcategories
                .map((s) => (s.id === id ? { ...s, name: updated.name, slug: updated.slug } : s))
                .sort((a, b) => a.name.localeCompare(b.name)),
            }
          : c,
      ),
    );
    setEditingSubId(null);
  };

  const handleDeleteSub = async () => {
    if (!deleteTarget || deleteTarget.kind !== 'subcategory' || !deleteTarget.categoryId) return;
    setDeleting(true);
    try {
      await deleteSubcategory(deleteTarget.categoryId, deleteTarget.id);
      setCategories((prev) =>
        prev.map((c) =>
          c.id === deleteTarget.categoryId
            ? { ...c, subcategories: c.subcategories.filter((s) => s.id !== deleteTarget.id) }
            : c,
        ),
      );
      setDeleteTarget(null);
    } catch {
      setError('Failed to delete subcategory.');
    } finally {
      setDeleting(false);
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderCategoryRow = (cat: Category) => {
    const isSelected = cat.id === selectedCategoryId;
    const isEditing = editingCategoryId === cat.id;

    return (
      <tr
        key={cat.id}
        onClick={() => { if (!isEditing) { setSelectedCategoryId(cat.id); setShowCreateSub(false); setEditingSubId(null); } }}
        className={`border-b border-border/50 transition-colors cursor-pointer ${isSelected ? 'bg-accent/8' : 'hover:bg-surface-3/40'}`}
      >
        <td className="px-4 py-3">
          {isEditing ? (
            <EditRow
              value={cat.name}
              onSave={(name) => handleUpdateCategory(cat.id, name)}
              onCancel={() => setEditingCategoryId(null)}
            />
          ) : (
            <span className={`text-sm font-medium ${isSelected ? 'text-accent-light' : 'text-content-primary'}`}>
              {cat.name}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-content-muted whitespace-nowrap">
          {cat.subcategories.length} sub
        </td>
        <td className="px-4 py-3 text-xs text-content-muted whitespace-nowrap">
          {cat.asset_count} asset{cat.asset_count !== 1 ? 's' : ''}
        </td>
        <td className="px-4 py-3">
          {!isEditing && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setEditingCategoryId(cat.id); setSelectedCategoryId(cat.id); }}
                className="p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-surface-4 transition-colors"
                title="Rename"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                </svg>
              </button>
              <button
                onClick={() => setDeleteTarget({ kind: 'category', id: cat.id, name: cat.name, assetCount: cat.asset_count })}
                className="p-1.5 rounded text-content-muted hover:text-danger hover:bg-danger/10 transition-colors"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderSubcategoryRow = (sub: SubcategoryRef) => {
    const isEditing = editingSubId === sub.id;

    return (
      <tr key={sub.id} className="border-b border-border/50 hover:bg-surface-3/40 transition-colors">
        <td className="px-4 py-3">
          {isEditing ? (
            <EditRow
              value={sub.name}
              onSave={(name) => handleUpdateSub(sub.id, name)}
              onCancel={() => setEditingSubId(null)}
            />
          ) : (
            <span className="text-sm text-content-primary">{sub.name}</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-content-muted whitespace-nowrap">
          {sub.asset_count} asset{sub.asset_count !== 1 ? 's' : ''}
        </td>
        <td className="px-4 py-3">
          {!isEditing && (
            <div className="flex justify-end gap-1">
              <button
                onClick={() => setEditingSubId(sub.id)}
                className="p-1.5 rounded text-content-muted hover:text-content-primary hover:bg-surface-4 transition-colors"
                title="Rename"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                </svg>
              </button>
              <button
                onClick={() =>
                  setDeleteTarget({
                    kind: 'subcategory',
                    id: sub.id,
                    name: sub.name,
                    assetCount: sub.asset_count,
                    categoryId: selectedCategoryId!,
                  })
                }
                className="p-1.5 rounded text-content-muted hover:text-danger hover:bg-danger/10 transition-colors"
                title="Delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  // ── Delete confirmation message ──────────────────────────────────────────

  const deleteMessage = deleteTarget
    ? deleteTarget.kind === 'category'
      ? deleteTarget.assetCount > 0
        ? `"${deleteTarget.name}" has ${deleteTarget.assetCount} asset${deleteTarget.assetCount !== 1 ? 's' : ''} assigned. They will become uncategorized. This also removes all ${deleteTarget.name} subcategories.`
        : `Delete the category "${deleteTarget.name}" and all its subcategories? This cannot be undone.`
      : deleteTarget.assetCount > 0
        ? `"${deleteTarget.name}" has ${deleteTarget.assetCount} asset${deleteTarget.assetCount !== 1 ? 's' : ''} assigned. They will lose this subcategory. This cannot be undone.`
        : `Delete the subcategory "${deleteTarget.name}"? This cannot be undone.`
    : '';

  return (
    <div className={embedded ? '' : 'flex-1 p-8'}>
      {!embedded && (
        <div className="page-header">
          <div>
            <h1 className="page-title">Taxonomy</h1>
            <p className="page-subtitle">Manage categories and subcategories for asset organization</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-6">
          {/* ── Categories panel ─────────────────────────────────────── */}
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-content-primary">
                Categories
                <span className="ml-2 text-xs font-normal text-content-muted">({categories.length})</span>
              </h2>
              {!showCreateCategory && (
                <button
                  onClick={() => { setShowCreateCategory(true); setEditingCategoryId(null); }}
                  className="btn-secondary btn-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New
                </button>
              )}
            </div>

            <div className="card overflow-hidden">
              {categories.length === 0 && !showCreateCategory ? (
                <div className="px-4 py-10 text-center text-sm text-content-muted">No categories yet</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Subs</th>
                      <th>Assets</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map(renderCategoryRow)}
                  </tbody>
                </table>
              )}
              {showCreateCategory && (
                <CreateRow
                  placeholder="Category name…"
                  onSave={handleCreateCategory}
                  onCancel={() => setShowCreateCategory(false)}
                />
              )}
            </div>
          </div>

          {/* ── Subcategories panel ──────────────────────────────────── */}
          <div className="col-span-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-content-primary">
                {selectedCategory ? (
                  <>
                    Subcategories
                    <span className="ml-1 text-content-muted font-normal">— {selectedCategory.name}</span>
                    <span className="ml-2 text-xs font-normal text-content-muted">
                      ({selectedCategory.subcategories.length})
                    </span>
                  </>
                ) : (
                  'Subcategories'
                )}
              </h2>
              {selectedCategory && !showCreateSub && (
                <button
                  onClick={() => { setShowCreateSub(true); setEditingSubId(null); }}
                  className="btn-secondary btn-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New
                </button>
              )}
            </div>

            <div className="card overflow-hidden">
              {!selectedCategory ? (
                <div className="px-4 py-10 text-center text-sm text-content-muted">
                  Select a category to manage its subcategories
                </div>
              ) : selectedCategory.subcategories.length === 0 && !showCreateSub ? (
                <div className="px-4 py-10 text-center text-sm text-content-muted">No subcategories yet</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Assets</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCategory.subcategories.map(renderSubcategoryRow)}
                  </tbody>
                </table>
              )}
              {showCreateSub && selectedCategory && (
                <CreateRow
                  placeholder="Subcategory name…"
                  onSave={handleCreateSub}
                  onCancel={() => setShowCreateSub(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <DeleteDialog
          title={`Delete ${deleteTarget.kind === 'category' ? 'Category' : 'Subcategory'}`}
          message={deleteMessage}
          onConfirm={deleteTarget.kind === 'category' ? handleDeleteCategory : handleDeleteSub}
          onCancel={() => setDeleteTarget(null)}
          busy={deleting}
        />
      )}
    </div>
  );
}
