import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import type { WizardState } from './useUploadWizard.js';
import { MAX_FILE_SIZE_BYTES } from './constants.js';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

const TYPE_COLORS: Record<string, string> = {
  image: 'text-emerald-300 bg-emerald-500/15',
  audio: 'text-cyan-300 bg-cyan-500/15',
  video: 'text-blue-300 bg-blue-500/15',
  '3d': 'text-violet-300 bg-violet-500/15',
};

interface Props {
  state: WizardState;
  onSelectFile: (file: File) => Promise<void>;
  onRemoveFile: () => void;
}

export function Step1FilePicker({ state, onSelectFile, onRemoveFile }: Props) {
  const [sizeError, setSizeError] = [state.error, () => {}];

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE_BYTES) return;
      await onSelectFile(file);
    },
    [onSelectFile],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: MAX_FILE_SIZE_BYTES,
  });

  const rejection = fileRejections[0];
  const isTooLarge = rejection?.errors.some((e) => e.code === 'file-too-large');

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          isDragActive
            ? 'border-accent bg-accent/10'
            : state.file
            ? 'border-accent/40 bg-accent/5'
            : 'border-border hover:border-border-light hover:bg-surface-3/50'
        }`}
      >
        <input {...getInputProps()} />

        {state.file ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-surface-3 flex items-center justify-center">
              <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-content-primary">{state.file.name}</p>
              <p className="text-xs text-content-muted mt-0.5 tabular-nums">{formatBytes(state.file.size)}</p>
            </div>
            <p className="text-xs text-content-muted">Drop a different file to replace</p>
          </div>
        ) : isDragActive ? (
          <div className="flex flex-col items-center gap-2">
            <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm text-accent font-medium">Drop to select</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-surface-3 flex items-center justify-center">
              <svg className="w-7 h-7 text-content-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-content-secondary font-medium">Drag & drop a file here</p>
              <p className="text-xs text-content-muted mt-0.5">or click to browse · max 5 GB</p>
            </div>
          </div>
        )}
      </div>

      {isTooLarge && (
        <div className="px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          File exceeds the 5 GB limit. Please choose a smaller file.
        </div>
      )}

      {state.file && (
        <div className="card p-3 bg-surface-1 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-content-primary truncate">{state.file.name}</span>
              {state.detectedType && (
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${TYPE_COLORS[state.detectedType] ?? 'bg-surface-4 text-content-secondary'}`}>
                  {state.detectedType}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-content-muted">
              <span className="tabular-nums">{formatBytes(state.file.size)}</span>
              {state.detectedDimensions && (
                <span className="tabular-nums">{state.detectedDimensions.w} × {state.detectedDimensions.h} px</span>
              )}
              {state.detectedDuration != null && (
                <span className="tabular-nums">{state.detectedDuration.toFixed(1)}s</span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveFile(); }}
            className="btn-ghost btn-sm text-content-muted hover:text-danger flex-shrink-0"
            aria-label="Remove file"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
