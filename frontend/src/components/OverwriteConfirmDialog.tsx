import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConflictResolution = 'overwrite' | 'keep';

export interface OverwriteConfirmDialogProps {
  /** Filenames that collide with existing assets. Must be non-empty. */
  conflicts: string[];
  /** Called with a per-filename resolution map when the user confirms. */
  onResolve: (decisions: Record<string, ConflictResolution>) => void;
  /** Called when the user cancels without resolving. */
  onCancel: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OVERWRITE_PREF_KEY = 'vaultworks_overwrite_pref';

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal dialog that prompts the user when dropped files collide with existing
 * asset filenames. Supports per-file Overwrite / Keep both choices, an
 * "Apply to all conflicts" shortcut, and a localStorage-persisted
 * "don't ask me again" option.
 *
 * Consumed by DropZone when filename conflicts are detected.
 */
export function OverwriteConfirmDialog({
  conflicts,
  onResolve,
  onCancel,
}: OverwriteConfirmDialogProps) {
  // Per-filename decision map; null = not yet decided
  const [decisions, setDecisions] = useState<Record<string, ConflictResolution | null>>(
    () => Object.fromEntries(conflicts.map((f) => [f, null])),
  );
  // When true, the next Overwrite / Keep both click applies to all unresolved files
  const [applyToAll, setApplyToAll] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  // ── Focus management ────────────────────────────────────────────────────────

  // Capture return-focus target; move initial focus to Cancel (safe default)
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    cancelButtonRef.current?.focus();
    return () => {
      (returnFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // Prevent body scroll while the dialog is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc = cancel; Tab = trapped within dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // ── Decision helpers ────────────────────────────────────────────────────────

  const choose = useCallback(
    (filename: string, resolution: ConflictResolution) => {
      setDecisions((prev) => {
        if (applyToAll) {
          // Apply to the clicked file and every currently-unresolved file
          return Object.fromEntries(
            Object.entries(prev).map(([f, r]) => [
              f,
              f === filename || r === null ? resolution : r,
            ]),
          );
        }
        return { ...prev, [filename]: resolution };
      });
    },
    [applyToAll],
  );

  // "Don't ask me again" — save pref, resolve everything as overwrite, and close
  const handleNeverAsk = useCallback(() => {
    localStorage.setItem(OVERWRITE_PREF_KEY, 'always');
    onResolve(
      Object.fromEntries(conflicts.map((f) => [f, 'overwrite' as ConflictResolution])),
    );
  }, [conflicts, onResolve]);

  // Confirm — unresolved items default to 'keep'
  const handleConfirm = useCallback(() => {
    const final = Object.fromEntries(
      Object.entries(decisions).map(([f, r]) => [f, r ?? ('keep' as ConflictResolution)]),
    );
    onResolve(final as Record<string, ConflictResolution>);
  }, [decisions, onResolve]);

  const isMultiConflict = conflicts.length > 1;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocd-title"
        aria-describedby="ocd-desc"
        className="bg-surface-1 border border-border rounded-xl shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-3">
            {/* Warning icon badge */}
            <div className="w-9 h-9 rounded-lg bg-warning/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg
                className="w-[18px] h-[18px] text-warning"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>

            <div>
              <h2 id="ocd-title" className="font-semibold text-content-primary text-sm">
                {isMultiConflict
                  ? `${conflicts.length} files already exist`
                  : 'File already exists'}
              </h2>
              <p id="ocd-desc" className="text-xs text-content-muted mt-0.5 leading-relaxed">
                {isMultiConflict
                  ? 'Choose what to do with each conflict below.'
                  : 'Choose what to do with this file.'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Conflict list ── */}
        <div className="border-t border-border divide-y divide-border/50 overflow-y-auto max-h-60">
          {conflicts.map((filename) => {
            const resolution = decisions[filename];
            return (
              <div
                key={filename}
                className="px-6 py-3.5"
                role="group"
                aria-label={`Conflict for ${filename}`}
              >
                {/* Per-file header */}
                <p className="text-xs text-content-muted mb-2.5 leading-relaxed">
                  <strong className="text-content-primary font-medium">{filename}</strong>{' '}
                  already exists. Overwrite it?
                </p>

                {/* Choice buttons */}
                <div className="flex gap-2" role="group" aria-label="Resolution options">
                  <button
                    type="button"
                    onClick={() => choose(filename, 'overwrite')}
                    aria-pressed={resolution === 'overwrite'}
                    className={[
                      'btn btn-sm transition-all',
                      resolution === 'overwrite'
                        ? 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25'
                        : 'btn-secondary',
                    ].join(' ')}
                  >
                    Overwrite
                  </button>

                  <button
                    type="button"
                    onClick={() => choose(filename, 'keep')}
                    aria-pressed={resolution === 'keep'}
                    className={[
                      'btn btn-sm transition-all',
                      resolution === 'keep'
                        ? 'bg-accent/15 text-accent-light border border-accent/30 hover:bg-accent/25'
                        : 'btn-secondary',
                    ].join(' ')}
                  >
                    Keep both
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-border flex flex-col gap-3">
          {/* "Apply to all" — only shown when there are multiple conflicts */}
          {isMultiConflict && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-accent cursor-pointer"
              />
              <span className="text-xs text-content-secondary">
                Apply to all conflicts
              </span>
            </label>
          )}

          {/* "Don't ask me again" */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              onChange={(e) => {
                if (e.target.checked) handleNeverAsk();
              }}
              className="w-4 h-4 rounded border-border accent-accent cursor-pointer"
            />
            <span className="text-xs text-content-secondary">
              Don't ask me again — always overwrite
            </span>
          </label>

          {/* Action buttons */}
          <div className="flex gap-2 justify-end pt-1">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onCancel}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>

            <button type="button" onClick={handleConfirm} className="btn-primary btn-sm">
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
