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
  'Site Survey': '#b47dff',
  'Design': '#b47dff',
  'Permitting': 'var(--accent-amber-solid)',
  'Pending Install': 'var(--accent-amber-solid)',
  'Installed': '#00d4c8',
  'PTO': 'var(--accent-emerald-solid)',
  'Completed': 'var(--accent-emerald-solid)',
  'Cancelled': 'var(--accent-red-solid)',
  'On Hold': 'var(--accent-amber-solid)',
};

export const PHASE_PILL: Record<string, { gradient: string; border: string; shadow: string; text: string; dot: string; hex: string }> = {
  'New':             { gradient: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         border: 'border-sky-700/30',      shadow: 'shadow-[0_0_6px_rgba(14,165,233,0.15)]',  text: 'text-sky-300',     dot: 'bg-sky-400',     hex: 'var(--accent-cyan-solid)' },
  'Acceptance':      { gradient: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    border: 'border-indigo-700/30',   shadow: 'shadow-[0_0_6px_rgba(99,102,241,0.15)]',  text: 'text-indigo-300',  dot: 'bg-indigo-400',  hex: 'var(--accent-blue-solid)' },
  'Site Survey':     { gradient: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    border: 'border-violet-700/30',   shadow: 'shadow-[0_0_6px_rgba(139,92,246,0.15)]',  text: 'text-violet-300',  dot: 'bg-violet-400',  hex: '#b47dff' },
  'Design':          { gradient: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  border: 'border-fuchsia-700/30',  shadow: 'shadow-[0_0_6px_rgba(217,70,239,0.15)]',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400', hex: '#b47dff' },
  'Permitting':      { gradient: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      border: 'border-amber-700/30',    shadow: 'shadow-[0_0_6px_rgba(245,158,11,0.15)]',  text: 'text-amber-300',   dot: 'bg-amber-400',   hex: 'var(--accent-amber-solid)' },
  'Pending Install': { gradient: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    border: 'border-orange-700/30',   shadow: 'shadow-[0_0_6px_rgba(249,115,22,0.15)]',  text: 'text-orange-300',  dot: 'bg-orange-400',  hex: 'var(--accent-amber-solid)' },
  'Installed':       { gradient: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        border: 'border-teal-700/30',     shadow: 'shadow-[0_0_6px_rgba(20,184,166,0.15)]',  text: 'text-teal-300',    dot: 'bg-teal-400',    hex: '#00d4c8' },
  'PTO':             { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  border: 'border-emerald-700/30',  shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]',  text: 'text-emerald-300', dot: 'bg-emerald-400', hex: 'var(--accent-emerald-solid)' },
  'Completed':       { gradient: 'bg-gradient-to-r from-green-900/50 to-green-800/30',      border: 'border-green-600/40',    shadow: 'shadow-[0_0_8px_rgba(34,197,94,0.25)]',   text: 'text-green-300',   dot: 'bg-green-400',   hex: 'var(--accent-emerald-solid)' },
  'Cancelled':       { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',          border: 'border-red-700/30',      shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.15)]',   text: 'text-red-300',     dot: 'bg-red-400',     hex: 'var(--accent-red-solid)' },
  'On Hold':         { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',    border: 'border-yellow-700/30',   shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',   text: 'text-yellow-300',  dot: 'bg-yellow-400',  hex: 'var(--accent-amber-solid)' },
};

/**
 * Badge shown on Kanban cards when a project has been in the pipeline for
 * more than 30 days since the sold date.
 *   30–59 days → amber
 *   60+ days   → red
 */
export function StaleBadge({ soldDate, phase }: { soldDate: string | null; phase: Phase }) {
  if (!ACTIVE_PHASES.includes(phase) || phase === 'Completed') return null;
  if (!soldDate) return null;
  const days = daysSince(soldDate);
  if (days < 30) return null;
  const isRed = days >= 60;
  return (
    <span
      title={`${days} days since sold`}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0"
      style={isRed
        ? { background: 'rgba(255,82,82,0.15)', color: 'var(--accent-red-solid)', border: '1px solid rgba(255,82,82,0.3)' }
        : { background: 'rgba(255,176,32,0.15)', color: 'var(--accent-amber-solid)', border: '1px solid rgba(255,176,32,0.3)' }
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
