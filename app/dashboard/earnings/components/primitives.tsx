'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Sparkline } from '../../../../lib/sparkline';

// ── Sort icon ──────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

export function SortIcon<K extends string>({ colKey, sortKey, sortDir }: { colKey: K; sortKey: K; sortDir: SortDir }) {
  if (sortKey !== colKey) return <ChevronsUpDown className="w-3.5 h-3.5 ml-1 inline-block text-[var(--text-dim)]" />;
  if (sortDir === 'asc') return <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" />;
  return <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />;
}

// ── Status badges ──────────────────────────────────────────────────────────────

type PillStyle = { gradient: string; border: string; shadow: string; text: string; dot: string };

export const PAYROLL_PILL: Record<string, PillStyle> = {
  'Paid':    { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20', border: 'border-emerald-700/30', shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]',  text: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Pending': { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',   border: 'border-yellow-700/30',  shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',   text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
  'Draft':   { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20',     border: 'border-[var(--border)]/30',   shadow: '',                                        text: 'text-[var(--text-secondary)]',   dot: 'bg-[var(--text-muted)]'   },
};

export const REIMB_PILL: Record<string, PillStyle> = {
  'Approved': { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20', border: 'border-emerald-700/30', shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Pending':  { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',   border: 'border-yellow-700/30',  shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',  text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
  'Denied':   { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',         border: 'border-red-700/30',     shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.15)]',  text: 'text-red-300',     dot: 'bg-red-400'     },
};

const DEFAULT_PILL: PillStyle = { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-[var(--border)]/30', shadow: '', text: 'text-[var(--text-secondary)]', dot: 'bg-[var(--text-muted)]' };

export function StatusPill({ label, pillMap }: { label: string; pillMap: Record<string, PillStyle> }) {
  const s = pillMap[label] ?? DEFAULT_PILL;
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {label}
    </span>
  );
}

export function PayrollStatusBadge({ status }: { status: string }) { return <StatusPill label={status} pillMap={PAYROLL_PILL} />; }
export function ReimbStatusBadge({ status }: { status: string }) { return <StatusPill label={status} pillMap={REIMB_PILL} />; }

// ── Phase-aware row accent ──────────────────────────────────────────────────────

/** Maps a payroll status to the matching PAYROLL_PILL accent colour hex value. */
export function getPayrollRowAccent(status: string): string {
  if (status === 'Paid')    return 'var(--accent-green)'; // emerald-500
  if (status === 'Pending') return '#eab308'; // yellow-500
  return '#64748b';                            // slate-500  (Draft / fallback)
}

// ── Sparkline with hover tooltip ───────────────────────────────────────────────

export function SparklineWithTooltip({ data, stroke }: { data: number[]; stroke: string }) {
  const [hovered, setHovered] = useState(false);
  const lastVal = data.length > 0 ? data[data.length - 1] : null;
  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Sparkline data={data} stroke={stroke} />
      {hovered && lastVal !== null && (
        <div className="absolute -top-7 right-0 bg-[var(--surface-card)] border border-[var(--border)] text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap pointer-events-none z-10">
          ${lastVal.toLocaleString()}
        </div>
      )}
    </div>
  );
}

// ── Next-payout date helpers ───────────────────────────────────────────────────

/** Returns the next Friday on or after `from` (day=5 → today counts). */
export function getNextFriday(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay(); // 0=Sun … 6=Sat
  const daysToFriday = day <= 5 ? 5 - day : 6; // Sat → 6 days forward
  d.setDate(d.getDate() + daysToFriday);
  return d;
}

export function formatPayoutDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function daysUntilDate(target: Date, from: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((b - a) / msPerDay);
}

// ── Monthly sparkline helper ───────────────────────────────────────────────────

/**
 * Groups entries by calendar month (YYYY-MM), sorts ascending, and returns the
 * summed amounts for the last 6 unique months found. Returns an empty array
 * when there are no entries.
 */
export function computeMonthlySparklineData(entries: { date: string; amount: number }[]): number[] {
  const byMonth = new Map<string, number>();
  for (const e of entries) {
    const month = e.date.slice(0, 7); // "YYYY-MM"
    byMonth.set(month, (byMonth.get(month) ?? 0) + e.amount);
  }
  const sortedMonths = [...byMonth.keys()].sort();
  const last6 = sortedMonths.slice(-6);
  return last6.map((m) => byMonth.get(m)!);
}

export type { SortDir, PillStyle };
