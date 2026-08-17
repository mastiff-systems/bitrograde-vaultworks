import { useEffect } from 'react';
import type { Asset } from '../../api/client.js';
import { useUploadWizard } from './useUploadWizard.js';
import { WizardStepper } from './WizardStepper.js';
import { Step1FilePicker } from './Step1FilePicker.js';
import { Step2MetadataForm } from './Step2MetadataForm.js';
import { Step3ReviewSubmit } from './Step3ReviewSubmit.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: (asset: Asset) => void;
}

export function UploadWizard({ open, onClose, onComplete }: Props) {
  const wizard = useUploadWizard(onComplete);
  const { state, dispatch, categories, categoriesLoading, categoriesError, selectFile, submit } = wizard;

  // Reset wizard when closed
  useEffect(() => {
    if (!open) dispatch({ type: 'RESET' });
  }, [open, dispatch]);

  if (!open) return null;

  const isSubmitting = state.step === 'submitting';
  const isRetry = state.step === 'error';
  const customNameValid = state.customName.trim().length > 0 && state.customName.length <= 255;
  const canGoNext =
    state.step === 'file' ? !!state.file :
    state.step === 'metadata' ? customNameValid :
    false;
  const canGoBack = state.step === 'metadata' || state.step === 'review' || state.step === 'error';
  const showNav = state.step !== 'done';

  async function handleNext() {
    if (state.step === 'review' || isRetry) {
      await submit();
    } else {
      dispatch({ type: 'GO_NEXT' });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <span className="font-semibold text-content-primary">Upload Asset</span>
          <button
            onClick={onClose}
            className="btn-ghost btn-sm"
            aria-label="Close"
            disabled={isSubmitting}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stepper */}
        <WizardStepper step={state.step} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {state.step === 'done' ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-content-primary">Upload complete!</p>
                <p className="text-sm text-content-muted mt-1">
                  {state.uploadedAsset?.original_name} has been added to your vault.
                </p>
              </div>
              <div className="flex gap-3 mt-2">
                <button
                  className="btn-secondary"
                  onClick={() => dispatch({ type: 'RESET' })}
                >
                  Upload another
                </button>
                <button className="btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {state.step === 'file' && (
                <Step1FilePicker
                  state={state}
                  onSelectFile={selectFile}
                  onRemoveFile={() => dispatch({ type: 'REMOVE_FILE' })}
                />
              )}
              {state.step === 'metadata' && (
                <Step2MetadataForm
                  state={state}
                  dispatch={dispatch}
                  categories={categories}
                  categoriesLoading={categoriesLoading}
                  categoriesError={categoriesError}
                />
              )}
              {(state.step === 'review' || isSubmitting || isRetry) && (
                <Step3ReviewSubmit state={state} categories={categories} />
              )}
            </>
          )}
        </div>

        {/* Nav bar */}
        {showNav && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-border flex-shrink-0">
            <button
              className="btn-ghost"
              onClick={() => dispatch({ type: 'GO_BACK' })}
              disabled={!canGoBack || isSubmitting}
            >
              Back
            </button>
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={(state.step === 'file' && !canGoNext) || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading…
                </>
              ) : isRetry ? (
                'Retry'
              ) : state.step === 'review' ? (
                'Upload'
              ) : (
                'Next'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
