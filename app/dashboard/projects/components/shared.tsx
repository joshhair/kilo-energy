'use client';

import { ACTIVE_PHASES, Phase } from '../../../../lib/data';
import type { useApp } from '../../../../lib/context';

export type StatusFilter = 'active' | 'all' | 'completed' | 'cancelled' | 'on-hold' | 'inactive';

export type ProjectList = ReturnType<typeof useApp>['projects'];

/** Returns the number of calendar days between a YYYY-MM-DD date string and today. */
export function daysSince(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const past = new Date(year, month - 1, day);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Returns a human-readable relative time string like "3d ago", "2mo ago", "1y ago". */
export function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const days = daysSince(dateStr);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function applyStatusFilter(projects: ProjectList, status: StatusFilter) {
  if (status === 'all') return projects;
  if (status === 'active') return projects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  if (status === 'completed') return projects.filter((p) => p.phase === 'Completed');
  if (status === 'cancelled') return projects.filter((p) => p.phase === 'Cancelled');
  if (status === 'on-hold') return projects.filter((p) => p.phase === 'On Hold');
  if (status === 'inactive') return projects.filter((p) => p.phase === 'Cancelled' || p.phase === 'On Hold');
  return projects;
}

export const PHASE_COLORS: Record<string, string> = {
  'New': 'var(--accent-cyan-solid)',
  'Acceptance': 'var(--accent-blue-solid)',
  'Site Survey': 'var(--accent-purple-solid)',
  'Design': 'var(--accent-purple-solid)',
  'Permitting': 'var(--accent-amber-solid)',
  'Pending Install': 'var(--accent-amber-solid)',
  'Installed': 'var(--accent-teal-solid)',
  'PTO': 'var(--accent-emerald-solid)',
  'Completed': 'var(--accent-emerald-solid)',
  'Cancelled': 'var(--accent-red-solid)',
  'On Hold': 'var(--accent-amber-solid)',
};

export const PHASE_PILL: Record<string, { gradient: string; border: string; shadow: string; text: string; dot: string; hex: string }> = {
  'New':             { gradient: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         border: 'border-sky-700/30',      shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-cyan-solid) 15%, transparent)]',  text: 'text-[var(--accent-cyan-text)]',     dot: 'bg-sky-400',     hex: 'var(--accent-cyan-solid)' },
  'Acceptance':      { gradient: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    border: 'border-indigo-700/30',   shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-blue-solid) 15%, transparent)]',  text: 'text-[var(--accent-blue-text)]',  dot: 'bg-indigo-400',  hex: 'var(--accent-blue-solid)' },
  'Site Survey':     { gradient: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    border: 'border-violet-700/30',   shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-purple-solid) 15%, transparent)]',  text: 'text-[var(--accent-purple-text)]',  dot: 'bg-violet-400',  hex: 'var(--accent-purple-solid)' },
  'Design':          { gradient: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  border: 'border-fuchsia-700/30',  shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-purple-solid) 15%, transparent)]',  text: 'text-[var(--accent-purple-text)]', dot: 'bg-fuchsia-400', hex: 'var(--accent-purple-solid)' },
  'Permitting':      { gradient: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      border: 'border-amber-700/30',    shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)]',  text: 'text-[var(--accent-amber-text)]',   dot: 'bg-amber-400',   hex: 'var(--accent-amber-solid)' },
  'Pending Install': { gradient: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    border: 'border-orange-700/30',   shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)]',  text: 'text-[var(--accent-amber-text)]',  dot: 'bg-orange-400',  hex: 'var(--accent-amber-solid)' },
  'Installed':       { gradient: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        border: 'border-teal-700/30',     shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-teal-solid) 15%, transparent)]',  text: 'text-[var(--accent-teal-text)]',    dot: 'bg-teal-400',    hex: 'var(--accent-teal-solid)' },
  'PTO':             { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  border: 'border-emerald-700/30',  shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)]',  text: 'text-[var(--accent-emerald-text)]', dot: 'bg-emerald-400', hex: 'var(--accent-emerald-solid)' },
  'Completed':       { gradient: 'bg-gradient-to-r from-green-900/50 to-green-800/30',      border: 'border-green-600/40',    shadow: 'shadow-[0_0_8px_color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)]',   text: 'text-[var(--accent-emerald-text)]',   dot: 'bg-green-400',   hex: 'var(--accent-emerald-solid)' },
  'Cancelled':       { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',          border: 'border-red-700/30',      shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-red-solid) 15%, transparent)]',   text: 'text-[var(--accent-red-text)]',     dot: 'bg-red-400',     hex: 'var(--accent-red-solid)' },
  'On Hold':         { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',    border: 'border-yellow-700/30',   shadow: 'shadow-[0_0_6px_color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)]',   text: 'text-[var(--accent-amber-text)]',  dot: 'bg-yellow-400',  hex: 'var(--accent-amber-solid)' },
};

