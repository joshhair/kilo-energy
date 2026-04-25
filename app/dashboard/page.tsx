'use client';

import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import { useApp } from '../../lib/context';
import { useIsHydrated, useScrollReveal, useMediaQuery } from '../../lib/hooks';
import MobileDashboard from './mobile/MobileDashboard';
import { computeSparklineData, Sparkline } from '../../lib/sparkline';
import {
  computeIncentiveProgress, formatIncentiveMetric,
  getTrainerOverrideRate,
  ACTIVE_PHASES,
  DEFAULT_INSTALL_PAY_PCT, INSTALLER_PAY_CONFIGS,
} from '../../lib/data';
import { fmt$, formatCompactKW } from '../../lib/utils';
import { sumPaid, sumPendingChargebacks, countPendingChargebacks } from '../../lib/aggregators';
import { TrendingUp, AlertCircle, DollarSign, CheckCircle, CheckSquare, Zap, Target, FolderKanban, Flag, Clock, ChevronRight, ChevronUp, ChevronDown, PlusCircle, PauseCircle, HelpCircle } from 'lucide-react';

// ── Extracted component imports ──────────────────────────────────────────────
import {
  type Period,
  PERIODS as SHARED_PERIODS,
  isInPeriod, isInPreviousPeriod, isThisWeek, isThisMonth,
  getPhaseStuckThresholds, relativeTimeShort, formatDueDate, isOverdue,
  getGreeting, TrendBadge,
} from './components/dashboard-utils';
import { PMDashboard } from './components/PMDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { SubDealerDashboard } from './components/SubDealerDashboard';
import { DashboardSkeleton } from './components/DashboardSkeleton';

// ── Re-export Period type for extracted components ───────────────────────────
export type { Period } from './components/dashboard-utils';

/** Maps Tailwind accent-gradient class strings to an RGBA glow for --card-accent */
export const ACCENT_COLOR_MAP: Record<string, string> = {
  'from-blue-500 to-blue-400':       'rgba(59,130,246,0.08)',
  'from-red-500 to-red-400':         'rgba(239,68,68,0.08)',
  'from-emerald-500 to-emerald-400': 'rgba(16,185,129,0.08)',
  'from-yellow-500 to-yellow-400':   'rgba(234,179,8,0.08)',
  'from-purple-500 to-purple-400':   'rgba(168,85,247,0.08)',
  'from-amber-500 to-amber-400':     'rgba(245,158,11,0.08)',
};

/** Pipeline phase color palette — mirrors PHASE_PILL in projects/page.tsx */
const PIPELINE_PHASE_COLORS: Record<string, { bar: string; text: string; dot: string; chipBg: string; chipBorder: string }> = {
  'New':             { bar: 'bg-sky-500',      text: 'text-sky-300',     dot: 'bg-sky-400',     chipBg: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         chipBorder: 'border-sky-700/30'      },
  'Acceptance':      { bar: 'bg-indigo-500',   text: 'text-indigo-300',  dot: 'bg-indigo-400',  chipBg: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    chipBorder: 'border-indigo-700/30'   },
  'Site Survey':     { bar: 'bg-violet-500',   text: 'text-violet-300',  dot: 'bg-violet-400',  chipBg: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    chipBorder: 'border-violet-700/30'   },
  'Design':          { bar: 'bg-fuchsia-500',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400', chipBg: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  chipBorder: 'border-fuchsia-700/30'  },
  'Permitting':      { bar: 'bg-amber-500',    text: 'text-amber-300',   dot: 'bg-amber-400',   chipBg: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      chipBorder: 'border-amber-700/30'    },
  'Pending Install': { bar: 'bg-orange-500',   text: 'text-orange-300',  dot: 'bg-orange-400',  chipBg: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    chipBorder: 'border-orange-700/30'   },
  'Installed':       { bar: 'bg-teal-500',     text: 'text-teal-300',    dot: 'bg-teal-400',    chipBg: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        chipBorder: 'border-teal-700/30'     },
  'PTO':             { bar: 'bg-[var(--accent-emerald-solid)]',  text: 'text-emerald-300', dot: 'bg-emerald-400', chipBg: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  chipBorder: 'border-emerald-700/30'  },
  'Completed':       { bar: 'bg-slate-500',     text: 'text-slate-300',   dot: 'bg-slate-400',   chipBg: 'bg-gradient-to-r from-slate-900/40 to-slate-800/20',       chipBorder: 'border-slate-700/30'    },
};

// ─── Needs Attention ──────────────────────────────────────────────────────────

export type MentionItem = {
  id: string;
  projectId: string;
  projectCustomerName: string;
  messageId: string;
  messageSnippet: string;
  authorName: string;
  checkItems: Array<{ id: string; text: string; completed: boolean; dueDate?: string | null }>;
  createdAt: string;
  read: boolean;
};

type AttentionItem = {
  uid: string;
  projectId: string;
  customerName: string;
  kind: 'flagged' | 'stuck' | 'on-hold';
  staleDays?: number;
  stuckPhase?: string;
  holdDays?: number;
  repName?: string;
};

export function NeedsAttentionSection({
  activeProjects,
  isAdmin = false,
  onUnflag,
  payrollAttentionCount = 0,
}: {
  activeProjects: Array<{
    id: string;
    customerName: string;
    setterId?: string;
    flagged: boolean;
    soldDate: string;
    phase: string;
    repName?: string;
    updatedAt?: string;
    phaseChangedAt?: string;
  }>;
  isAdmin?: boolean;
  onUnflag?: (projectId: string) => void;
  payrollAttentionCount?: number;
}) {
  const [sectionRef, sectionVisible] = useScrollReveal<HTMLDivElement>();
  const PHASE_STUCK_THRESHOLDS = getPhaseStuckThresholds();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items: AttentionItem[] = [];

  // Self-gen deals (no setter) are normal — not an attention item

  for (const proj of activeProjects) {
    if (proj.flagged) {
      items.push({
        uid: `flagged-${proj.id}`,
        projectId: proj.id,
        customerName: proj.customerName,
        kind: 'flagged',
        repName: proj.repName,
      });
    }
  }

  for (const proj of activeProjects) {
    if (proj.flagged) continue; // already added above; don't double-count
    const threshold = PHASE_STUCK_THRESHOLDS[proj.phase];
    if (threshold == null) continue; // skip phases without a threshold (e.g. PTO)
    const phaseSince = proj.phaseChangedAt ? new Date(proj.phaseChangedAt) : (() => {
      if (!proj.soldDate) return null;
      const [sy, sm, sd] = proj.soldDate.split('-').map(Number);
      return new Date(sy, sm - 1, sd);
    })();
    if (!phaseSince) continue;
    const diffDays = Math.floor((today.getTime() - phaseSince.getTime()) / 86_400_000);
    if (diffDays > threshold) {
      items.push({
        uid: `stuck-${proj.id}`,
        projectId: proj.id,
        customerName: proj.customerName,
        kind: 'stuck',
        staleDays: diffDays,
        stuckPhase: proj.phase,
        repName: proj.repName,
      });
    }
  }

  for (const proj of activeProjects) {
    if (proj.flagged) continue; // already added above; don't double-count
    if (proj.phase === 'On Hold') {
      // Use phaseChangedAt (stamped when phase changes) for accurate hold duration.
      // Fallback to soldDate only for legacy rows predating phaseChangedAt.
      const holdSince = proj.phaseChangedAt ? new Date(proj.phaseChangedAt) : (() => {
        if (!proj.soldDate) return today;
        const [y, m, d] = proj.soldDate.split('-').map(Number);
        return new Date(y, m - 1, d);
      })();
      const holdDays = Math.floor((today.getTime() - holdSince.getTime()) / 86_400_000);
      items.push({
        uid: `on-hold-${proj.id}`,
        projectId: proj.id,
        customerName: proj.customerName,
        kind: 'on-hold',
        holdDays,
        repName: proj.repName,
      });
    }
  }

  // Note: @mentions are handled by the separate MyTasksSection, not Needs Attention

  // Sort: flagged first, then by staleDays (stuck) or holdDays (on-hold) descending (most urgent first)
  items.sort((a, b) => {
    const aFlagged = a.kind === 'flagged' ? 1 : 0;
    const bFlagged = b.kind === 'flagged' ? 1 : 0;
    if (bFlagged !== aFlagged) return bFlagged - aFlagged;
    return (b.staleDays ?? b.holdDays ?? 0) - (a.staleDays ?? a.holdDays ?? 0);
  });

  const [open, setOpen] = useState(true);

  const capped = items.slice(0, 5);
  const hasMore = items.length > 5;
  const totalCount = items.length + (payrollAttentionCount > 0 ? 1 : 0);

  return (
    <div
      ref={sectionRef}
      className={`card-surface rounded-2xl mb-6 ${sectionVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
      style={totalCount === 0 ? { borderLeft: '3px solid var(--accent-emerald-solid)' } : undefined}
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-[var(--surface-card)]/30 transition-colors rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <div className={`h-[2px] w-8 rounded-full bg-gradient-to-r ${totalCount > 0 ? 'from-amber-500 to-amber-400' : 'from-emerald-500 to-emerald-400'}`} />
          <div className={`p-1.5 rounded-lg ${totalCount > 0 ? 'bg-amber-500/15' : 'bg-[var(--accent-emerald-solid)]/15'}`}>
            {totalCount > 0
              ? <AlertCircle className="w-4 h-4 text-amber-400" />
              : <CheckCircle className="w-4 h-4" style={{ color: 'var(--accent-emerald-solid)' }} />
            }
          </div>
          <h2 className="text-white font-bold tracking-tight text-base" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {totalCount > 0 ? 'Needs Attention' : 'All Clear'}
          </h2>
          {totalCount > 0 && (
            <span className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-white transition-colors" />
          : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-white transition-colors" />
        }
      </button>

      <div className={`collapsible-panel ${open ? 'open' : ''}`}>
        <div className="collapsible-inner">
          <div className="divider-gradient-animated" />

          {totalCount === 0 ? (
            /* ── Empty / all-clear state ── */
            <div className="flex items-center gap-3 px-6 py-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(0,224,122,0.12)' }}>
                <CheckCircle className="w-4 h-4" style={{ color: 'var(--accent-emerald-solid)' }} />
              </div>
              <p className="text-[var(--text-secondary)] text-sm">All clear! No items need attention right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {capped.map((item) => (
                <div
                  key={item.uid}
                  className="flex items-center gap-4 px-6 py-3.5 min-h-[44px] hover:bg-[var(--surface-card)]/40 transition-colors group"
                >
                  <Link
                    href={`/dashboard/projects/${item.projectId}`}
                    className="flex items-center gap-4 flex-1 min-w-0"
                  >
                    {/* Kind icon — stuck uses tiered colors based on how far past threshold */}
                    {(() => {
                      const threshold = item.stuckPhase ? (PHASE_STUCK_THRESHOLDS[item.stuckPhase] ?? 14) : 14;
                      const ratio = (item.staleDays ?? 0) / threshold;
                      const isCritical = ratio >= 2;
                      const isBehind = ratio >= 1.5;
                      // isSlow implied otherwise (ratio >= 1)
                      return (
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            item.kind === 'flagged'
                              ? 'bg-red-500/15'
                              : item.kind === 'on-hold'
                              ? 'bg-yellow-500/15'
                              : item.kind === 'stuck' && isCritical
                              ? 'bg-red-500/15'
                              : item.kind === 'stuck' && isBehind
                              ? 'bg-orange-500/15'
                              : 'bg-amber-500/15'
                          }`}
                        >
                          {item.kind === 'flagged' && <Flag className="w-4 h-4 text-red-400" />}
                          {item.kind === 'stuck' && isCritical && (
                            <span className="relative flex items-center justify-center">
                              <Clock className="w-4 h-4 text-red-400" />
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                            </span>
                          )}
                          {item.kind === 'stuck' && isBehind && !isCritical && (
                            <Clock className="w-4 h-4 text-orange-400" />
                          )}
                          {item.kind === 'stuck' && !isBehind && (
                            <Clock className="w-4 h-4 text-amber-400" />
                          )}
                          {item.kind === 'on-hold' && <PauseCircle className="w-4 h-4 text-yellow-400" />}
                        </div>
                      );
                    })()}

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{item.customerName}</p>
                      <p className={`text-xs ${
                        (() => {
                          if (item.kind !== 'stuck') return 'text-[var(--text-muted)]';
                          const threshold = item.stuckPhase ? (PHASE_STUCK_THRESHOLDS[item.stuckPhase] ?? 14) : 14;
                          const ratio = (item.staleDays ?? 0) / threshold;
                          if (ratio >= 2) return 'text-red-400';
                          if (ratio >= 1.5) return 'text-orange-400';
                          return 'text-amber-400';
                        })()
                      }`}>
                        {item.kind === 'flagged' && 'Flagged for review'}
                        {item.kind === 'stuck' && `${item.staleDays ?? 0} days since update · ${item.stuckPhase}`}
                        {item.kind === 'on-hold' && `On hold · ${item.holdDays ?? 0}d`}
                        {isAdmin && item.repName ? ` \u00b7 ${item.repName}` : ''}
                      </p>
                    </div>
                  </Link>

                  {/* Inline quick actions (admin only) */}
                  {isAdmin && (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      {item.kind === 'flagged' && onUnflag && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnflag(item.projectId);
                          }}
                          className="px-2 py-0.5 text-xs rounded-md bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-white transition-colors"
                        >
                          Unflag
                        </button>
                      )}
                      {item.kind === 'on-hold' && (
                        <Link
                          href={`/dashboard/projects/${item.projectId}?action=resume`}
                          className="px-2 py-0.5 text-xs rounded-md bg-[var(--surface-card)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-white transition-colors"
                        >
                          Resume
                        </Link>
                      )}
                    </div>
                  )}

                  <Link href={`/dashboard/projects/${item.projectId}`} className="flex-shrink-0">
                    <ChevronRight className="w-4 h-4 text-[var(--text-dim)] group-hover:text-[var(--text-secondary)] transition-colors" />
                  </Link>
                </div>
              ))}

              {/* View all link when capped */}
              {hasMore && (
                <div className="px-6 py-3 flex items-center justify-between">
                  <span className="text-[var(--text-muted)] text-xs">{items.length - 5} more item{items.length - 5 !== 1 ? 's' : ''} hidden</span>
                  <Link
                    href="/dashboard/projects"
                    className="text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] text-xs transition-colors"
                  >
                    View all projects →
                  </Link>
                </div>
              )}

              {/* Payroll attention row */}
              {payrollAttentionCount > 0 && (
                <Link
                  href="/dashboard/payroll"
                  className="flex items-center gap-4 px-6 py-3.5 min-h-[44px] hover:bg-[var(--surface-card)]/40 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-amber-500/15">
                    <DollarSign className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">Payroll needs review</p>
                    <p className="text-xs text-[var(--text-muted)]">{payrollAttentionCount} entr{payrollAttentionCount !== 1 ? 'ies' : 'y'} in Draft or Pending</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-dim)] group-hover:text-[var(--text-secondary)] transition-colors flex-shrink-0" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── My Tasks (aggregated uncompleted check items from chatter mentions) ──────

