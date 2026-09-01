/**
 * MAS-712: FolderPickerDialog — OS-installer-style destination folder picker
 * for the Upload Wizard (per MAS-709 design §5.2).
 *
 * Interaction model:
 *  - Chevron click expands/collapses a node (lazy fetch, cached per node)
 *  - Row-label click STAGES that folder as the pending destination (highlight)
 *  - "All assets" root row is itself selectable → explicit "no folder"
 *  - Footer shows the live pending path; explicit [Choose]/[Cancel] commit
 *  - Per-node inline error row with Retry (never fails silently)
 */
import { useEffect, useState } from 'react';
import { listFolders, type Folder } from '../../api/folders.js';
import { ChevronIcon, FolderIcon } from '../MainSidebar.js';

/** A staged/committed picker selection. `id: null` means root ("All assets"). */
export interface FolderSelection {
  id: string | null;
  /** Folder names from root → self; empty for root. */
  path: string[];
}

interface PickerRowProps {
  folder: Folder;
  /** Names of ancestors root → parent (this folder's own name is appended on stage). */
  ancestry: string[];
  stagedId: string | null;
  onStage: (sel: FolderSelection) => void;
  depth: number;
}

function PickerRow({ folder, ancestry, stagedId, onStage, depth }: PickerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Folder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const isStaged = stagedId === folder.id;
  const path = [...ancestry, folder.name];

  async function loadChildren() {
    setLoading(true);
    setError(false);
    try {
      const data = await listFolders({ parentFolderId: folder.id });
      setChildren(data);
      setExpanded(true);
    } catch {
      setError(true);
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  }

  function handleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    if (expanded) { setExpanded(false); return; }
    if (children !== null && !error) { setExpanded(true); return; }
    loadChildren();
  }

  return (
    <li>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer select-none text-sm
          ${isStaged ? 'bg-accent/20 text-accent' : 'hover:bg-surface-3 text-content-secondary hover:text-content'}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => onStage({ id: folder.id, path })}
      >
        <button
          className="shrink-0 p-0.5 rounded hover:bg-surface-4"
          onClick={handleExpand}
          aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          disabled={loading}
        >
          {loading ? (
            <span className="block w-3 h-3 border border-surface-4 border-t-accent rounded-full animate-spin" />
          ) : (
            <ChevronIcon open={expanded} />
          )}
        </button>
        <FolderIcon open={expanded} className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0 truncate">{folder.name}</span>
        {isStaged && (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>

      {expanded && error && (
        <p className="text-xs text-danger py-1" style={{ paddingLeft: `${28 + depth * 12}px` }}>
          Couldn't load subfolders.{' '}
          <button className="underline hover:no-underline" onClick={loadChildren}>Retry</button>
        </p>
      )}

      {expanded && !error && children !== null && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <PickerRow
              key={child.id}
              folder={child}
              ancestry={path}
              stagedId={stagedId}
              onStage={onStage}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface FolderPickerDialogProps {
  open: boolean;
  /** Selection to pre-stage when the dialog opens. */
  initial: FolderSelection;
  onCancel: () => void;
  onChoose: (sel: FolderSelection) => void;
}

export function FolderPickerDialog({ open, initial, onCancel, onChoose }: FolderPickerDialogProps) {
  const [staged, setStaged] = useState<FolderSelection>(initial);
  const [rootFolders, setRootFolders] = useState<Folder[] | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState(false);

  async function loadRoot() {
    setRootLoading(true);
    setRootError(false);
    try {
      const data = await listFolders({ parentFolderId: 'root' });
      setRootFolders(data);
    } catch {
      setRootError(true);
    } finally {
      setRootLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setStaged(initial);
    loadRoot();
    // Re-stage from `initial` each time the dialog opens (not on every prop identity change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const stagedLabel = staged.path.length > 0 ? ['All assets', ...staged.path].join(' › ') : 'All assets';

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="card w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="font-semibold text-content-primary text-sm">Choose a folder</span>
          <button className="btn-ghost btn-sm" onClick={onCancel} aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tree body */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {/* Root row — explicitly selectable "no folder" destination */}
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer select-none text-sm
              ${staged.id === null ? 'bg-accent/20 text-accent' : 'hover:bg-surface-3 text-content-secondary hover:text-content'}`}
            onClick={() => setStaged({ id: null, path: [] })}
          >
            <FolderIcon open className="w-4 h-4 shrink-0 ml-4" />
            <span className="flex-1 min-w-0 truncate">All assets</span>
            {staged.id === null && (
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
          </div>

          {rootLoading && <p className="text-xs text-content-muted px-3 py-2">Loading…</p>}

          {rootError && (
            <p className="text-xs text-danger px-3 py-2">
              Couldn't load folders.{' '}
              <button className="underline hover:no-underline" onClick={loadRoot}>Retry</button>
            </p>
          )}

          {!rootLoading && !rootError && rootFolders !== null && (
            rootFolders.length === 0 ? (
              <p className="text-xs text-content-muted px-3 py-2">
                No folders yet. Uploads go to All assets until you create one.
              </p>
            ) : (
              <ul>
                {rootFolders.map((folder) => (
                  <PickerRow
                    key={folder.id}
                    folder={folder}
                    ancestry={[]}
                    stagedId={staged.id}
                    onStage={setStaged}
                    depth={1}
                  />
                ))}
              </ul>
            )
          )}
        </div>

        {/* Footer — live pending path + explicit commit */}
        <div className="border-t border-border px-4 py-3 flex-shrink-0 space-y-2">
          <p className="text-xs text-content-muted overflow-x-auto whitespace-nowrap">
            Selected: <span className="text-content-secondary">{stagedLabel}</span>
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={() => onChoose(staged)}>Choose</button>
          </div>
        </div>
      </div>
    </div>
  );
}
