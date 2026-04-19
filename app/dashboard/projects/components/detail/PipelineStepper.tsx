'use client';

/**
 * PipelineStepper + PhaseBadge — extracted from projects/[id]/page.tsx
 * as part of A+ Phase 1.1 decomposition.
 *
 * Pure components: no shared state with the parent beyond explicit props.
 * If you're changing these, the only invariant is the two exports below
 * keep their names and prop shapes — everything else is style.
 */

import { Check, Clock, ArrowRight } from 'lucide-react';
import type { Phase } from '../../../../../lib/data';

/** Ordered phases that form the main pipeline (excludes off-track states).
 *  Exported so the project-detail main page can use it for the phase
 *  quick-advance (prev/next) buttons. */
export const PIPELINE_STEPS: Phase[] = [
  'New',
  'Acceptance',
  'Site Survey',
  'Design',
  'Permitting',
  'Pending Install',
  'Installed',
  'PTO',
  'Completed',
];

/** Typical timeline hint shown below the stepper for the *next* phase */
const NEXT_ACTION_HINTS: Partial<Record<Phase, string>> = {
  'New':             'Acceptance — typically takes 1-2 business days',
  'Acceptance':      'Site Survey — typically takes 3-5 business days',
  'Site Survey':     'Design — typically takes 5-7 business days',
  'Design':          'Permitting — typically takes 2-4 weeks',
  'Permitting':      'Pending Install — typically takes 1-2 weeks',
  'Pending Install': 'Installed — typically takes 1-2 business days',
  'Installed':       'PTO — typically takes 2-4 weeks',
  'PTO':             'Completed — mark as fully done once PTO is granted',
};

export function PipelineStepper({ phase, soldDate }: { phase: Phase; soldDate: string }) {
  const currentIndex = PIPELINE_STEPS.indexOf(phase);
  const isOffTrack = currentIndex === -1; // Cancelled or On Hold

  // Days elapsed since sold date (NOTE: this is time since sale, not time in current phase)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [sy, sm, sd] = soldDate.split('-').map(Number);
  const sold  = new Date(sy, sm - 1, sd);
  const daysSinceSold = Math.max(0, Math.floor((today.getTime() - sold.getTime()) / (1000 * 60 * 60 * 24)));

  const nextHint   = NEXT_ACTION_HINTS[phase] ?? null;
  const isComplete = !isOffTrack && currentIndex === PIPELINE_STEPS.length - 1;

  return (
    <div className="bg-[var(--surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4 mb-6">

      {/* ── Horizontal stepper ── */}
      <div className="flex items-start w-full overflow-x-auto pb-0.5 gap-0">
        {PIPELINE_STEPS.map((step, index) => {
          const isCompleted = !isOffTrack && currentIndex > index;
          const isCurrent   = !isOffTrack && currentIndex === index;

          return (
            <div key={step} className="flex items-start">
              {/* Step node */}
              <div className="flex flex-col items-center shrink-0 w-14">
                {/* Circle */}
                <div className="relative flex items-center justify-center w-8 h-8">
                  {/* Pulsing halo on current step */}
                  {isCurrent && (
                    <span className="absolute inset-0 stepper-pulse" />
                  )}
                  <div
                    className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold z-10 transition-all duration-500 ${
                      isCompleted
                        ? 'bg-[var(--accent-green)] text-black'
                        : isCurrent
                        ? 'bg-[var(--accent-green)] text-black ring-2 ring-[var(--accent-green)] ring-offset-[3px] ring-offset-slate-900'
                        : 'bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-muted)]'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    ) : (
                      index + 1
                    )}
                  </div>
                </div>

                {/* Label */}
                <span
                  className={`mt-1.5 text-[9px] leading-tight text-center font-medium w-full ${
                    isCurrent   ? 'text-[var(--accent-green)]'
                    : isCompleted ? 'text-[var(--accent-green)]'
                    : 'text-[var(--text-dim)]'
                  }`}
                >
                  {step}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {index < PIPELINE_STEPS.length - 1 && (
                <div
                  className={`flex-1 min-w-[6px] h-0.5 mt-4 shrink ${
                    isCompleted ? 'stepper-connector-complete' : 'bg-[var(--border)]'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Days-in-stage badge + next-action prompt ── */}
      <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-3">

        {/* Badge — days elapsed since sold date */}
        {!isOffTrack && !isComplete && (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
            daysSinceSold > 30
              ? daysSinceSold > 60
                ? 'bg-red-900/40 border border-red-500/20 text-red-300'
                : 'bg-amber-900/40 border border-amber-500/20 text-amber-300'
              : 'bg-blue-900/40 border border-[var(--accent-green)]/20 text-[var(--accent-cyan)]'
          }`}>
            <Clock className="w-3 h-3" />
            {daysSinceSold} day{daysSinceSold !== 1 ? 's' : ''} since sold
          </span>
        )}

        {/* Off-track badge */}
        {isOffTrack && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
              phase === 'Cancelled'
                ? 'bg-red-900/40 border border-red-500/20 text-red-300'
                : 'bg-yellow-900/40 border border-yellow-500/20 text-yellow-300'
            }`}
          >
            {phase === 'Cancelled' ? 'Project Cancelled' : 'Project On Hold'}
          </span>
        )}

        {/* Next-action prompt */}
        {nextHint && (
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1 min-w-0">
            <ArrowRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
            <span className="text-[var(--text-muted)] shrink-0">Next:</span>
            <span className="text-[var(--text-secondary)] truncate">{nextHint}</span>
          </p>
        )}

        {/* Completion message */}
        {isComplete && (
          <p className="text-xs text-[var(--accent-green)] font-medium">
            Project complete!
          </p>
        )}
      </div>

      {/* ── Current phase info line ── */}
      {!isOffTrack && !isComplete && (
        <div className={`mt-3 px-3 py-2.5 rounded-xl border flex items-center gap-2 ${
          daysSinceSold > 30
            ? daysSinceSold > 60
              ? 'bg-red-900/20 border-red-500/20'
              : 'bg-amber-900/20 border-amber-500/20'
            : 'bg-[var(--surface-card)]/40 border-[var(--border)]/40'
        }`}>
          <span className={`text-sm font-semibold ${
            daysSinceSold > 30
              ? daysSinceSold > 60
                ? 'text-red-300'
                : 'text-amber-300'
              : 'text-white'
          }`}>
            Currently in: {phase}
          </span>
          {nextHint && (
            <span className={`text-xs ${
              daysSinceSold > 30 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
            }`}>
              — {nextHint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  const cancelled = phase === 'Cancelled';
  const pto = phase === 'PTO';
  const completed = phase === 'Completed';
  const onHold = phase === 'On Hold';
  const cls = cancelled
    ? 'bg-red-900/50 text-red-400'
    : completed
    ? 'bg-green-900/50 text-green-400 ring-1 ring-green-500/30'
    : pto
    ? 'bg-emerald-900/50 text-[var(--accent-green)]'
    : onHold
    ? 'bg-yellow-900/50 text-yellow-400'
    : 'bg-blue-900/50 text-[var(--accent-green)]';
  return <span className={`px-2.5 py-1 rounded-md text-sm font-medium ${cls}`}>{phase}{completed && ' ✓'}</span>;
}
