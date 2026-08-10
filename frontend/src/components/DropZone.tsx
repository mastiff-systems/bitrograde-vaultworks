import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { findAssetByExactName, uploadFiles, uploadVersion } from '../api/client.js';
import type { Asset } from '../api/client.js';
import { OverwriteConfirmDialog } from './OverwriteConfirmDialog.js';
import type { ConflictResolution } from './OverwriteConfirmDialog.js';

const OVERWRITE_PREF_KEY = 'vaultworks_overwrite_pref';

/** A dropped file that collides with an existing asset's filename. */
interface ConflictEntry {
  file: File;
  existingId: string;
}

interface Props {
  onUploaded: (assets: Asset[]) => void;
}

export function DropZone({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Non-empty while the overwrite-confirm dialog is open
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [pendingNonConflicts, setPendingNonConflicts] = useState<File[]>([]);

  // ── Shared upload executor ───────────────────────────────────────────────────

  /**
   * Route files to the correct upload call and notify onUploaded.
   * - overwriteEntries → uploadVersion() (existing asset receives a new version)
   * - freshFiles       → uploadFiles()   (new uploads or keep-both duplicates;
   *                                       MAS-336 auto-renames on collision)
   */
  const executeUploads = useCallback(
    async (overwriteEntries: ConflictEntry[], freshFiles: File[]) => {
      setUploading(true);
      setProgress(0);
      try {
        const allAssets: Asset[] = [];

        // New / keep-both files — one batched multipart request
        if (freshFiles.length > 0) {
          const uploaded = await uploadFiles(freshFiles, setProgress);
          allAssets.push(...uploaded);
        }

        // Overwrite — upload a new version for each conflicting asset
        if (overwriteEntries.length > 0) {
          await Promise.all(
            overwriteEntries.map((e) => uploadVersion(e.existingId, e.file)),
          );
        }

        onUploaded(allAssets);
      } catch {
        setError('Upload failed. Check your connection and try again.');
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [onUploaded],
  );

  // ── Dialog callbacks ─────────────────────────────────────────────────────────

  const handleResolve = useCallback(
    async (decisions: Record<string, ConflictResolution>) => {
      const overwriteEntries = conflicts.filter(
        (c) => decisions[c.file.name] === 'overwrite',
      );
      const keepBothFiles = conflicts
        .filter((c) => decisions[c.file.name] !== 'overwrite')
        .map((c) => c.file);

      // Snapshot pending list before clearing state
      const fresh = pendingNonConflicts;
      setConflicts([]);
      setPendingNonConflicts([]);

      await executeUploads(overwriteEntries, [...fresh, ...keepBothFiles]);
    },
    [conflicts, pendingNonConflicts, executeUploads],
  );

  const handleCancel = useCallback(() => {
    setConflicts([]);
    setPendingNonConflicts([]);
  }, []);

  // ── Drop handler ─────────────────────────────────────────────────────────────

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      setError(null);

      // 1. Check localStorage preference — skip dialog if 'always'
      const pref = localStorage.getItem(OVERWRITE_PREF_KEY);

      // 2. Run exact-name conflict checks in parallel for all dropped files
      setUploading(true);
      setProgress(0);
      let conflicting: ConflictEntry[];
      let nonConflicting: File[];
      try {
        const checkResults = await Promise.all(
          acceptedFiles.map(async (file) => {
            const existing = await findAssetByExactName(file.name);
            return { file, existingId: existing?.id ?? null };
          }),
        );
        // Type-safe narrowing after filter
        conflicting = checkResults
          .filter((r): r is { file: File; existingId: string } => r.existingId !== null)
          .map((r) => ({ file: r.file, existingId: r.existingId }));
        nonConflicting = checkResults
          .filter((r) => r.existingId === null)
          .map((r) => r.file);
      } catch {
        setError('Could not check for conflicts. Try again.');
        setUploading(false);
        return;
      }

      // 3. Conflicts found and preference is not 'always' → open dialog
      if (conflicting.length > 0 && pref !== 'always') {
        setUploading(false);
        setPendingNonConflicts(nonConflicting);
        setConflicts(conflicting);
        return;
      }

      // 4. No dialog needed — route directly
      //    - pref === 'always': overwrite all conflicting files silently
      //    - no conflicts:      upload everything fresh
      setUploading(false);
      await executeUploads(conflicting, nonConflicting);
    },
    [executeUploads],
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  const isDialogOpen = conflicts.length > 0;
  const isDisabled = uploading || isDialogOpen;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: isDisabled,
  });

  return (
    <div style={{ marginBottom: 24 }}>
      {isDialogOpen && (
        <OverwriteConfirmDialog
          conflicts={conflicts.map((c) => c.file.name)}
          onResolve={handleResolve}
          onCancel={handleCancel}
        />
      )}
      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${isDragActive ? '#4a9eff' : '#555'}`,
          borderRadius: 8,
          padding: '32px 24px',
          textAlign: 'center',
          cursor: isDisabled ? 'default' : 'pointer',
          background: isDragActive ? '#1a2a3a' : '#1a1a1a',
          color: '#ccc',
          transition: 'all 0.2s',
        }}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <p>Uploading… {progress}%</p>
        ) : isDragActive ? (
          <p>Drop files here</p>
        ) : (
          <p>Drag & drop files here, or click to select (up to 10 at once)</p>
        )}
      </div>
      {error && <p style={{ color: '#f66', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
