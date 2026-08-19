import { useState, useRef, useEffect } from 'react';
import type { WizardState, WizardAction } from './useUploadWizard.js';
import type { Category } from '../../api/categories.js';
import { ALLOWED_LICENSES, MAX_CUSTOM_NAME_CHARS, MAX_DESCRIPTION_CHARS, MAX_TAGS, MAX_TAG_LENGTH } from './constants.js';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesError: string | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function Step2MetadataForm({ state, dispatch, categories, categoriesLoading, categoriesError }: Props) {
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);
  const { metadata } = state;

  const selectedCategory = categories.find((c) => c.id === metadata.categoryId);
  const subcategories = selectedCategory?.subcategories ?? [];

  // Auto-select category when file MIME matches and no category is chosen yet
  const fileMime = state.file?.type ?? null;
  useEffect(() => {
    if (metadata.categoryId || !fileMime || categories.length === 0) return;
    const match = categories.find((c) => c.allowed_mime_types.includes(fileMime));
    if (match) dispatch({ type: 'SET_CATEGORY', categoryId: match.id });
  }, [categories, fileMime]);

  // Mismatch: selected category has MIME restrictions and file doesn't satisfy them
  const categoryMimeTypes = selectedCategory?.allowed_mime_types ?? [];
  const isMismatch =
    categoryMimeTypes.length > 0 && fileMime !== null && !categoryMimeTypes.includes(fileMime);
  const suggestedCategory = isMismatch
    ? categories.find((c) => c.id !== metadata.categoryId && c.allowed_mime_types.includes(fileMime))
    : null;

  function addTag(raw: string) {
    const names = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);
    const next = [...new Set([...metadata.tags, ...names])].slice(0, MAX_TAGS);
    dispatch({ type: 'SET_METADATA', patch: { tags: next } });
    setTagInput('');
  }

  function removeTag(name: string) {
    dispatch({ type: 'SET_METADATA', patch: { tags: metadata.tags.filter((t) => t !== name) } });
  }

  // Derive validation state for customName
  const customNameEmpty = state.customName.trim().length === 0;
  const customNameTooLong = state.customName.length > MAX_CUSTOM_NAME_CHARS;
  const customNameInvalid = customNameEmpty || customNameTooLong;

  return (
    <div className="space-y-5">
      {/* File Name */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label mb-0">File Name</label>
          <span
            className={`text-[10px] tabular-nums ${
              customNameTooLong ? 'text-danger' : state.customName.length > MAX_CUSTOM_NAME_CHARS * 0.9 ? 'text-amber-400' : 'text-content-muted'
            }`}
          >
            {state.customName.length} / {MAX_CUSTOM_NAME_CHARS}
          </span>
        </div>
        <input
          type="text"
          className={`input ${customNameInvalid ? 'border-danger/60 focus:ring-danger/40' : ''}`}
          value={state.customName}
          maxLength={MAX_CUSTOM_NAME_CHARS}
          placeholder={state.file?.name ?? 'Enter file name…'}
          onChange={(e) => dispatch({ type: 'SET_CUSTOM_NAME', name: e.target.value })}
          onBlur={() => {
            // Restore to original filename if field was cleared (defensive UX)
            if (state.customName.trim().length === 0 && state.file) {
              dispatch({ type: 'SET_CUSTOM_NAME', name: state.file.name });
            }
          }}
          aria-describedby="custom-name-hint"
        />
        {customNameEmpty && (
          <p id="custom-name-hint" className="text-[10px] text-danger mt-1">File name is required.</p>
        )}
        {!customNameEmpty && customNameTooLong && (
          <p id="custom-name-hint" className="text-[10px] text-danger mt-1">File name must be 255 characters or fewer.</p>
        )}
      </div>

      {/* Category */}
      <div>
        <label className="label">Category</label>
        {categoriesError ? (
          <p className="text-xs text-amber-400">{categoriesError} — category fields disabled.</p>
        ) : (
          <>
            <select
              className="input"
              value={metadata.categoryId ?? ''}
              disabled={categoriesLoading}
              onChange={(e) => dispatch({ type: 'SET_CATEGORY', categoryId: e.target.value || null })}
            >
              <option value="">{categoriesLoading ? 'Loading…' : 'No category'}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {isMismatch && (
              <p className="text-xs text-amber-400 mt-1.5">
                Warning: This file type may not belong in {selectedCategory!.name}.
                {suggestedCategory && <> Consider using <strong>{suggestedCategory.name}</strong> instead.</>}
              </p>
            )}
          </>
        )}
      </div>

      {/* Subcategory */}
      <div>
        <label className="label">Subcategory</label>
        <select
          className="input"
          value={metadata.subcategoryId ?? ''}
          disabled={!metadata.categoryId || subcategories.length === 0}
          onChange={(e) => dispatch({ type: 'SET_METADATA', patch: { subcategoryId: e.target.value || null } })}
        >
          <option value="">{!metadata.categoryId ? 'Select a category first' : subcategories.length === 0 ? 'No subcategories' : 'No subcategory'}</option>
          {subcategories.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* License */}
      <div>
        <label className="label">License</label>
        <select
          className="input"
          value={metadata.license ?? ''}
          onChange={(e) => dispatch({ type: 'SET_METADATA', patch: { license: e.target.value || null } })}
        >
          <option value="">Unspecified</option>
          {ALLOWED_LICENSES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label mb-0">Description</label>
          <span className={`text-[10px] tabular-nums ${metadata.description.length > MAX_DESCRIPTION_CHARS * 0.9 ? 'text-amber-400' : 'text-content-muted'}`}>
            {metadata.description.length}/{MAX_DESCRIPTION_CHARS}
          </span>
        </div>
        <textarea
          className="input resize-none"
          rows={3}
          maxLength={MAX_DESCRIPTION_CHARS}
          placeholder="Describe this asset…"
          value={metadata.description}
          onChange={(e) => dispatch({ type: 'SET_METADATA', patch: { description: e.target.value } })}
        />
      </div>

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="label mb-0">Tags</label>
          <span className="text-[10px] text-content-muted tabular-nums">{metadata.tags.length}/{MAX_TAGS}</span>
        </div>
        {metadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {metadata.tags.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-accent/15 text-accent-light"
              >
                {name}
                <button
                  onClick={() => removeTag(name)}
                  className="opacity-60 hover:opacity-100"
                  aria-label={`Remove tag ${name}`}
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={tagInputRef}
            className="input py-2 text-sm flex-1"
            placeholder={metadata.tags.length >= MAX_TAGS ? 'Max tags reached' : 'Add tags (comma-separated)…'}
            value={tagInput}
            disabled={metadata.tags.length >= MAX_TAGS}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (tagInput.trim()) addTag(tagInput); }
            }}
          />
          <button
            className="btn-secondary btn-sm"
            disabled={!tagInput.trim() || metadata.tags.length >= MAX_TAGS}
            onClick={() => addTag(tagInput)}
          >
            Add
          </button>
        </div>
      </div>

      {/* Auto-detected info (read-only) */}
      {(state.detectedDimensions || state.detectedDuration != null) && (
        <div className="card p-3 bg-surface-1 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted mb-2">Auto-detected</p>
          {state.detectedDimensions && (
            <div className="flex justify-between text-xs">
              <span className="text-content-muted">Resolution</span>
              <span className="text-content-secondary tabular-nums">{state.detectedDimensions.w} × {state.detectedDimensions.h} px</span>
            </div>
          )}
          {state.detectedDuration != null && (
            <div className="flex justify-between text-xs">
              <span className="text-content-muted">Duration</span>
              <span className="text-content-secondary tabular-nums">{formatDuration(state.detectedDuration)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