/**
 * Terminal phases never get a stale badge. PTO + Completed are
 * effectively done from a workflow standpoint; Cancelled / On Hold are
 * already off-track and the user has explicit signal there. Mirrors
 * Filter A in the daily stalled-digest cron.
 */
const STALE_TERMINAL_PHASES: ReadonlySet<Phase> = new Set([
  'PTO', 'Completed', 'Cancelled', 'On Hold',
] as Phase[]);

/**
 * Badge shown on project cards/rows when a project has been sitting in
 * its current phase too long.
 *
 * Refactored 2026-04-29: now uses `phaseChangedAt` (time-in-current-phase)
 * with fallback to `soldDate` for legacy rows that pre-date the column.
 * The per-phase thresholds live in the daily-digest cron — this badge
 * is a quick-glance, simple-global "30/60 day" signal.
 *
 *   30–59 days → amber
 *   60+ days   → red
 */
export function StaleBadge({
  soldDate,
  phase,
  phaseChangedAt,
}: {
  soldDate: string | null;
  phase: Phase;
  phaseChangedAt?: string | Date | null;
}) {
  if (!ACTIVE_PHASES.includes(phase)) return null;
  if (STALE_TERMINAL_PHASES.has(phase)) return null;

  // Prefer phaseChangedAt — captures "stuck in current phase" semantics.
  // Legacy rows fall back to soldDate (which is what the badge originally
  // measured before the column was added). daysSince expects ISO date
  // string `YYYY-MM-DD`, so normalize Dates first.
  const reference = phaseChangedAt ?? soldDate;
  if (!reference) return null;

  const referenceIso =
    typeof reference === 'string'
      ? reference.slice(0, 10)
      : reference.toISOString().slice(0, 10);
  const days = daysSince(referenceIso);
  if (days < 30) return null;
  const isRed = days >= 60;
  return (
    <span
      title={`${days} days in ${phase}`}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0"
      style={isRed
        ? { background: 'color-mix(in srgb, var(--accent-red-solid) 15%, transparent)', color: 'var(--accent-red-text)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 30%, transparent)' }
        : { background: 'color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)' }
      }
    >
      {days}d
    </span>
  );
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  const s = PHASE_PILL[phase] ?? { gradient: '', border: '', shadow: '', text: '', dot: '', hex: 'var(--text-muted)' };
  const hex = s.hex ?? 'var(--text-muted)';
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: `${hex}12`, border: `1px solid ${hex}30`, color: hex }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: hex }} />
      {phase}
    </span>
  );
}

export const STATUS_LABELS: Record<StatusFilter, string> = {
  active: 'Active',
  all: 'All',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'on-hold': 'On Hold',
  inactive: 'Inactive',
};

/** Pipeline phases used for the phase-advance quick action */
export const PIPELINE_PHASES: Phase[] = [
  'New', 'Acceptance', 'Site Survey', 'Design',
  'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed',
];
