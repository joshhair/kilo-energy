'use client';

/**
 * PhaseQuickAdvance — the prev/next phase one-tap strip under the
 * pipeline stepper. Extracted verbatim from projects/[id]/page.tsx
 * (T4.1 split, 2026-06-11). Render-gating (admin/PM only, hidden on
 * Cancelled/On Hold) is the parent's responsibility.
 */

import { PIPELINE_STEPS } from './PipelineStepper';
import type { Phase } from '@/lib/data';

export function PhaseQuickAdvance({ phase, onPhaseChange }: {
  phase: Phase;
  onPhaseChange: (phase: Phase) => void;
}) {
        const phaseIdx = PIPELINE_STEPS.indexOf(phase as typeof PIPELINE_STEPS[number]);
        const prevStep = phaseIdx > 0 ? PIPELINE_STEPS[phaseIdx - 1] : null;
        const nextStep = phaseIdx < PIPELINE_STEPS.length - 1 ? PIPELINE_STEPS[phaseIdx + 1] : null;
        return (
          <div className="flex items-center gap-2 mb-5 -mt-3">
            {prevStep ? (
              <button
                onClick={() => onPhaseChange(prevStep)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-amber-500/50 transition-colors"
              >
                ← {prevStep}
              </button>
            ) : <span />}
            {nextStep && (
              <button
                onClick={() => onPhaseChange(nextStep)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-emerald-solid)]/50 transition-colors ml-auto"
              >
                {nextStep} →
              </button>
            )}
          </div>
        );
}
