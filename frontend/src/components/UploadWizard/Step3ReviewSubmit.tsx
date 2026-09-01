import type { WizardState } from './useUploadWizard.js';
import type { Category } from '../../api/categories.js';
import { ALLOWED_LICENSES } from './constants.js';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

interface Props {
  state: WizardState;
  categories: Category[];
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-content-muted flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-content-secondary text-right">{value || <span className="text-content-muted italic">—</span>}</span>
    </div>
  );
}

export function Step3ReviewSubmit({ state, categories }: Props) {
  const { metadata, file } = state;
  const isSubmitting = state.step === 'submitting';
  const isError = state.step === 'error';

  const selectedCategory = categories.find((c) => c.id === metadata.categoryId);
  const categoryName = selectedCategory?.name;
  const subcategoryName = selectedCategory?.subcategories.find((s) => s.id === metadata.subcategoryId)?.name;
  const licenseName = ALLOWED_LICENSES.find((l) => l.value === metadata.license)?.label ?? metadata.license;

  const fileMime = file?.type ?? null;
  const categoryMimeTypes = selectedCategory?.allowed_mime_types ?? [];
  const isMismatch =
    categoryMimeTypes.length > 0 && fileMime !== null && !categoryMimeTypes.includes(fileMime);
  const suggestedCategory = isMismatch
    ? categories.find((c) => c.id !== metadata.categoryId && c.allowed_mime_types.includes(fileMime))
    : null;

  return (
    <div className="space-y-4">
      {isError && (
        <div className="px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {state.error}
        </div>
      )}

      {/* File summary */}
      <div className="card p-4 bg-surface-1 space-y-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted mb-2">File</p>
        <ReviewRow label="Name" value={state.customName || file?.name} />
        <ReviewRow label="Size" value={file ? formatBytes(file.size) : null} />
        {state.detectedType && <ReviewRow label="Type" value={state.detectedType} />}
        {state.detectedDimensions && (
          <ReviewRow label="Resolution" value={`${state.detectedDimensions.w} × ${state.detectedDimensions.h} px`} />
        )}
        {state.detectedDuration != null && (
          <ReviewRow label="Duration" value={`${state.detectedDuration.toFixed(1)}s`} />
        )}
      </div>

      {/* Metadata summary */}
      <div className="card p-4 bg-surface-1 space-y-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted mb-2">Metadata</p>
        <ReviewRow
          label="Location"
          value={['All assets', ...state.folder.path].join(' › ')}
        />
        <ReviewRow label="Category" value={categoryName} />
        <ReviewRow label="Subcategory" value={subcategoryName} />
        <ReviewRow label="License" value={licenseName} />
        <ReviewRow
          label="Tags"
          value={
            metadata.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1 justify-end">
                {metadata.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-light font-medium">{t}</span>
                ))}
              </div>
            ) : null
          }
        />
        {metadata.description && (
          <div className="pt-2.5 border-t border-border/50">
            <p className="text-[10px] text-content-muted mb-1.5">Description</p>
            <p className="text-xs text-content-secondary leading-relaxed">{metadata.description}</p>
          </div>
        )}
      </div>

      {/* MIME mismatch warning */}
      {isMismatch && (
        <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <span className="font-medium">Warning:</span> {file?.name} — this file type may not belong in {categoryName}.
          {suggestedCategory && <> Consider using <strong>{suggestedCategory.name}</strong> instead.</>}
        </div>
      )}

      {/* Progress bar */}
      {isSubmitting && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-content-muted">
            <span>Uploading…</span>
            <span className="tabular-nums">{state.uploadProgress}%</span>
          </div>
          <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-200"
              style={{ width: `${state.uploadProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
