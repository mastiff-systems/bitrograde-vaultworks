/**
 * MAS-712: MainSidebar — the single unified left sidebar (per MAS-709 design).
 *
 * Replaces the previous two side-by-side asides (inline Filter sidebar in
 * AssetBrowser + FolderPanel) with ONE aside carrying:
 *  - "All assets" home row (above both sections — clears folder scope)
 *  - FOLDERS section: nested expand/collapse tree, inline create ([+] in the
 *    section header), rename on double-click, hover delete
 *  - FILTERS section: rendered via the `children` slot so filter state stays
 *    in AssetBrowser; "Clear all" lives in the section header
 *
 * Fixes carried over from the FolderPanel merge:
 *  - Child-row selection now fires onSelectFolder (was a no-op)
 *  - Children are cached across collapse/re-expand (was refetch-on-every-toggle)
 *  - `border-border-dark` (nonexistent token, silent no-op) → `border-border`
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  type Folder,
} from '../api/folders.js';

// ─── Icons ────────────────────────────────────────────────────────────────────

export function FolderIcon({ open, className }: { open?: boolean; className?: string }) {
  const cls = className ?? 'w-4 h-4';
  return open ? (
    <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </svg>
  ) : (
    <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  const cls = className ?? 'w-3.5 h-3.5';
  return (
    <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

export function ChevronIcon({ open, className }: { open?: boolean; className?: string }) {
  const cls = `${className ?? 'w-3 h-3'} transition-transform ${open ? 'rotate-90' : ''}`;
  return (
    <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function HomeGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
    </svg>
  );
}

// ─── Folder tree row ──────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: Folder;
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onDeleted: () => void;
  onRenamed: (updated: Folder) => void;
  depth?: number;
}

function FolderRow({ folder, activeFolderId, onSelectFolder, onDeleted, onRenamed, depth = 0 }: FolderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Folder[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const renameRef = useRef<HTMLInputElement>(null);

  const isActive = activeFolderId === folder.id;

  async function handleExpand() {
    if (expanded) { setExpanded(false); return; }
    // Children are cached after the first fetch; re-expand is instant.
    if (children !== null) { setExpanded(true); return; }
    setLoadingChildren(true);
    try {
      const data = await listFolders({ parentFolderId: folder.id });
      setChildren(data);
      setExpanded(true);
    } finally {
      setLoadingChildren(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete folder "${folder.name}"? Its assets will not be deleted.`)) return;
    try {
      await deleteFolder(folder.id);
      if (isActive) onSelectFolder(null);
      onDeleted();
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === folder.name) { setRenaming(false); return; }
    try {
      const updated = await updateFolder(folder.id, { name: trimmed });
      setRenaming(false);
      onRenamed(updated);
    } catch (err) {
      console.error('Failed to rename folder:', err);
      // Always close the input and restore the original name on failure so it
      // does not stay permanently stuck open.
      setRenaming(false);
      setRenameValue(folder.name);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') { setRenaming(false); setRenameValue(folder.name); }
  }

  useEffect(() => {
    if (renaming && renameRef.current) renameRef.current.select();
  }, [renaming]);

  const indent = depth * 12;

  return (
    <li>
      <div
        className={`group flex items-center gap-1 px-2 py-1 rounded cursor-pointer select-none text-sm
          ${isActive ? 'bg-accent/20 text-accent' : 'hover:bg-surface-3 text-content-secondary hover:text-content'}`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={renaming ? undefined : () => onSelectFolder(folder.id)}
        onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); setRenameValue(folder.name); }}
      >
        {/* Expand chevron */}
        <button
          className="shrink-0 p-0.5 rounded hover:bg-surface-4"
          onClick={(e) => { e.stopPropagation(); handleExpand(); }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          disabled={loadingChildren}
        >
          <ChevronIcon open={expanded} />
        </button>

        <FolderIcon open={expanded} className="w-4 h-4 shrink-0" />

        {/* Name / rename input */}
        {renaming ? (
          <input
            ref={renameRef}
            className="flex-1 min-w-0 bg-surface-2 border border-border-light rounded px-1 py-0 text-sm text-content outline-none focus:ring-1 focus:ring-accent/50"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">{folder.name}</span>
        )}

        {/* Asset count badge */}
        {!renaming && (
          <span className="text-xs text-content-muted ml-auto shrink-0">
            {folder.asset_count}
          </span>
        )}

        {/* Delete button */}
        {!renaming && (
          <button
            className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-400 transition-opacity"
            onClick={handleDelete}
            aria-label={`Delete folder ${folder.name}`}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* Children */}
      {expanded && children !== null && children.length > 0 && (
        <ul className="mt-0.5">
          {children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              activeFolderId={activeFolderId}
              onSelectFolder={onSelectFolder}
              onDeleted={() => setChildren((prev) => (prev ?? []).filter((c) => c.id !== child.id))}
              onRenamed={(updated) =>
                setChildren((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)))
              }
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── MainSidebar ──────────────────────────────────────────────────────────────

export interface MainSidebarProps {
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  /** Filter sub-groups (File type, Tags, …) rendered inside the Filters section. */
  children?: ReactNode;
  hasFilters: boolean;
  onClearFilters: () => void;
}

export function MainSidebar({ activeFolderId, onSelectFolder, children, hasFilters, onClearFilters }: MainSidebarProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newNameRef = useRef<HTMLInputElement>(null);
  const foldersSectionRef = useRef<HTMLDivElement>(null);
  const filtersSectionRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<'folders' | 'filters' | null>(null);

  async function loadFolders() {
    setLoading(true);
    try {
      const data = await listFolders({ parentFolderId: 'root' });
      setFolders(data);
    } catch {
      // Silently fail; user can retry
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFolders(); }, []);

  useEffect(() => {
    if (creating && newNameRef.current) newNameRef.current.focus();
  }, [creating]);

  // Collapsed-rail icons expand the sidebar and jump to their section.
  useEffect(() => {
    if (collapsed || !pendingScrollRef.current) return;
    const target = pendingScrollRef.current === 'folders' ? foldersSectionRef.current : filtersSectionRef.current;
    pendingScrollRef.current = null;
    // Optional call: jsdom (tests) doesn't implement scrollIntoView.
    target?.scrollIntoView?.({ block: 'start' });
  }, [collapsed]);

  function expandTo(section: 'folders' | 'filters') {
    pendingScrollRef.current = section;
    setCollapsed(false);
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) { setCreating(false); return; }
    try {
      const folder = await createFolder({ name: trimmed });
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      // Reset only on success so the user can retry with the same name on error.
      setNewName('');
      setCreating(false);
    } catch (err) {
      console.error('Failed to create folder:', err);
      // Leave creating=true and newName intact so the user can retry without
      // re-typing their folder name.
    }
  }

  function handleCreateKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
  }

  return (
    <aside
      className={`flex flex-col border-r border-border bg-surface-1 shrink-0 transition-all duration-200
        ${collapsed ? 'w-10' : 'w-64'}`}
    >
      {/* Header — single collapse control for the whole sidebar */}
      <div className={`flex items-center px-2 py-2 border-b border-border ${collapsed ? 'justify-center' : 'justify-end'}`}>
        <button
          className="p-1 rounded hover:bg-surface-3 text-content-muted hover:text-content"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            {collapsed
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            }
          </svg>
        </button>
      </div>

      {collapsed ? (
        /* Collapsed rail: icon shortcuts into each section */
        <div className="flex flex-col items-center gap-1 py-2">
          <button
            className={`p-1.5 rounded hover:bg-surface-3 ${activeFolderId === null ? 'text-accent' : 'text-content-muted hover:text-content'}`}
            onClick={() => onSelectFolder(null)}
            aria-label="All assets"
            title="All assets"
          >
            <HomeGridIcon />
          </button>
          <button
            className="p-1.5 rounded hover:bg-surface-3 text-content-muted hover:text-content"
            onClick={() => expandTo('folders')}
            aria-label="Show folders"
            title="Folders"
          >
            <FolderIcon />
          </button>
          <button
            className="p-1.5 rounded hover:bg-surface-3 text-content-muted hover:text-content"
            onClick={() => expandTo('filters')}
            aria-label="Show filters"
            title="Filters"
          >
            <FilterIcon />
          </button>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          {/* All assets — above both sections; clears folder scope */}
          <div
            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer text-sm rounded mx-1 mt-1 shrink-0
              ${activeFolderId === null ? 'bg-accent/20 text-accent' : 'text-content-secondary hover:bg-surface-3 hover:text-content'}`}
            onClick={() => onSelectFolder(null)}
          >
            <HomeGridIcon className="w-4 h-4 shrink-0" />
            <span>All assets</span>
          </div>

          {/* Section 1 — Folders */}
          <div ref={foldersSectionRef} className="px-1 pt-3 pb-2 border-b border-border/50">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-[10px] font-semibold text-content-muted uppercase tracking-widest">Folders</span>
              <button
                className="p-0.5 rounded text-content-muted hover:text-content hover:bg-surface-3 transition-colors"
                onClick={() => { setCreating(true); setNewName(''); }}
                aria-label="New folder"
                title="New folder"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-content-muted px-3 py-1">Loading…</p>
            ) : folders.length === 0 && !creating ? (
              <p className="text-xs text-content-muted px-3 py-1">No folders yet — create one to start organizing.</p>
            ) : (
              <ul className="space-y-0.5">
                {folders.map((folder) => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    activeFolderId={activeFolderId}
                    onSelectFolder={onSelectFolder}
                    onDeleted={() => setFolders((prev) => prev.filter((f) => f.id !== folder.id))}
                    onRenamed={(updated) =>
                      setFolders((prev) =>
                        prev
                          .map((f) => (f.id === updated.id ? updated : f))
                          .sort((a, b) => a.name.localeCompare(b.name)),
                      )
                    }
                  />
                ))}
              </ul>
            )}

            {/* Inline create input */}
            {creating && (
              <div className="flex items-center gap-1 px-2 py-1 mt-0.5">
                <FolderIcon className="w-4 h-4 shrink-0 text-content-muted" />
                <input
                  ref={newNameRef}
                  className="flex-1 min-w-0 bg-surface-2 border border-border-light rounded px-1 py-0.5 text-sm text-content outline-none focus:ring-1 focus:ring-accent/50"
                  placeholder="Folder name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={handleCreate}
                  onKeyDown={handleCreateKeyDown}
                />
              </div>
            )}
          </div>

          {/* Section 2 — Filters */}
          <div ref={filtersSectionRef} className="pt-3">
            <div className="flex items-center justify-between px-4 mb-1">
              <span className="text-[10px] font-semibold text-content-muted uppercase tracking-widest">Filters</span>
              {hasFilters && (
                <button
                  onClick={onClearFilters}
                  className="text-xs text-accent-light hover:text-accent transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            {children}
          </div>
        </div>
      )}
    </aside>
  );
}
