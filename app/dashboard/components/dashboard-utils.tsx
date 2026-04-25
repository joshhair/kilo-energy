'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { getCustomConfig } from '../../../lib/utils';

// ─── Period type & constants ─────────────────────────────────────────────────

export type Period = 'all' | 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-year';

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'this-year', label: 'This Year' },
  { value: 'last-year', label: 'Last Year' },
];

// ─── Period helpers ──────────────────────────────────────────────────────────

export function isInPeriod(dateStr: string | null | undefined, period: Period): boolean {
  if (period === 'all') return true;
  if (!dateStr) return false;
  const [year, month] = dateStr.split('-').map(Number);
  const now = new Date();
  if (period === 'this-month') {
    return month - 1 === now.getMonth() && year === now.getFullYear();
  }
  if (period === 'last-month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return month - 1 === lastMonth.getMonth() && year === lastMonth.getFullYear();
  }
  if (period === 'this-quarter') {
    if (year !== now.getFullYear()) return false;
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const entryQuarter = Math.floor((month - 1) / 3);
    return entryQuarter === currentQuarter;
  }
  if (period === 'this-year') {
    return year === now.getFullYear();
  }
  if (period === 'last-year') {
    return year === now.getFullYear() - 1;
  }
  return true;
}

/** Returns true when dateStr falls in the period immediately preceding `period`. */
export function isInPreviousPeriod(dateStr: string | null | undefined, period: Period): boolean {
  if (!dateStr) return false;
  const [year, month] = dateStr.split('-').map(Number);
  const now = new Date();
  if (period === 'this-month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return month - 1 === lastMonth.getMonth() && year === lastMonth.getFullYear();
  }
  if (period === 'last-month') {
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return month - 1 === twoMonthsAgo.getMonth() && year === twoMonthsAgo.getFullYear();
  }
  if (period === 'this-quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const prevQuarterStartMonth = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
    const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const entryQuarter = Math.floor((month - 1) / 3);
    return year === prevQuarterYear && entryQuarter * 3 === prevQuarterStartMonth;
  }
  if (period === 'this-year') {
    return year === now.getFullYear() - 1;
  }
  if (period === 'last-year') {
    return year === now.getFullYear() - 2;
  }
  return false;
}

export function isThisWeek(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return date >= startOfWeek && date < endOfWeek;
}

export function isThisMonth(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const [year, month] = dateStr.split('-').map(Number);
  const now = new Date();
  return month - 1 === now.getMonth() && year === now.getFullYear();
}

// ─── Phase stuck thresholds ──────────────────────────────────────────────────

/** Cumulative days-from-sold thresholds — a project still in this phase after this many total days is "stuck". */
const DEFAULT_PHASE_STUCK_THRESHOLDS: Record<string, number> = {
  'New':             5,
  'Acceptance':      10,
  'Site Survey':     20,
  'Design':          30,
  'Permitting':      50,
  'Pending Install': 65,
  'Installed':       75,
};

export function getPhaseStuckThresholds(): Record<string, number> {
  return getCustomConfig('kilo-pipeline-thresholds', DEFAULT_PHASE_STUCK_THRESHOLDS);
}

// ─── Time / date formatting helpers ──────────────────────────────────────────

export function relativeTimeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function isOverdue(dueDate: string): boolean {
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

// ─── Greeting ────────────────────────────────────────────────────────────────

export function getGreeting(name: string | null | undefined): string {
  const h = new Date().getHours();
  const prefix = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (name ?? '').split(' ')[0] || '';
  return firstName ? `${prefix}, ${firstName}` : prefix;
}

// ─── Count-Up Hook ───────────────────────────────────────────────────────────

export function useCountUp(target: number, duration = 800): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const prevRef = useRef(0);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = prevRef.current;
    let startTime: number | null = null;

    const step = (ts: number) => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = target;
        setDisplay(target);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

// ─── Animated Stat Value ─────────────────────────────────────────────────────

export function AnimatedStatValue({ raw, format, className, style }: { raw: number; format: (n: number) => string; className?: string; style?: CSSProperties }) {
  const animated = useCountUp(raw, 900);
  return <p className={className} style={style}>{format(animated)}</p>;
}

// ─── Trend Badge ─────────────────────────────────────────────────────────────
/**
 * pctChange:
 *  undefined → hide badge entirely (period has no comparable predecessor)
 *  null      → show neutral dash (predecessor exists but had no data / zero base)
 *  number    → show green/red pill with percentage
 */
export function TrendBadge({ pctChange }: { pctChange: number | null | undefined }) {
  if (pctChange === undefined) return null;

  if (pctChange === null) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--text-muted)]/15 text-[var(--text-secondary)]">
        —
      </span>
    );
  }

  if (pctChange > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent-emerald-solid)]/15 text-[var(--accent-emerald-solid)]">
        <TrendingUp className="w-2.5 h-2.5" />
        +{Math.round(pctChange)}%
      </span>
    );
  }

  if (pctChange < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">
        <TrendingDown className="w-2.5 h-2.5" />
        {Math.round(pctChange)}%
      </span>
    );
  }

  // Exactly 0% — neutral dash
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--text-muted)]/15 text-[var(--text-secondary)]">
      —
    </span>
  );
}
