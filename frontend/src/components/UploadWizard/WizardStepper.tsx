import type { WizardState } from './useUploadWizard.js';

const STEPS = ['Pick File', 'Metadata', 'Review'];

function stepIndex(step: WizardState['step']): number {
  if (step === 'file') return 0;
  if (step === 'metadata') return 1;
  return 2;
}

export function WizardStepper({ step }: { step: WizardState['step'] }) {
  const current = stepIndex(step);

  return (
    <div className="flex items-center gap-0 px-5 py-3 border-b border-border flex-shrink-0">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center flex-1">
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-colors ${
                i < current
                  ? 'bg-accent text-white'
                  : i === current
                  ? 'bg-accent text-white ring-2 ring-accent/30 ring-offset-1 ring-offset-surface-2'
                  : 'bg-surface-3 text-content-muted'
              }`}
            >
              {i < current ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs font-medium transition-colors ${i === current ? 'text-content-primary' : 'text-content-muted'}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px mx-3 transition-colors ${i < current ? 'bg-accent/50' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