type TaskItem = {
  checkItemId: string;
  text: string;
  projectId: string;
  projectName: string;
  messageId: string;
  authorName: string;
  createdAt: string;
  dueDate?: string | null;
};

export function MyTasksSection({
  mentions,
  onToggleTask,
}: {
  mentions: MentionItem[];
  onToggleTask: (projectId: string, messageId: string, checkItemId: string, completed: boolean) => Promise<void>;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Extract all uncompleted check items across all mentions
  const tasks: TaskItem[] = [];
  for (const mention of mentions) {
    for (const ci of mention.checkItems) {
      if (!ci.completed && !checkedIds.has(ci.id)) {
        tasks.push({
          checkItemId: ci.id,
          text: ci.text,
          projectId: mention.projectId,
          projectName: mention.projectCustomerName,
          messageId: mention.messageId,
          authorName: mention.authorName,
          createdAt: mention.createdAt,
          dueDate: ci.dueDate,
        });
      }
    }
  }

  // Sort: overdue first, then by due date (soonest), then by createdAt (newest). No due date at bottom.
  tasks.sort((a, b) => {
    const aHasDue = !!a.dueDate;
    const bHasDue = !!b.dueDate;
    if (aHasDue && !bHasDue) return -1;
    if (!aHasDue && bHasDue) return 1;
    if (aHasDue && bHasDue) {
      const aOverdue = isOverdue(a.dueDate!);
      const bOverdue = isOverdue(b.dueDate!);
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime();
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (tasks.length === 0) return null;

  return (
    <div className="card-surface rounded-2xl mb-6">
      <div className="px-6 py-4 flex items-center gap-3">
        <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
        <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
          <CheckSquare className="w-4 h-4 text-[var(--accent-emerald-solid)]" />
        </div>
        <h2 className="text-white font-bold tracking-tight text-base">My Tasks</h2>
        <span className="bg-[var(--accent-emerald-solid)]/20 border border-[var(--accent-emerald-solid)]/30 text-[var(--accent-emerald-solid)] text-xs font-bold px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <div className="divider-gradient-animated" />
      <div className="divide-y divide-slate-800/60">
        {tasks.map((task) => {
          const overdue = task.dueDate ? isOverdue(task.dueDate) : false;
          return (
            <div
              key={task.checkItemId}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] hover:bg-[var(--surface-card)]/40 transition-colors group"
            >
              <input
                type="checkbox"
                checked={checkedIds.has(task.checkItemId)}
                onChange={async () => {
                  const wasCompleted = checkedIds.has(task.checkItemId);
                  const newCompleted = !wasCompleted;
                  setCheckedIds((prev) => {
                    const next = new Set(prev);
                    if (newCompleted) next.add(task.checkItemId);
                    else next.delete(task.checkItemId);
                    return next;
                  });
                  try {
                    await onToggleTask(task.projectId, task.messageId, task.checkItemId, newCompleted);
                  } catch {
                    // Revert optimistic update on API failure using pre-toggle state
                    setCheckedIds((prev) => {
                      const next = new Set(prev);
                      if (wasCompleted) next.add(task.checkItemId);
                      else next.delete(task.checkItemId);
                      return next;
                    });
                  }
                }}
                className="w-4 h-4 rounded border-[var(--border)] bg-[var(--surface-card)] text-[var(--accent-emerald-solid)] focus:ring-emerald-500/30 focus:ring-offset-0 cursor-pointer accent-[var(--accent-emerald-solid)] flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${overdue ? 'text-red-300' : 'text-[var(--text-secondary)]'}`}>
                  {task.text}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Link
                    href={`/dashboard/projects/${task.projectId}#chatter`}
                    className="text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] text-xs transition-colors truncate max-w-[140px]"
                  >
                    {task.projectName}
                  </Link>
                  <span className="text-[var(--text-dim)] text-[10px]">from {task.authorName}</span>
                  <span className="text-[var(--text-dim)] text-[10px]">{relativeTimeShort(task.createdAt)}</span>
                  {task.dueDate && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        overdue
                          ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                          : 'bg-[var(--border)]/50 text-[var(--text-secondary)] border border-[var(--border)]/30'
                      }`}
                    >
                      {overdue ? 'Overdue' : `Due ${formatDueDate(task.dueDate)}`}
                    </span>
                  )}
                </div>
              </div>
              <Link href={`/dashboard/projects/${task.projectId}#chatter`} className="flex-shrink-0">
                <ChevronRight className="w-4 h-4 text-[var(--text-dim)] group-hover:text-[var(--text-secondary)] transition-colors" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pipeline Overview ─────────────────────────────────────────────────────────
export function PipelineOverview({ activeProjects }: { activeProjects: Array<{ phase: string }> }) {
  const [mounted, setMounted] = useState(false);
  const [tooltip, setTooltip] = useState<{ phase: string; x: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // One rAF so the browser paints width:0 first, then transitions to real widths
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = activeProjects.length;

  // Single-pass phase count. Previously did one .filter() per phase
  // (9 phases × 2000+ projects = ~18k comparisons per render).
  const phaseCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const phase of ACTIVE_PHASES) counts[phase] = 0;
    for (const p of activeProjects) {
      if (counts[p.phase] !== undefined) counts[p.phase]++;
    }
    return counts;
  }, [activeProjects]);

  const nonEmpty = useMemo(() => ACTIVE_PHASES.filter((ph) => phaseCounts[ph] > 0), [phaseCounts]);

  if (total === 0) {
    return (
      <div className="border border-dashed border-[var(--border-subtle)] rounded-2xl px-5 py-12 text-center">
        <FolderKanban className="w-8 h-8 text-[var(--text-dim)] mx-auto mb-3" />
        <p className="text-white font-bold text-sm mb-1">No active projects — submit your first deal</p>
        <p className="text-[var(--text-muted)] text-xs mt-1">Your pipeline will appear here once you close a deal.</p>
      </div>
    );
  }

  return (
    <>
      {/* Stacked bar — overflow-hidden clips segment edges cleanly at the rounded corners */}
      <div className="relative mb-4" ref={barRef}>
        <div className="flex h-10 md:h-8 rounded-xl bg-[var(--surface-card)] overflow-hidden">
          {nonEmpty.map((phase) => {
            const count = phaseCounts[phase];
            const s = PIPELINE_PHASE_COLORS[phase] ?? { bar: 'bg-[var(--text-muted)]', text: '', dot: '', chipBg: '', chipBorder: '' };
            return (
              <Link
                key={phase}
                href={`/dashboard/projects?phase=${encodeURIComponent(phase)}`}
                className={`${s.bar} transition-all duration-700 ease-out hover:brightness-110`}
                style={{ width: mounted ? `${(count / total) * 100}%` : '0%' }}
                aria-label={`${phase}: ${count} project${count !== 1 ? 's' : ''}`}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const parentRect = barRef.current?.getBoundingClientRect();
                  if (parentRect) {
                    setTooltip({ phase, x: rect.left - parentRect.left + rect.width / 2 });
                  }
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}
        </div>
        {/* Floating tooltip — rendered outside overflow-hidden bar, relative to wrapper */}
        {tooltip && (
          <div
            className="pointer-events-none absolute -top-8 bg-[var(--surface-card)] border border-[var(--border)] text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap z-20 -translate-x-1/2"
            style={{ left: tooltip.x }}
          >
            {tooltip.phase}: {phaseCounts[tooltip.phase]} project{phaseCounts[tooltip.phase] !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Mini-stat chips — only phases with >0 projects */}
      <div className="flex flex-wrap gap-2">
        {nonEmpty.map((phase) => {
          const count = phaseCounts[phase];
          const s = PIPELINE_PHASE_COLORS[phase] ?? { bar: 'bg-[var(--text-muted)]', text: 'text-[var(--text-secondary)]', dot: 'bg-[var(--text-muted)]', chipBg: '', chipBorder: '' };
          return (
            <Link
              key={phase}
              href={`/dashboard/projects?phase=${encodeURIComponent(phase)}`}
              className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 min-h-[32px] rounded-full text-xs font-medium border whitespace-nowrap transition-all hover:brightness-110 ${s.chipBg} ${s.chipBorder} ${s.text}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
              {count} in {phase}
            </Link>
          );
        })}
      </div>
    </>
  );
}

// ─── Phase Color Constants ───────────────────────────────────────────────────

const PHASE_PILL: Record<string, { gradient: string; border: string; shadow: string; text: string; dot: string }> = {
  'New':             { gradient: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         border: 'border-sky-700/30',      shadow: 'shadow-[0_0_6px_rgba(14,165,233,0.15)]',  text: 'text-sky-300',     dot: 'bg-sky-400'     },
  'Acceptance':      { gradient: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    border: 'border-indigo-700/30',   shadow: 'shadow-[0_0_6px_rgba(99,102,241,0.15)]',  text: 'text-indigo-300',  dot: 'bg-indigo-400'  },
  'Site Survey':     { gradient: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    border: 'border-violet-700/30',   shadow: 'shadow-[0_0_6px_rgba(139,92,246,0.15)]',  text: 'text-violet-300',  dot: 'bg-violet-400'  },
  'Design':          { gradient: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  border: 'border-fuchsia-700/30',  shadow: 'shadow-[0_0_6px_rgba(217,70,239,0.15)]',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  'Permitting':      { gradient: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      border: 'border-amber-700/30',    shadow: 'shadow-[0_0_6px_rgba(245,158,11,0.15)]',  text: 'text-amber-300',   dot: 'bg-amber-400'   },
  'Pending Install': { gradient: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    border: 'border-orange-700/30',   shadow: 'shadow-[0_0_6px_rgba(249,115,22,0.15)]',  text: 'text-orange-300',  dot: 'bg-orange-400'  },
  'Installed':       { gradient: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        border: 'border-teal-700/30',     shadow: 'shadow-[0_0_6px_rgba(20,184,166,0.15)]',  text: 'text-teal-300',    dot: 'bg-teal-400'    },
  'PTO':             { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  border: 'border-emerald-700/30',  shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]',  text: 'text-emerald-300', dot: 'bg-emerald-400' },
  'Cancelled':       { gradient: 'bg-gradient-to-r from-red-900/40 to-red-800/20',          border: 'border-red-700/30',      shadow: 'shadow-[0_0_6px_rgba(239,68,68,0.15)]',   text: 'text-red-300',     dot: 'bg-red-400'     },
  'On Hold':         { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',    border: 'border-yellow-700/30',   shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',   text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
};

export function PhaseBadge({ phase }: { phase: string }) {
  const s = PHASE_PILL[phase] ?? { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-[var(--border)]/30', shadow: '', text: 'text-[var(--text-secondary)]', dot: 'bg-[var(--text-muted)]' };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {phase}
    </span>
  );
}

export function StatusDot({ paid, amount }: { paid: boolean; amount: number }) {
  if (amount === 0) return <span className="text-[var(--text-dim)] text-xs">—</span>;
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
      paid ? 'bg-emerald-900/50 text-[var(--accent-emerald-solid)]' : 'bg-yellow-900/50 text-yellow-400'
    }`}>
      {paid ? fmt$(amount) : 'Unpaid'}
    </span>
  );
}

export function MilestoneDot({ label, paid, amount }: { label: string; paid: boolean; amount: number }) {
  if (amount === 0) return <span className="text-[var(--text-dim)]">{label}</span>;
  const color = paid ? 'text-[var(--accent-emerald-solid)]' : 'text-yellow-400';
  const dotColor = paid ? 'bg-emerald-400' : 'bg-yellow-400';
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className={color}>{label} ${amount.toLocaleString()}</span>
    </span>
  );
}

// ─── Main Dashboard Page ─────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentRepName, projects, payrollEntries, incentives, reps, trainerAssignments, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions, solarTechProducts, effectiveRole, effectiveRepId, effectiveRepName, installerPayConfigs, dbReady } = useApp();
  useEffect(() => { document.title = 'Dashboard | Kilo Energy'; }, []);
  const [period, setPeriod] = useState<Period>('all');
  const periodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [periodIndicator, setPeriodIndicator] = useState<{ left: number; width: number } | null>(null);
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Scroll-triggered reveal refs for below-fold dashboard sections
  const [statsRef, statsVisible] = useScrollReveal<HTMLDivElement>();
  const [pipelineRef, pipelineVisible] = useScrollReveal<HTMLDivElement>();
  const [incentivesRef, incentivesVisible] = useScrollReveal<HTMLDivElement>();

  // Keyboard shortcuts (N/P/E/D) handled globally in layout.tsx

  const periodProjects = useMemo(
    () => projects.filter((p) => isInPeriod(p.soldDate, period)),
    [projects, period],
  );
  const periodPayroll = useMemo(
    () => payrollEntries.filter((p) => isInPeriod(p.date, period)),
    [payrollEntries, period],
  );

  const myProjects =
    effectiveRole === 'admin'
      ? periodProjects
      : periodProjects.filter(
          (p) =>
            p.repId === effectiveRepId ||
            p.setterId === effectiveRepId ||
            p.trainerId === effectiveRepId ||
            (p.additionalClosers ?? []).some((c) => c.userId === effectiveRepId) ||
            (p.additionalSetters ?? []).some((s) => s.userId === effectiveRepId),
        );

  const myPayroll =
    effectiveRole === 'admin'
      ? periodPayroll
      : periodPayroll.filter((p) => p.repId === effectiveRepId);

  // ── Previous-period data (used for trend badges on stat cards) ──────────────
  // Only 'this-month' and 'this-year' have a well-defined predecessor.
  const hasPreviousPeriod = period === 'this-month' || period === 'this-year';

  const prevPeriodProjects = hasPreviousPeriod
    ? projects.filter((p) => isInPreviousPeriod(p.soldDate, period))
    : [];
  const prevPeriodPayroll = hasPreviousPeriod
    ? payrollEntries.filter((p) => isInPreviousPeriod(p.date, period))
    : [];

  const myPrevProjects = hasPreviousPeriod
    ? (effectiveRole === 'admin'
        ? prevPeriodProjects
        : prevPeriodProjects.filter(
            (p) =>
              p.repId === effectiveRepId ||
              p.setterId === effectiveRepId ||
              p.trainerId === effectiveRepId ||
              (p.additionalClosers ?? []).some((c) => c.userId === effectiveRepId) ||
              (p.additionalSetters ?? []).some((s) => s.userId === effectiveRepId),
          ))
    : [];
  const myPrevPayroll = hasPreviousPeriod
    ? (effectiveRole === 'admin'
        ? prevPeriodPayroll
        : prevPeriodPayroll.filter((p) => p.repId === effectiveRepId))
    : [];

  /**
   * Returns the percentage change between `current` and `prev`.
   * Returns `undefined` when the selected period has no predecessor (hide badge).
   * Returns `null` when the previous value was 0 (no data → neutral dash).
   */
  const computePctChange = (current: number, prev: number): number | null | undefined => {
    if (!hasPreviousPeriod) return undefined;
    if (prev === 0) return null;
    return ((current - prev) / prev) * 100;
  };

  const PERIODS = SHARED_PERIODS;

  // Measure the active period tab so the sliding pill can follow it
  useEffect(() => {
    const idx = PERIODS.findIndex(p => p.value === period);
    const el = periodTabRefs.current[idx];
    if (el) setPeriodIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period]);

  // Hoist MTD derivations above the isHydrated guard so that
  // useCountUp (a React hook) is always called unconditionally — hooks rules require
  // every hook to be called in the same order on every render.
  // Use all payroll entries (not period-filtered) so MTD unmatched detection is
  // correct regardless of which period tab is selected.
  const allMyPayroll = payrollEntries.filter((p) => p.repId === effectiveRepId);
  const allMyProjects = projects.filter(
    (p) =>
      p.repId === effectiveRepId ||
      p.setterId === effectiveRepId ||
      p.trainerId === effectiveRepId ||
      p.additionalClosers?.some((c) => c.userId === effectiveRepId) ||
      p.additionalSetters?.some((s) => s.userId === effectiveRepId),
  );
  const mtdProjects = projects.filter(
    (p) =>
      (p.repId === effectiveRepId ||
        p.setterId === effectiveRepId ||
        p.trainerId === effectiveRepId ||
        p.additionalClosers?.some((c) => c.userId === effectiveRepId) ||
        p.additionalSetters?.some((s) => s.userId === effectiveRepId)) &&
      isThisMonth(p.soldDate)
  );
  const mtdPayrollCommission = payrollEntries
    .filter((p) => p.repId === effectiveRepId && isThisMonth(p.date) && p.type === 'Deal' && p.paymentStage !== 'Trainer')
    .reduce((s, p) => s + p.amount, 0);
  // Build a per-project sum of ALL payroll entries so we subtract only what's already
  // accounted for, rather than skipping the entire project when only M1 has been drafted.
  const allMtdPayrollByProject = allMyPayroll.filter((p) => isThisMonth(p.date)).reduce((map, p) => {
    if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  // Net milestone amounts per project from actual payroll entries (which are reduced by trainer
  // deductions at creation time). Used below so totalExpected matches what will actually be paid.
  const payrollNetByProjectStage = allMyPayroll.reduce((map, e) => {
    if (e.projectId && (e.paymentStage === 'M1' || e.paymentStage === 'M2' || e.paymentStage === 'M3')) {
      const key = `${e.projectId}:${e.paymentStage}`;
      map.set(key, (map.get(key) ?? 0) + e.amount);
    }
    return map;
  }, new Map<string, number>());
  const mtdUnmatchedCommission = mtdProjects
    .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((s, p) => {
      const closerM1 = payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.m1Amount ?? 0);
      const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterParty = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
      const totalExpected = p.repId === effectiveRepId
        ? closerM1 + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.m2Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.m3Amount ?? 0))
        : p.setterId === effectiveRepId
        ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.setterM1Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.setterM2Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.setterM3Amount ?? 0))
        : coCloserParty
        ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coCloserParty.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coCloserParty.m2Amount) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (coCloserParty.m3Amount ?? 0))
        : coSetterParty
        ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coSetterParty.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coSetterParty.m2Amount) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (coSetterParty.m3Amount ?? 0))
        : 0;
      return s + Math.max(0, totalExpected - (allMtdPayrollByProject.get(p.id) ?? 0));
    }, 0);
  const _mtdCommission = mtdPayrollCommission + mtdUnmatchedCommission;


  // Fetch @mentions for Needs Attention section (reps + sub-dealers)
  const [dashMentions, setDashMentions] = useState<MentionItem[]>([]);
  const fetchMentions = useCallback(() => {
    if (!effectiveRepId) return;
    fetch(`/api/mentions?userId=${encodeURIComponent(effectiveRepId)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then((rawMentions: unknown[]) => {
        // Transform Prisma shape → MentionItem shape. The API response is
        // internally-typed Prisma output; we narrow field-by-field here.
        const items: MentionItem[] = (rawMentions ?? []).map((raw) => {
        const m = raw as {
          id: string;
          messageId?: string;
          message?: {
            id?: string;
            projectId?: string;
            project?: { customerName?: string };
            text?: string;
            authorName?: string;
            checkItems?: Array<{ id: string; text: string; completed: boolean }>;
          };
        };
        return ({
          id: m.id,
          projectId: m.message?.projectId ?? '',
          projectCustomerName: m.message?.project?.customerName ?? 'Unknown',
          messageId: m.messageId ?? m.message?.id ?? '',
          messageSnippet: (m.message?.text ?? '').slice(0, 120),
          authorName: m.message?.authorName ?? 'Unknown',
          checkItems: (m.message?.checkItems ?? []).map((ci) => ({
            id: ci.id,
            text: ci.text,
            completed: ci.completed,
            dueDate: (ci as { dueDate?: string | null }).dueDate ?? null,
          })),
          createdAt: (m.message as { createdAt?: string } | undefined)?.createdAt ?? new Date().toISOString(),
          read: (raw as { readAt?: string | null }).readAt != null,
        });
        });
        setDashMentions(items);
      })
      .catch(() => setDashMentions([]));
  }, [effectiveRepId]);
  useEffect(() => { fetchMentions(); }, [fetchMentions]);

  if (!isHydrated || !dbReady) {
    return <DashboardSkeleton />;
  }

  if (isMobile) return <MobileDashboard />;

  if (effectiveRole === 'project_manager') {
    return <PMDashboard projects={periodProjects} allProjects={projects} period={period} setPeriod={setPeriod} PERIODS={PERIODS} totalReps={reps.filter(r => r.active !== false).length} />;
  }

  if (effectiveRole === 'admin') {
    return <AdminDashboard
      projects={periodProjects}
      allProjects={projects}
      payroll={periodPayroll}
      allPayroll={payrollEntries}
      period={period}
      setPeriod={setPeriod}
      PERIODS={PERIODS}
      totalReps={reps.filter(r => r.active !== false).length}
      installerPricingVersions={installerPricingVersions}
      productCatalogProducts={productCatalogProducts}
      productCatalogPricingVersions={productCatalogPricingVersions}
      solarTechProducts={solarTechProducts}
      currentRepName={currentRepName}
      mentions={dashMentions}
      onToggleTask={(projectId, messageId, checkItemId, completed) => {
        return fetch(`/api/projects/${projectId}/messages/${messageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkItemId, completed, completedBy: effectiveRepId }),
        }).then((res) => {
          if (!res.ok) throw new Error('Failed to update task');
          setDashMentions((prev) =>
            prev.map((m) =>
              m.messageId === messageId
                ? { ...m, checkItems: m.checkItems.map((ci) => ci.id === checkItemId ? { ...ci, completed } : ci) }
                : m
            )
          );
        });
      }}
    />;
  }

  if (effectiveRole === 'sub-dealer') {
    return <SubDealerDashboard
      projects={periodProjects}
      allProjects={projects}
      payroll={periodPayroll}
      mentions={dashMentions}
      setMentions={setDashMentions}
      period={period}
      setPeriod={setPeriod}
      PERIODS={PERIODS}
      currentRepId={effectiveRepId}
      currentRepName={effectiveRepName}
    />;
  }

  // Rep dashboard
  // Use unfiltered projects so prior-period deals still in-flight show up in PipelineOverview
  const activeProjects = projects
    .filter((p) =>
      p.repId === effectiveRepId ||
      p.setterId === effectiveRepId ||
      p.trainerId === effectiveRepId ||
      p.additionalClosers?.some((c) => c.userId === effectiveRepId) ||
      p.additionalSetters?.some((s) => s.userId === effectiveRepId)
    )
    .filter((p) => ACTIVE_PHASES.includes(p.phase));

  // ── Financial stats (project-based to account for milestone-triggered payroll) ──
  const todayStr = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();
  const paidPayrollByProject = allMyPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr && p.paymentStage !== 'Trainer').reduce((map, p) => {
    if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  const paidTrainerPayrollByProject = allMyPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr && p.paymentStage === 'Trainer').reduce((map, p) => {
    if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());

  // "In Pipeline" = expected commission from active projects minus what's actually been disbursed
  const inPipeline = activeProjects.reduce((sum, p) => {
    const closerM1 = payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.m1Amount ?? 0);
    // Use net payroll amounts when entries exist (they are net of trainer deductions).
    // Fall back to gross project amounts only for stages not yet triggered.
    const closerM2Net = payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.m2Amount ?? 0);
    const closerM3Net = payrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.m3Amount ?? 0);
    const coCloserParty = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
    const coSetterParty = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
    const totalExpected = p.repId === effectiveRepId
      ? closerM1 + closerM2Net + closerM3Net
      : p.setterId === effectiveRepId
        ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.setterM1Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.setterM2Amount ?? 0)) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.setterM3Amount ?? 0))
        : coCloserParty
          ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coCloserParty.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coCloserParty.m2Amount) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (coCloserParty.m3Amount ?? 0))
          : coSetterParty
            ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coSetterParty.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coSetterParty.m2Amount) + (payrollNetByProjectStage.get(`${p.id}:M3`) ?? (coSetterParty.m3Amount ?? 0))
            : 0;
    const alreadyPaid = paidPayrollByProject.get(p.id) ?? 0;
    return sum + Math.max(0, totalExpected - alreadyPaid);
  }, 0) + trainerAssignments.filter(a => a.trainerId === effectiveRepId).reduce((sum, assignment) => {
    const isTraineeParty = (p: typeof projects[number]) =>
      p.repId === assignment.traineeId ||
      p.setterId === assignment.traineeId ||
      p.additionalClosers?.some(c => c.userId === assignment.traineeId) ||
      p.additionalSetters?.some(s => s.userId === assignment.traineeId);
    const completedDeals = projects.filter(p =>
      isTraineeParty(p) &&
      ((installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)
    ).length;
    const overrideRate = getTrainerOverrideRate(assignment, completedDeals);
    return sum + projects
      .filter(p => ACTIVE_PHASES.includes(p.phase) && isTraineeParty(p))
      .reduce((pSum, p) => {
        const expected = Math.round(overrideRate * p.kWSize * 1000 * 100) / 100;
        const alreadyPaid = paidTrainerPayrollByProject.get(p.id) ?? 0;
        return pSum + Math.max(0, expected - alreadyPaid);
      }, 0);
  }, 0);

  // "Total Estimated Pay" = unpaid payroll + expected amounts from projects not yet in payroll
  const unpaidPayroll = allMyPayroll.filter((p) => p.status !== 'Paid').reduce((sum, p) => sum + p.amount, 0);
  // Build a per-project total of ALL payroll entries (any status) so we can subtract
  // what's already accounted for rather than skipping the whole project.
  // This prevents a project with only M1 drafted from losing its expected M2.
  const allPayrollByProject = allMyPayroll.reduce((map, p) => {
    if (p.projectId && p.paymentStage !== 'M3') map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  const unmatchedProjectPay = activeProjects
    .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((sum, p) => {
      const closerM1 = payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.m1Amount ?? 0);
      const closerM2Net = payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.m2Amount ?? 0);
      const setterM2Net = payrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.setterM2Amount ?? 0);
      const coCloserParty2 = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterParty2 = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
      const totalExpected = p.repId === effectiveRepId
        ? closerM1 + closerM2Net
        : p.setterId === effectiveRepId
          ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.setterM1Amount ?? 0)) + setterM2Net
          : coCloserParty2
            ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coCloserParty2.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coCloserParty2.m2Amount)
            : coSetterParty2
              ? (payrollNetByProjectStage.get(`${p.id}:M1`) ?? coSetterParty2.m1Amount) + (payrollNetByProjectStage.get(`${p.id}:M2`) ?? coSetterParty2.m2Amount)
              : 0;
      return sum + Math.max(0, totalExpected - (allPayrollByProject.get(p.id) ?? 0));
    }, 0);
  // M3: build a set of project IDs that already have an M3 payroll entry (paid or unpaid).
  // If unpaid, the amount is already in unpaidPayroll. If paid, it belongs in totalPaid.
  // Only add m3Amount for projects with no M3 entry yet, regardless of phase.
  const m3PayrollProjectIds = new Set(allMyPayroll.filter((p) => p.paymentStage === 'M3').map((p) => p.projectId).filter(Boolean));
  const pendingM3Pay = activeProjects
    .filter((p) => !m3PayrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && ((p.m3Amount ?? 0) > 0 || (p.setterM3Amount ?? 0) > 0))
    .reduce((sum, p) => {
      const coCloserParty3 = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterParty3 = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
      const m3 = p.repId === effectiveRepId
        ? (p.m3Amount ?? 0)
        : p.setterId === effectiveRepId
          ? (p.setterM3Amount ?? 0)
          : coCloserParty3
            ? (coCloserParty3.m3Amount ?? 0)
            : coSetterParty3
              ? (coSetterParty3.m3Amount ?? 0)
              : 0;
      return sum + m3;
    }, 0);
  const _totalEstimatedPay = unpaidPayroll + unmatchedProjectPay + pendingM3Pay;

  // Canonical net paid-out (incl. chargebacks; excludes future-dated).
  // Matches payroll-tab combined total + mobile dashboard.
  const totalPaid = sumPaid(myPayroll, { asOf: todayStr });
  // Chargebacks tile shows ONLY currently-owed negatives — entries still
  // Draft or Pending. Paid negatives have already been deducted from a
  // past paycheck and aren't owed anymore; including them would double-
  // count the historical claw-back.
  // No asOf: future-dated pending chargebacks are still "yet to be
  // charged" and must surface on the tile.
  const totalChargebacks = Math.abs(sumPendingChargebacks(myPayroll));
  const chargebackCount = countPendingChargebacks(myPayroll);
  const _totalKW = activeProjects.reduce((sum, p) => sum + p.kWSize, 0);
  const installedPhases = ['Installed', 'PTO', 'Completed'];
  const totalKWSold = myProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((sum, p) => sum + p.kWSize, 0);
  const totalKWInstalled = myProjects.filter((p) => installedPhases.includes(p.phase)).reduce((sum, p) => sum + p.kWSize, 0);

  // ── Previous-period equivalents for trend-badge percentage changes ──────────
  const prevActiveProjects = myPrevProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  const prevPaidByProject = myPrevPayroll.filter((p) => p.status === 'Paid').reduce((map, p) => {
    if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  // Net milestone amounts per project from prev-period payroll entries (mirrors payrollNetByProjectStage).
  const prevPayrollNetByProjectStage = myPrevPayroll.reduce((map, e) => {
    if (e.projectId && (e.paymentStage === 'M1' || e.paymentStage === 'M2' || e.paymentStage === 'M3')) {
      const key = `${e.projectId}:${e.paymentStage}`;
      map.set(key, (map.get(key) ?? 0) + e.amount);
    }
    return map;
  }, new Map<string, number>());
  const prevInPipeline = prevActiveProjects.reduce((sum, p) => {
    const closerM1 = prevPayrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.m1Amount ?? 0);
    const coCloserPartyPrev = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
    const coSetterPartyPrev = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
    const totalExpected = p.repId === effectiveRepId
      ? closerM1 + (prevPayrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.m2Amount ?? 0)) + (prevPayrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.m3Amount ?? 0))
      : p.setterId === effectiveRepId
        ? (prevPayrollNetByProjectStage.get(`${p.id}:M1`) ?? (p.setterM1Amount ?? 0)) + (prevPayrollNetByProjectStage.get(`${p.id}:M2`) ?? (p.setterM2Amount ?? 0)) + (prevPayrollNetByProjectStage.get(`${p.id}:M3`) ?? (p.setterM3Amount ?? 0))
        : coCloserPartyPrev
          ? (prevPayrollNetByProjectStage.get(`${p.id}:M1`) ?? coCloserPartyPrev.m1Amount) + (prevPayrollNetByProjectStage.get(`${p.id}:M2`) ?? coCloserPartyPrev.m2Amount) + (prevPayrollNetByProjectStage.get(`${p.id}:M3`) ?? (coCloserPartyPrev.m3Amount ?? 0))
          : coSetterPartyPrev
            ? (prevPayrollNetByProjectStage.get(`${p.id}:M1`) ?? coSetterPartyPrev.m1Amount) + (prevPayrollNetByProjectStage.get(`${p.id}:M2`) ?? coSetterPartyPrev.m2Amount) + (prevPayrollNetByProjectStage.get(`${p.id}:M3`) ?? (coSetterPartyPrev.m3Amount ?? 0))
            : 0;
    const alreadyPaid = prevPaidByProject.get(p.id) ?? 0;
    return sum + Math.max(0, totalExpected - alreadyPaid);
  }, 0) + trainerAssignments.filter(a => a.trainerId === effectiveRepId).reduce((sum, assignment) => {
    const completedDeals = projects.filter(p =>
      (p.repId === assignment.traineeId || p.setterId === assignment.traineeId) &&
      ((installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)
    ).length;
    const overrideRate = getTrainerOverrideRate(assignment, completedDeals);
    return sum + prevPeriodProjects
      .filter(p => ACTIVE_PHASES.includes(p.phase) && (p.repId === assignment.traineeId || p.setterId === assignment.traineeId))
      .reduce((pSum, p) => {
        const expected = Math.round(overrideRate * p.kWSize * 1000 * 100) / 100;
        const alreadyPaid = prevPaidByProject.get(p.id) ?? 0;
        return pSum + Math.max(0, expected - alreadyPaid);
      }, 0);
  }, 0);
  const prevAllPayrollByProject = myPrevPayroll.reduce((map, p) => {
    if (p.projectId && p.paymentStage !== 'M3') map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  const prevUnpaidPayroll = myPrevPayroll.filter((p) => p.status !== 'Paid').reduce((sum, p) => sum + p.amount, 0);
  const prevUnmatchedPay = myPrevProjects
    .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((sum, p) => {
      const closerM1 = p.m1Amount ?? 0;
      const coCloserPartyPU = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterPartyPU = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
      const totalExpected = p.repId === effectiveRepId
        ? closerM1 + (p.m2Amount ?? 0)
        : p.setterId === effectiveRepId
          ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0)
          : coCloserPartyPU
            ? coCloserPartyPU.m1Amount + coCloserPartyPU.m2Amount
            : coSetterPartyPU
              ? coSetterPartyPU.m1Amount + coSetterPartyPU.m2Amount
              : 0;
      return sum + Math.max(0, totalExpected - (prevAllPayrollByProject.get(p.id) ?? 0));
    }, 0);
  const prevM3PayrollProjectIds = new Set(myPrevPayroll.filter((p) => p.paymentStage === 'M3').map((p) => p.projectId).filter(Boolean));
  const prevPendingM3Pay = myPrevProjects
    .filter((p) => !prevM3PayrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && ((p.m3Amount ?? 0) > 0 || (p.setterM3Amount ?? 0) > 0))
    .reduce((sum, p) => {
      const coCloserPartyPM3 = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
      const coSetterPartyPM3 = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
      const m3 = p.repId === effectiveRepId
        ? (p.m3Amount ?? 0)
        : p.setterId === effectiveRepId
          ? (p.setterM3Amount ?? 0)
          : coCloserPartyPM3
            ? (coCloserPartyPM3.m3Amount ?? 0)
            : coSetterPartyPM3
              ? (coSetterPartyPM3.m3Amount ?? 0)
              : 0;
      return sum + m3;
    }, 0);
  const _prevTotalEstimatedPay = prevUnpaidPayroll + prevUnmatchedPay + prevPendingM3Pay;
  const prevTotalPaid = sumPaid(myPrevPayroll, { asOf: todayStr });
  const _prevTotalKW = prevActiveProjects.reduce((sum, p) => sum + p.kWSize, 0);
  const prevTotalKWSold = myPrevProjects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((sum, p) => sum + p.kWSize, 0);
  const prevTotalKWInstalled = myPrevProjects.filter((p) => installedPhases.includes(p.phase)).reduce((sum, p) => sum + p.kWSize, 0);

  // Sparkline data for the five stat cards — last 7 unique dates, summed per day
  const pipelineSparkData   = computeSparklineData(activeProjects.map((p) => {
    const closerM1 = p.m1Amount ?? 0;
    const coCloserPartySpark = p.additionalClosers?.find((c) => c.userId === effectiveRepId);
    const coSetterPartySpark = p.additionalSetters?.find((s) => s.userId === effectiveRepId);
    const amount = p.repId === effectiveRepId
      ? closerM1 + (p.m2Amount ?? 0) + (p.m3Amount ?? 0)
      : p.setterId === effectiveRepId
        ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0)
        : coCloserPartySpark
          ? coCloserPartySpark.m1Amount + coCloserPartySpark.m2Amount + (coCloserPartySpark.m3Amount ?? 0)
          : coSetterPartySpark
            ? coSetterPartySpark.m1Amount + coSetterPartySpark.m2Amount + (coSetterPartySpark.m3Amount ?? 0)
            : 0;
    return { date: p.soldDate, amount };
  }));
  const chargebackSparkData: number[] = []; // flat / empty — no chargeback data yet
  const _estPaySparkData     = computeSparklineData(myPayroll.filter((p) => p.status !== 'Paid').map((p) => ({ date: p.date, amount: p.amount })));
  const paidSparkData       = computeSparklineData(myPayroll.filter((p) => p.status === 'Paid').map((p) => ({ date: p.date, amount: p.amount })));
  const systemSizeSparkData = computeSparklineData(activeProjects.map((p) => ({ date: p.soldDate, amount: p.kWSize })));
  const installedSparkData = computeSparklineData(myProjects.filter((p) => installedPhases.includes(p.phase)).map((p) => ({ date: p.soldDate, amount: p.kWSize })));

  const thisWeekPayroll = payrollEntries.filter(
    (p) => p.repId === effectiveRepId && isThisWeek(p.date) && p.status === 'Pending'
  );
  const thisWeekTotal = thisWeekPayroll.reduce((s, p) => s + p.amount, 0);

  // MTD deal count + kW — derived from mtdProjects, which is hoisted above the isHydrated guard
  const _mtdDeals = mtdProjects.length;
  const _mtdKW = mtdProjects.reduce((s, p) => s + p.kWSize, 0);


  // Next Payout: Pending entries dated for the upcoming Friday (matches Earnings page).
  const nextFridayDate = (() => {
    const today = new Date();
    const d = (5 - today.getDay() + 7) % 7;
    const nf = new Date(today);
    nf.setDate(today.getDate() + d);
    const yyyy = nf.getFullYear();
    const mm = String(nf.getMonth() + 1).padStart(2, '0');
    const dd = String(nf.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();
  const pendingPayrollTotal = payrollEntries
    .filter((p) => p.repId === effectiveRepId && p.date === nextFridayDate && p.status === 'Pending')
    .reduce((sum, p) => sum + p.amount, 0);

  // Calculate days until next payday (Friday). Returns 0 if today is Friday.
  const daysUntilPayday = (() => {
    const today = new Date();
    return (5 - today.getDay() + 7) % 7;
  })();
  const nextFridayLabel = (() => {
    const today = new Date();
    const nextFriday = new Date(today);
    nextFriday.setDate(today.getDate() + daysUntilPayday);
    return nextFriday.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();
  const paydayCountdownLabel = daysUntilPayday === 0 ? 'Today' : daysUntilPayday === 1 ? 'Tomorrow' : `in ${daysUntilPayday} days`;

  // Incentives for this rep
  const myIncentives = incentives.filter(
    (i) => i.active && (i.type === 'company' || (i.type === 'personal' && i.targetRepId === effectiveRepId))
  );

  const stats = [
    {
      label: 'Total Paid',
      value: fmt$(totalPaid),
      sub: 'Deposited to you',
      icon: CheckCircle,
      color: 'text-[var(--accent-emerald-solid)]',
      accentGradient: 'from-emerald-500 to-emerald-400',
      glowClass: 'stat-glow-emerald',
      sparkData: paidSparkData,
      sparkStroke: 'var(--accent-emerald-solid)',
      pctChange: computePctChange(totalPaid, prevTotalPaid),
      href: '/dashboard/my-pay',
      tooltip: 'Total commission disbursed to you across all payment stages',
    },
    {
      label: 'In Pipeline',
      value: fmt$(inPipeline),
      sub: `${activeProjects.length} active projects`,
      icon: TrendingUp,
      color: 'text-[var(--accent-emerald-solid)]',
      accentGradient: 'from-blue-500 to-blue-400',
      glowClass: 'stat-glow-blue',
      sparkData: pipelineSparkData,
      sparkStroke: 'var(--accent-cyan-solid)',
      pctChange: computePctChange(inPipeline, prevInPipeline),
      href: '/dashboard/projects',
      tooltip: 'Expected commission from active projects minus amounts already paid',
    },
    {
      label: 'kW Sold',
      value: formatCompactKW(totalKWSold),
      sub: `${myProjects.length} projects this period`,
      icon: Zap,
      color: 'text-yellow-400',
      accentGradient: 'from-yellow-500 to-yellow-400',
      glowClass: 'stat-glow-yellow',
      sparkData: systemSizeSparkData,
      sparkStroke: '#eab308',
      pctChange: computePctChange(totalKWSold, prevTotalKWSold),
      href: '/dashboard/projects',
      tooltip: 'Total system size in kilowatts from all active deals',
    },
    {
      label: 'kW Installed',
      value: `${totalKWInstalled.toFixed(1)} kW`,
      sub: `${myProjects.filter((p) => installedPhases.includes(p.phase)).length} installed`,
      icon: Zap,
      color: 'text-[var(--accent-emerald-solid)]',
      accentGradient: 'from-emerald-500 to-emerald-400',
      glowClass: 'stat-glow-emerald',
      sparkData: installedSparkData,
      sparkStroke: 'var(--accent-emerald-solid)',
      pctChange: computePctChange(totalKWInstalled, prevTotalKWInstalled),
      href: '/dashboard/projects',
      tooltip: 'Total kilowatts from projects that have been physically installed',
    },
    // Chargebacks tile only renders when there are actually outstanding
    // (Draft + Pending negative) entries. A rep with no chargebacks
    // doesn't need a permanent "$0 / No chargebacks" clutter tile —
    // matches the mobile dashboard's conditional-stat-card approach.
    ...(chargebackCount > 0 ? [{
      label: 'Chargebacks',
      value: fmt$(totalChargebacks),
      sub: `${chargebackCount} chargeback${chargebackCount === 1 ? '' : 's'}`,
      icon: AlertCircle,
      color: 'text-red-400',
      accentGradient: 'from-red-500 to-red-400',
      glowClass: 'stat-glow-red',
      sparkData: chargebackSparkData,
      sparkStroke: 'var(--accent-red-solid)',
      pctChange: undefined as number | null | undefined,
      href: '/dashboard/my-pay#pending-chargebacks',
      tooltip: 'Chargebacks still pending — click to see which deals.',
    }] : []),
  ];

  return (
    <div className="px-3 pt-2 pb-4 md:p-8 animate-fade-in-up">

      {/* ── Welcome Banner with Glow CTA ─────────────────────────────────── */}
      <div className="card-surface rounded-xl md:rounded-2xl mb-6">
        <div className="px-6 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <p className="text-[var(--text-secondary)] text-sm font-medium tracking-wide mb-1">{getGreeting(effectiveRepName)}</p>
            <p className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em' }}>
              <span style={{ color: 'var(--text-primary)' }}>Next Payout:</span> <span style={{ color: 'var(--accent-emerald-solid)' }}>${pendingPayrollTotal.toLocaleString()}</span>
            </p>
            <p className="text-[var(--text-muted)] text-xs mt-1 flex items-center gap-2">
              {nextFridayLabel}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${daysUntilPayday <= 2 ? 'bg-[var(--accent-emerald-solid)]/15 text-[var(--accent-emerald-solid)] border border-[var(--accent-emerald-solid)]/20' : 'bg-[var(--border)]/50 text-[var(--text-secondary)] border border-[var(--border)]/30'}`}>
                {paydayCountdownLabel}
              </span>
            </p>
          </div>

          <div className="relative inline-flex shrink-0">
            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 opacity-[0.06] blur-[2px] animate-pulse" />
            <Link
              href="/dashboard/new-deal"
              className="relative inline-flex items-center gap-2.5 btn-primary text-black font-bold px-6 py-3 min-h-[48px] rounded-2xl text-sm"
            >
              <PlusCircle className="w-5 h-5" />
              Submit a Deal
            </Link>
          </div>
        </div>
      </div>

      {/* Period tabs — compact row, flush right */}
      <div className="flex justify-end mb-6 overflow-x-auto">
        <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 tab-bar-container">
          {periodIndicator && <div className="tab-indicator" style={periodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { periodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors active:scale-[0.97] ${
                period === p.value
                  ? 'text-white'
                  : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Next Payout shown in welcome banner above — no duplicate needed */}

      {/* MTD ring charts removed — financial detail lives in My Pay */}

      {/* ── Zero-project onboarding hero ─────────────────────────────────── */}
      {allMyProjects.length === 0 && (
        <div className="card-surface rounded-2xl p-8 mb-6 flex flex-col items-center text-center gap-6">
          {/* Inline SVG — solar panel with a plus badge */}
          <div className="flex-shrink-0">
            <svg
              width="60" height="60" viewBox="0 0 60 60" fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Panel body */}
              <rect x="4" y="14" width="52" height="32" rx="3" fill="var(--surface-card)" stroke="var(--border-strong)" strokeWidth="1.5" />
              {/* Grid lines — horizontal */}
              <line x1="4" y1="25" x2="56" y2="25" stroke="var(--border-strong)" strokeWidth="1" />
              <line x1="4" y1="36" x2="56" y2="36" stroke="var(--border-strong)" strokeWidth="1" />
              {/* Grid lines — vertical */}
              <line x1="21" y1="14" x2="21" y2="46" stroke="var(--border-strong)" strokeWidth="1" />
              <line x1="38" y1="14" x2="38" y2="46" stroke="var(--border-strong)" strokeWidth="1" />
              {/* Cell shimmer fills */}
              <rect x="5" y="15" width="15" height="10" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="22" y="15" width="15" height="10" rx="1" fill="var(--accent-emerald-solid)" fillOpacity="0.5" />
              <rect x="39" y="15" width="16" height="10" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="5" y="26" width="15" height="10" rx="1" fill="var(--accent-emerald-solid)" fillOpacity="0.5" />
              <rect x="22" y="26" width="15" height="10" rx="1" fill="var(--accent-cyan-solid)" fillOpacity="0.45" />
              <rect x="39" y="26" width="16" height="10" rx="1" fill="var(--accent-emerald-solid)" fillOpacity="0.5" />
              <rect x="5" y="37" width="15" height="8" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="22" y="37" width="15" height="8" rx="1" fill="var(--accent-emerald-solid)" fillOpacity="0.5" />
              <rect x="39" y="37" width="16" height="8" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              {/* Mount legs */}
              <line x1="20" y1="46" x2="16" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              <line x1="40" y1="46" x2="44" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              <line x1="13" y1="55" x2="47" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              {/* Plus badge — top-right corner */}
              <circle cx="49" cy="15" r="9" fill="#0f172a" />
              <circle cx="49" cy="15" r="8" fill="var(--accent-emerald-solid)" />
              <line x1="49" y1="10" x2="49" y2="20" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="44" y1="15" x2="54" y2="15" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          <div className="space-y-2 max-w-sm">
            <h2 className="text-2xl font-black text-white tracking-tight">Submit your first deal</h2>
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
              Once you close a deal, your pipeline, commissions, and earnings will appear here.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              href="/dashboard/new-deal"
              className="btn-primary inline-flex items-center gap-2 text-black font-semibold px-6 py-3 min-h-[48px] rounded-xl text-sm whitespace-nowrap"
            >
              <PlusCircle className="w-4 h-4" />
              Submit Your First Deal
            </Link>
            <Link
              href="/dashboard/calculator"
              className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-secondary)] text-sm font-medium transition-colors"
            >
              Explore the calculator →
            </Link>
          </div>
        </div>
      )}

      {/* Stats grid — only shown once at least one deal exists */}
      {allMyProjects.length > 0 && (
        <>
          <div
            ref={statsRef}
            className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 md:gap-4 mb-6 pb-20 md:pb-0 ${statsVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
          >
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <Link key={stat.label} href={stat.href} className={`group card-surface card-surface-stat rounded-2xl p-4 md:p-5 h-full cursor-pointer hover:border-[var(--accent-emerald-solid)]/30 hover:scale-[1.02] transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': ACCENT_COLOR_MAP[stat.accentGradient] ?? 'transparent' } as CSSProperties}>
                  <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${stat.accentGradient}`} />
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                      {stat.label}
                      {'tooltip' in stat && stat.tooltip && (
                        <span className="relative group/tip">
                          <HelpCircle className="w-3 h-3 text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors cursor-help" />
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover/tip:block whitespace-normal w-48 rounded-lg bg-[var(--surface-card)] border border-[var(--border)]/60 px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-[var(--text-secondary)] shadow-xl leading-snug">
                            {stat.tooltip}
                          </span>
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <Icon className={`w-4 h-4 ${stat.color}`} />
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <p className={`stat-value stat-value-glow ${stat.glowClass} text-3xl font-black tabular-nums tracking-tight animate-count-up ${'gradient' in stat && stat.gradient ? stat.gradient : stat.color}`}>{stat.value}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-[var(--text-muted)] text-xs">{stat.sub}</p>
                    <TrendBadge pctChange={stat.pctChange} />
                  </div>
                  <Sparkline data={stat.sparkData} stroke={stat.sparkStroke} />
                </Link>
              );
            })}
          </div>

          {/* Needs Attention — intentionally uses unfiltered `projects` (not period-filtered)
             so that flagged/stuck items always remain visible regardless of the selected period */}
          <NeedsAttentionSection
            activeProjects={projects.filter(
              (p) =>
                (p.repId === effectiveRepId ||
                  p.setterId === effectiveRepId ||
                  p.trainerId === effectiveRepId ||
                  (p.additionalClosers ?? []).some((c) => c.userId === effectiveRepId) ||
                  (p.additionalSetters ?? []).some((s) => s.userId === effectiveRepId)) &&
                ((ACTIVE_PHASES.includes(p.phase) && p.phase !== 'Completed') || p.phase === 'On Hold')
            )}
          />

          {/* My Tasks — aggregated uncompleted check items from chatter mentions */}
          <MyTasksSection
            mentions={dashMentions}
            onToggleTask={(projectId, messageId, checkItemId, completed) => {
              return fetch(`/api/projects/${projectId}/messages/${messageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkItemId, completed, completedBy: effectiveRepId }),
              }).then((res) => {
                if (!res.ok) throw new Error('Failed to update task');
                // Update local state to reflect the completed status
                setDashMentions((prev) =>
                  prev.map((m) =>
                    m.messageId === messageId
                      ? {
                          ...m,
                          checkItems: m.checkItems.map((ci) =>
                            ci.id === checkItemId ? { ...ci, completed } : ci
                          ),
                        }
                      : m
                  )
                );
              });
            }}
          />

          {/* Pipeline Overview */}
          <div
            ref={pipelineRef}
            className={`card-surface rounded-2xl mb-6 ${pipelineVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
          >
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
                <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
                  <FolderKanban className="w-4 h-4 text-[var(--accent-emerald-solid)]" />
                </div>
                <h2 className="text-white font-bold tracking-tight text-base">Pipeline Overview</h2>
              </div>
              <Link href="/dashboard/projects" className="text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] text-xs transition-colors">
                View All →
              </Link>
            </div>
            <div className="divider-gradient-animated" />
            <div className="p-5">
              <PipelineOverview activeProjects={activeProjects} />
            </div>
          </div>
        </>
      )}

      {/* Keyboard shortcut hint bar — desktop only */}
      <div className="hidden md:flex items-center gap-6 bg-[var(--surface)]/60 border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 mb-6 select-none">
        {[
          { key: 'N', label: 'New Deal' },
          { key: 'P', label: 'Projects' },
          { key: 'E', label: 'My Pay' },
          { key: '⌘K', label: 'Search' },
        ].map(({ key, label }) => (
          <span key={key} className="inline-flex items-center gap-2">
            <kbd className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] text-xs px-1.5 py-0.5 rounded font-mono">
              {key}
            </kbd>
            <span className="text-[var(--text-muted)] text-xs">{label}</span>
          </span>
        ))}
      </div>

      {/* Incentives tracker */}
      {myIncentives.length > 0 && (
        <div
          ref={incentivesRef}
          className={`card-surface rounded-2xl mb-6 ${incentivesVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
        >
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
              <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
                <Target className="w-4 h-4 text-[var(--accent-emerald-solid)]" />
              </div>
              <h2 className="text-white font-bold tracking-tight text-base">Active Incentives</h2>
            </div>
            <Link href="/dashboard/incentives" className="text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] text-xs transition-colors">
              View All →
            </Link>
          </div>
          <div className="divider-gradient-animated" />
          <div className="p-4 space-y-3">
            {myIncentives.map((incentive) => {
              const progress = computeIncentiveProgress(incentive, projects, payrollEntries);
              const topMilestone = [...incentive.milestones].sort((a, b) => b.threshold - a.threshold)[0];
              const pct = topMilestone ? Math.min(100, (progress / topMilestone.threshold) * 100) : 0;
              const nextMilestone = incentive.milestones
                .filter((m) => !m.achieved && m.threshold > progress)
                .sort((a, b) => a.threshold - b.threshold)[0];
              return (
                <div key={incentive.id} className="bg-[var(--surface-card)]/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-medium">{incentive.title}</p>
                      {incentive.type === 'personal' && (
                        <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">Personal</span>
                      )}
                    </div>
                    <p className="text-[var(--accent-emerald-solid)] font-bold text-sm">{formatIncentiveMetric(incentive.metric, progress)}</p>
                  </div>
                  <div className="w-full bg-[var(--border)] rounded-full h-1.5 mb-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,var(--accent-emerald-solid),var(--accent-cyan-solid))',
                      }}
                    />
                  </div>
                  {nextMilestone && (
                    <p className="text-[var(--text-muted)] text-xs">
                      Next: {nextMilestone.reward} at {formatIncentiveMetric(incentive.metric, nextMilestone.threshold)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* This Week's Pay */}
      <div className="card-surface rounded-2xl mb-6">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" />
            <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
              <DollarSign className="w-4 h-4 text-[var(--accent-emerald-solid)]" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">This Week&apos;s Pay</h2>
          </div>
          <div className="flex items-center gap-3">
            {thisWeekTotal > 0 && (
              <span className="text-[var(--accent-emerald-solid)] font-bold">${thisWeekTotal.toLocaleString()}</span>
            )}
            <Link href="/dashboard/my-pay" className="text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] text-xs transition-colors">
              View All →
            </Link>
          </div>
        </div>
        <div className="divider-gradient-animated" />
        {thisWeekPayroll.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-[var(--border-subtle)] rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[var(--surface-card)]/80 flex items-center justify-center mx-auto mb-3">
                <DollarSign className="w-6 h-6 text-[var(--text-dim)] animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No payments this week</p>
              <p className="text-[var(--text-muted)] text-xs mb-4">Payments will appear here once marked for payroll.</p>
              <Link
                href="/dashboard/my-pay"
                className="btn-primary inline-flex items-center gap-2 text-black font-semibold px-5 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                View Pay History
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Customer</th>
                <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Stage</th>
                <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Amount</th>
                <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium text-xs">Date</th>
              </tr>
            </thead>
            <tbody>
              {thisWeekPayroll.map((entry) => (
                <tr key={entry.id} className="relative border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/[0.15] hover:bg-[var(--accent-emerald-solid)]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--accent-emerald-solid)] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                  <td className="px-6 py-3 text-[var(--text-secondary)]">{entry.customerName || '—'}</td>
                  <td className="px-6 py-3">
                    <span className="bg-[var(--border)] text-[var(--text-secondary)] text-xs px-2 py-0.5 rounded font-medium">
                      {entry.paymentStage}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[var(--accent-emerald-solid)] font-semibold">${entry.amount.toLocaleString()}</td>
                  <td className="px-6 py-3 text-[var(--text-muted)] text-xs">{entry.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Recent projects */}
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
            <div className="p-1.5 rounded-lg bg-[var(--accent-emerald-solid)]/15">
              <FolderKanban className="w-4 h-4 text-[var(--accent-emerald-solid)]" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">Recent Projects</h2>
          </div>
          <Link href="/dashboard/projects" className="text-[var(--accent-emerald-solid)] hover:text-[var(--accent-cyan-solid)] text-xs transition-colors">
            View All →
          </Link>
        </div>
        <div className="divider-gradient-animated" />
        {myProjects.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-[var(--border-subtle)] rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[var(--surface-card)]/80 flex items-center justify-center mx-auto mb-3">
                <FolderKanban className="w-6 h-6 text-[var(--text-dim)] animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No projects yet</p>
              <p className="text-[var(--text-muted)] text-xs mb-4">Submit your first deal to see it here</p>
              <Link
                href="/dashboard/new-deal"
                className="btn-primary inline-flex items-center gap-2 text-black font-semibold px-5 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                + New Deal
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {[...myProjects].sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? '')).slice(0, 8).map((proj) => {
              const m2DisplayAmount = proj.m2Amount ?? 0;
              const closerM1 = proj.m1Amount ?? 0;
              const setterM1Paid = payrollEntries.some(e => e.projectId === proj.id && e.repId === proj.setterId && e.paymentStage === 'M1' && e.status === 'Paid');
              const setterM2Paid = payrollEntries.some(e => e.projectId === proj.id && e.repId === proj.setterId && e.paymentStage === 'M2' && e.status === 'Paid');
              const setterM3Paid = payrollEntries.some(e => e.projectId === proj.id && e.repId === proj.setterId && e.paymentStage === 'M3' && e.status === 'Paid');
              const coCloserEntry = (proj.additionalClosers ?? []).find((c) => c.userId === effectiveRepId);
              const coSetterEntry = (proj.additionalSetters ?? []).find((s) => s.userId === effectiveRepId);
              const coPartyM1Paid = payrollEntries.some(e => e.projectId === proj.id && e.repId === effectiveRepId && e.paymentStage === 'M1' && e.status === 'Paid');
              const coPartyM2Paid = payrollEntries.some(e => e.projectId === proj.id && e.repId === effectiveRepId && e.paymentStage === 'M2' && e.status === 'Paid');
              const coPartyM3Paid = payrollEntries.some(e => e.projectId === proj.id && e.repId === effectiveRepId && e.paymentStage === 'M3' && e.status === 'Paid');
              const estPay = proj.repId === effectiveRepId
                ? closerM1 + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0)
                : proj.setterId === effectiveRepId
                  ? (proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0)
                  : coCloserEntry
                    ? coCloserEntry.m1Amount + coCloserEntry.m2Amount + (coCloserEntry.m3Amount ?? 0)
                    : coSetterEntry
                      ? coSetterEntry.m1Amount + coSetterEntry.m2Amount + (coSetterEntry.m3Amount ?? 0)
                      : 0;
              const soldLabel = (() => {
                if (!proj.soldDate) return '—';
                const [y, m, d] = proj.soldDate.split('-').map(Number);
                const sold = new Date(y, m - 1, d);
                const diff = Math.floor((Date.now() - sold.getTime()) / 86_400_000);
                if (diff < 1) return 'Today';
                if (diff === 1) return '1d ago';
                if (diff < 7) return `${diff}d ago`;
                if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
                return sold.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              })();
              return (
                <Link key={proj.id} href={`/dashboard/projects/${proj.id}`} className="block group">
                  <div className="px-5 py-3.5 hover:bg-[var(--accent-emerald-solid)]/[0.03] transition-colors">
                    {/* Row 1: Customer + Phase + Date */}
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-white font-medium text-sm truncate group-hover:text-[var(--accent-cyan-solid)] transition-colors">{proj.customerName}</span>
                        <PhaseBadge phase={proj.phase} />
                      </div>
                      <span className="text-[var(--text-muted)] text-xs whitespace-nowrap flex-shrink-0">{soldLabel}</span>
                    </div>
                    {/* Row 2: kW | Est Pay | Milestones */}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[var(--text-muted)]">{proj.kWSize} kW</span>
                      <span className="text-[var(--text-dim)]">·</span>
                      <span className="text-[var(--accent-emerald-solid)] font-semibold">${estPay.toLocaleString()}</span>
                      <div className="flex items-center gap-2.5 ml-auto">
                        {proj.setterId === effectiveRepId ? (
                          <>
                            <MilestoneDot label="M1" paid={setterM1Paid} amount={proj.setterM1Amount ?? 0} />
                            <MilestoneDot label="M2" paid={setterM2Paid} amount={proj.setterM2Amount ?? 0} />
                            {(proj.setterM3Amount ?? 0) > 0 && (
                              <MilestoneDot label="M3" paid={setterM3Paid} amount={proj.setterM3Amount ?? 0} />
                            )}
                          </>
                        ) : coCloserEntry ? (
                          <>
                            <MilestoneDot label="M1" paid={coPartyM1Paid} amount={coCloserEntry.m1Amount} />
                            <MilestoneDot label="M2" paid={coPartyM2Paid} amount={coCloserEntry.m2Amount} />
                            {(coCloserEntry.m3Amount ?? 0) > 0 && (
                              <MilestoneDot label="M3" paid={coPartyM3Paid} amount={coCloserEntry.m3Amount ?? 0} />
                            )}
                          </>
                        ) : coSetterEntry ? (
                          <>
                            <MilestoneDot label="M1" paid={coPartyM1Paid} amount={coSetterEntry.m1Amount} />
                            <MilestoneDot label="M2" paid={coPartyM2Paid} amount={coSetterEntry.m2Amount} />
                            {(coSetterEntry.m3Amount ?? 0) > 0 && (
                              <MilestoneDot label="M3" paid={coPartyM3Paid} amount={coSetterEntry.m3Amount ?? 0} />
                            )}
                          </>
                        ) : (
                          <>
                            <MilestoneDot label="M1" paid={proj.m1Paid} amount={proj.m1Amount ?? 0} />
                            <MilestoneDot label="M2" paid={proj.m2Paid} amount={m2DisplayAmount} />
                            {(proj.m3Amount ?? 0) > 0 && (
                              <MilestoneDot label="M3" paid={proj.m3Paid} amount={proj.m3Amount ?? 0} />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Mobile FAB — New Deal shortcut (below md) ── */}
      {myProjects.length > 0 && (
        <Link
          href="/dashboard/new-deal"
          className="fixed bottom-6 right-6 z-40 md:hidden flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 shadow-lg active:scale-95 transition-transform"
          aria-label="Submit a Deal"
        >
          <PlusCircle className="w-7 h-7 text-white" />
        </Link>
      )}
    </div>
  );
}
