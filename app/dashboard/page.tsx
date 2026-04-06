'use client';

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../lib/context';
import { useIsHydrated, useScrollReveal, useMediaQuery } from '../../lib/hooks';
import MobileDashboard from './mobile/MobileDashboard';
import { computeSparklineData, Sparkline } from '../../lib/sparkline';
import {
  computeIncentiveProgress, formatIncentiveMetric,
  getSolarTechBaseline, getProductCatalogBaseline, getInstallerRatesForDeal,
  getTrainerOverrideRate,
  Project, InstallerPricingVersion, ProductCatalogProduct, ACTIVE_PHASES,
  DEFAULT_INSTALL_PAY_PCT,
} from '../../lib/data';
import { formatDate, fmt$, getCustomConfig } from '../../lib/utils';
import { TrendingUp, TrendingDown, AlertCircle, DollarSign, CheckCircle, CheckSquare, Zap, Users, BarChart2, Target, FolderKanban, Flag, Clock, ChevronRight, ChevronUp, ChevronDown, PlusCircle, Banknote, UserPlus, Settings, PauseCircle, HelpCircle, MessageSquare } from 'lucide-react';
import { PaginationBar } from './components/PaginationBar';

type Period = 'all' | 'this-month' | 'last-month' | 'this-year';

/** Maps Tailwind accent-gradient class strings to an RGBA glow for --card-accent */
const ACCENT_COLOR_MAP: Record<string, string> = {
  'from-blue-500 to-blue-400':       'rgba(59,130,246,0.08)',
  'from-red-500 to-red-400':         'rgba(239,68,68,0.08)',
  'from-emerald-500 to-emerald-400': 'rgba(16,185,129,0.08)',
  'from-yellow-500 to-yellow-400':   'rgba(234,179,8,0.08)',
  'from-purple-500 to-purple-400':   'rgba(168,85,247,0.08)',
  'from-amber-500 to-amber-400':     'rgba(245,158,11,0.08)',
};

function isInPeriod(dateStr: string, period: Period): boolean {
  if (period === 'all') return true;
  const [year, month] = dateStr.split('-').map(Number);
  const now = new Date();
  if (period === 'this-month') {
    return month - 1 === now.getMonth() && year === now.getFullYear();
  }
  if (period === 'last-month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return month - 1 === lastMonth.getMonth() && year === lastMonth.getFullYear();
  }
  if (period === 'this-year') {
    return year === now.getFullYear();
  }
  return true;
}

/** Returns true when dateStr falls in the period immediately preceding `period`. */
function isInPreviousPeriod(dateStr: string, period: Period): boolean {
  const [year, month] = dateStr.split('-').map(Number);
  const now = new Date();
  if (period === 'this-month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return month - 1 === lastMonth.getMonth() && year === lastMonth.getFullYear();
  }
  if (period === 'this-year') {
    return year === now.getFullYear() - 1;
  }
  return false;
}

function isThisWeek(dateStr: string): boolean {
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

function isThisMonth(dateStr: string): boolean {
  const [year, month] = dateStr.split('-').map(Number);
  const now = new Date();
  return month - 1 === now.getMonth() && year === now.getFullYear();
}

/** Pipeline phase color palette — mirrors PHASE_PILL in projects/page.tsx */
const PIPELINE_PHASE_COLORS: Record<string, { bar: string; text: string; dot: string; chipBg: string; chipBorder: string }> = {
  'New':             { bar: 'bg-sky-500',      text: 'text-sky-300',     dot: 'bg-sky-400',     chipBg: 'bg-gradient-to-r from-sky-900/40 to-sky-800/20',         chipBorder: 'border-sky-700/30'      },
  'Acceptance':      { bar: 'bg-indigo-500',   text: 'text-indigo-300',  dot: 'bg-indigo-400',  chipBg: 'bg-gradient-to-r from-indigo-900/40 to-indigo-800/20',    chipBorder: 'border-indigo-700/30'   },
  'Site Survey':     { bar: 'bg-violet-500',   text: 'text-violet-300',  dot: 'bg-violet-400',  chipBg: 'bg-gradient-to-r from-violet-900/40 to-violet-800/20',    chipBorder: 'border-violet-700/30'   },
  'Design':          { bar: 'bg-fuchsia-500',  text: 'text-fuchsia-300', dot: 'bg-fuchsia-400', chipBg: 'bg-gradient-to-r from-fuchsia-900/40 to-fuchsia-800/20',  chipBorder: 'border-fuchsia-700/30'  },
  'Permitting':      { bar: 'bg-amber-500',    text: 'text-amber-300',   dot: 'bg-amber-400',   chipBg: 'bg-gradient-to-r from-amber-900/40 to-amber-800/20',      chipBorder: 'border-amber-700/30'    },
  'Pending Install': { bar: 'bg-orange-500',   text: 'text-orange-300',  dot: 'bg-orange-400',  chipBg: 'bg-gradient-to-r from-orange-900/40 to-orange-800/20',    chipBorder: 'border-orange-700/30'   },
  'Installed':       { bar: 'bg-teal-500',     text: 'text-teal-300',    dot: 'bg-teal-400',    chipBg: 'bg-gradient-to-r from-teal-900/40 to-teal-800/20',        chipBorder: 'border-teal-700/30'     },
  'PTO':             { bar: 'bg-[#00e07a]',  text: 'text-emerald-300', dot: 'bg-emerald-400', chipBg: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  chipBorder: 'border-emerald-700/30'  },
};

// ─── Needs Attention ──────────────────────────────────────────────────────────

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

function getPhaseStuckThresholds(): Record<string, number> {
  return getCustomConfig('kilo-pipeline-thresholds', DEFAULT_PHASE_STUCK_THRESHOLDS);
}

type MentionItem = {
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
  mentionSnippet?: string;
  mentionAuthor?: string;
  mentionPendingTasks?: number;
};

function NeedsAttentionSection({
  activeProjects,
  isAdmin = false,
  onUnflag,
  mentions = [],
}: {
  activeProjects: Array<{
    id: string;
    customerName: string;
    setterId?: string;
    flagged: boolean;
    soldDate: string;
    phase: string;
    repName?: string;
  }>;
  isAdmin?: boolean;
  onUnflag?: (projectId: string) => void;
  mentions?: MentionItem[];
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
    const threshold = PHASE_STUCK_THRESHOLDS[proj.phase];
    if (threshold == null) continue; // skip phases without a threshold (e.g. PTO)
    const [y, m, d] = proj.soldDate.split('-').map(Number);
    const sold = new Date(y, m - 1, d);
    const diffDays = Math.floor((today.getTime() - sold.getTime()) / 86_400_000);
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
    if (proj.phase === 'On Hold') {
      const [y, m, d] = proj.soldDate.split('-').map(Number);
      const sold = new Date(y, m - 1, d);
      const holdDays = Math.floor((today.getTime() - sold.getTime()) / 86_400_000);
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

  // Sort: by staleDays (stuck) or holdDays (on-hold) descending (most urgent first)
  items.sort((a, b) => {
    return (b.staleDays ?? b.holdDays ?? 0) - (a.staleDays ?? a.holdDays ?? 0);
  });

  const [open, setOpen] = useState(true);

  const capped = items.slice(0, 5);
  const hasMore = items.length > 5;

  return (
    <div
      ref={sectionRef}
      className={`card-surface rounded-2xl mb-6 ${sectionVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
      style={items.length === 0 ? { borderLeft: '3px solid #00e07a' } : undefined}
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-[#1d2028]/30 transition-colors rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <div className={`h-[2px] w-8 rounded-full bg-gradient-to-r ${items.length > 0 ? 'from-amber-500 to-amber-400' : 'from-emerald-500 to-emerald-400'}`} />
          <div className={`p-1.5 rounded-lg ${items.length > 0 ? 'bg-amber-500/15' : 'bg-[#00e07a]/15'}`}>
            {items.length > 0
              ? <AlertCircle className="w-4 h-4 text-amber-400" />
              : <CheckCircle className="w-4 h-4" style={{ color: '#00e07a' }} />
            }
          </div>
          <h2 className="text-white font-bold tracking-tight text-base" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {items.length > 0 ? 'Needs Attention' : 'All Clear'}
          </h2>
          {items.length > 0 && (
            <span className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
          : <ChevronDown className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
        }
      </button>

      <div className={`collapsible-panel ${open ? 'open' : ''}`}>
        <div className="collapsible-inner">
          <div className="divider-gradient-animated" />

          {items.length === 0 ? (
            /* ── Empty / all-clear state ── */
            <div className="flex items-center gap-3 px-6 py-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(0,224,122,0.12)' }}>
                <CheckCircle className="w-4 h-4" style={{ color: '#00e07a' }} />
              </div>
              <p className="text-[#c2c8d8] text-sm">All clear! No items need attention right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {capped.map((item) => (
                <div
                  key={item.uid}
                  className="flex items-center gap-4 px-6 py-3.5 min-h-[44px] hover:bg-[#1d2028]/40 transition-colors group"
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
                          if (item.kind !== 'stuck') return 'text-[#8891a8]';
                          const threshold = item.stuckPhase ? (PHASE_STUCK_THRESHOLDS[item.stuckPhase] ?? 14) : 14;
                          const ratio = (item.staleDays ?? 0) / threshold;
                          if (ratio >= 2) return 'text-red-400';
                          if (ratio >= 1.5) return 'text-orange-400';
                          return 'text-amber-400';
                        })()
                      }`}>
                        {item.kind === 'flagged' && 'Flagged for review'}
                        {item.kind === 'stuck' && `${item.staleDays ?? 0} days in ${item.stuckPhase}`}
                        {item.kind === 'on-hold' && `On hold ${item.holdDays} day${item.holdDays !== 1 ? 's' : ''}`}
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
                          className="px-2 py-0.5 text-xs rounded-md bg-[#1d2028] hover:bg-[#272b35] text-[#c2c8d8] hover:text-white transition-colors"
                        >
                          Unflag
                        </button>
                      )}
                      {item.kind === 'on-hold' && (
                        <Link
                          href={`/dashboard/projects/${item.projectId}?action=resume`}
                          className="px-2 py-0.5 text-xs rounded-md bg-[#1d2028] hover:bg-[#272b35] text-[#c2c8d8] hover:text-white transition-colors"
                        >
                          Resume
                        </Link>
                      )}
                    </div>
                  )}

                  <Link href={`/dashboard/projects/${item.projectId}`} className="flex-shrink-0">
                    <ChevronRight className="w-4 h-4 text-[#525c72] group-hover:text-[#c2c8d8] transition-colors" />
                  </Link>
                </div>
              ))}

              {/* View all link when capped */}
              {hasMore && (
                <div className="px-6 py-3 flex items-center justify-between">
                  <span className="text-[#8891a8] text-xs">{items.length - 5} more item{items.length - 5 !== 1 ? 's' : ''} hidden</span>
                  <Link
                    href="/dashboard/projects"
                    className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors"
                  >
                    View all projects →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── My Tasks (aggregated uncompleted check items from chatter mentions) ──────

function relativeTimeShort(iso: string): string {
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

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(dueDate: string): boolean {
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

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

function MyTasksSection({
  mentions,
  onToggleTask,
}: {
  mentions: MentionItem[];
  onToggleTask: (projectId: string, messageId: string, checkItemId: string, completed: boolean) => void;
}) {
  // Extract all uncompleted check items across all mentions
  const tasks: TaskItem[] = [];
  for (const mention of mentions) {
    for (const ci of mention.checkItems) {
      if (!ci.completed) {
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
        <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
          <CheckSquare className="w-4 h-4 text-[#00e07a]" />
        </div>
        <h2 className="text-white font-bold tracking-tight text-base">My Tasks</h2>
        <span className="bg-[#00e07a]/20 border border-[#00e07a]/30 text-[#00e07a] text-xs font-bold px-2 py-0.5 rounded-full">
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
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] hover:bg-[#1d2028]/40 transition-colors group"
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => onToggleTask(task.projectId, task.messageId, task.checkItemId, true)}
                className="w-4 h-4 rounded border-[#272b35] bg-[#1d2028] text-[#00e07a] focus:ring-emerald-500/30 focus:ring-offset-0 cursor-pointer accent-[#00e07a] flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${overdue ? 'text-red-300' : 'text-[#c2c8d8]'}`}>
                  {task.text}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Link
                    href={`/dashboard/projects/${task.projectId}#chatter`}
                    className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors truncate max-w-[140px]"
                  >
                    {task.projectName}
                  </Link>
                  <span className="text-[#525c72] text-[10px]">from {task.authorName}</span>
                  <span className="text-[#525c72] text-[10px]">{relativeTimeShort(task.createdAt)}</span>
                  {task.dueDate && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        overdue
                          ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                          : 'bg-[#272b35]/50 text-[#c2c8d8] border border-[#272b35]/30'
                      }`}
                    >
                      {overdue ? 'Overdue' : `Due ${formatDueDate(task.dueDate)}`}
                    </span>
                  )}
                </div>
              </div>
              <Link href={`/dashboard/projects/${task.projectId}#chatter`} className="flex-shrink-0">
                <ChevronRight className="w-4 h-4 text-[#525c72] group-hover:text-[#c2c8d8] transition-colors" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pipeline Overview ─────────────────────────────────────────────────────────
function PipelineOverview({ activeProjects }: { activeProjects: Array<{ phase: string }> }) {
  const [mounted, setMounted] = useState(false);
  const [tooltip, setTooltip] = useState<{ phase: string; x: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // One rAF so the browser paints width:0 first, then transitions to real widths
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = activeProjects.length;

  const phaseCounts = ACTIVE_PHASES.reduce<Record<string, number>>((acc, phase) => {
    acc[phase] = activeProjects.filter((p) => p.phase === phase).length;
    return acc;
  }, {});

  const nonEmpty = ACTIVE_PHASES.filter((ph) => phaseCounts[ph] > 0);

  if (total === 0) {
    return (
      <div className="border border-dashed border-[#333849] rounded-2xl px-5 py-12 text-center">
        <FolderKanban className="w-8 h-8 text-[#525c72] mx-auto mb-3" />
        <p className="text-white font-bold text-sm mb-1">No active projects — submit your first deal</p>
        <p className="text-[#8891a8] text-xs mt-1">Your pipeline will appear here once you close a deal.</p>
      </div>
    );
  }

  return (
    <>
      {/* Stacked bar — overflow-hidden clips segment edges cleanly at the rounded corners */}
      <div className="relative mb-4" ref={barRef}>
        <div className="flex h-10 md:h-8 rounded-xl bg-[#1d2028] overflow-hidden">
          {nonEmpty.map((phase) => {
            const count = phaseCounts[phase];
            const s = PIPELINE_PHASE_COLORS[phase] ?? { bar: 'bg-[#8891a8]', text: '', dot: '', chipBg: '', chipBorder: '' };
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
            className="pointer-events-none absolute -top-8 bg-[#1d2028] border border-[#272b35] text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap z-20 -translate-x-1/2"
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
          const s = PIPELINE_PHASE_COLORS[phase] ?? { bar: 'bg-[#8891a8]', text: 'text-[#c2c8d8]', dot: 'bg-[#8891a8]', chipBg: '', chipBorder: '' };
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

// ─── Trend Badge ───────────────────────────────────────────────────────────────
/**
 * pctChange:
 *  undefined → hide badge entirely (period has no comparable predecessor)
 *  null      → show neutral dash (predecessor exists but had no data / zero base)
 *  number    → show green/red pill with percentage
 */
function TrendBadge({ pctChange }: { pctChange: number | null | undefined }) {
  if (pctChange === undefined) return null;

  if (pctChange === null) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#8891a8]/15 text-[#c2c8d8]">
        —
      </span>
    );
  }

  if (pctChange > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#00e07a]/15 text-[#00e07a]">
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
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#8891a8]/15 text-[#c2c8d8]">
      —
    </span>
  );
}

// ─── Animated Stat Value (wraps useCountUp for individual stat cards) ────────
function AnimatedStatValue({ raw, format, className, style }: { raw: number; format: (n: number) => string; className?: string; style?: CSSProperties }) {
  const animated = useCountUp(raw, 900);
  return <p className={className} style={style}>{format(animated)}</p>;
}
// ─── Count-Up Hook ──────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 800): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    let startTime: number | null = null;

    const step = (ts: number) => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
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

export default function DashboardPage() {
  const { currentRole, currentRepId, currentRepName, projects, payrollEntries, incentives, reps, trainerAssignments, installerPricingVersions, productCatalogProducts, effectiveRole, effectiveRepId, effectiveRepName, installerPayConfigs } = useApp();
  useEffect(() => { document.title = 'Dashboard | Kilo Energy'; }, []);
  const [period, setPeriod] = useState<Period>('all');
  const periodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [periodIndicator, setPeriodIndicator] = useState<{ left: number; width: number } | null>(null);
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const router = useRouter();

  // Scroll-triggered reveal refs for below-fold dashboard sections
  const [statsRef, statsVisible] = useScrollReveal<HTMLDivElement>();
  const [pipelineRef, pipelineVisible] = useScrollReveal<HTMLDivElement>();
  const [incentivesRef, incentivesVisible] = useScrollReveal<HTMLDivElement>();

  // Keyboard shortcuts (N/P/E/D) handled globally in layout.tsx

  const periodProjects = projects.filter((p) => isInPeriod(p.soldDate, period));
  const periodPayroll = payrollEntries.filter((p) => isInPeriod(p.date, period));

  const myProjects =
    effectiveRole === 'admin'
      ? periodProjects
      : periodProjects.filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId);

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
        : prevPeriodProjects.filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId))
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

  const PERIODS: { value: Period; label: string }[] = [
    { value: 'all', label: 'All Time' },
    { value: 'this-month', label: 'This Month' },
    { value: 'last-month', label: 'Last Month' },
    { value: 'this-year', label: 'This Year' },
  ];

  // Measure the active period tab so the sliding pill can follow it
  useEffect(() => {
    const PERIOD_VALUES: Period[] = ['all', 'this-month', 'last-month', 'this-year'];
    const idx = PERIOD_VALUES.indexOf(period);
    const el = periodTabRefs.current[idx];
    if (el) setPeriodIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period]);

  // Hoist payrollProjectIds + MTD derivations above the isHydrated guard so that
  // useCountUp (a React hook) is always called unconditionally — hooks rules require
  // every hook to be called in the same order on every render.
  const payrollProjectIds = new Set(myPayroll.map((p) => p.projectId).filter(Boolean));
  const mtdProjects = projects.filter(
    (p) => (p.repId === effectiveRepId || p.setterId === effectiveRepId) && isThisMonth(p.soldDate)
  );
  const mtdPayrollCommission = payrollEntries
    .filter((p) => p.repId === effectiveRepId && isThisMonth(p.date))
    .reduce((s, p) => s + p.amount, 0);
  const mtdUnmatchedCommission = mtdProjects
    .filter((p) => !payrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((s, p) => {
      const closerM1 = p.setterId ? 0 : (p.m1Amount ?? 0);
      return s + (p.repId === effectiveRepId ? closerM1 + (p.m2Amount ?? 0) : p.setterId === effectiveRepId ? (p.m1Amount ?? 0) : 0);
    }, 0);
  const mtdCommission = mtdPayrollCommission + mtdUnmatchedCommission;

  // Animated count-up for the MTD commission hero — always called (hook rules)
  const animatedMtdCommission = useCountUp(mtdCommission, 1200);

  // Fetch @mentions for Needs Attention section (reps + sub-dealers)
  const [dashMentions, setDashMentions] = useState<MentionItem[]>([]);
  const fetchMentions = useCallback(() => {
    if (!currentRepId || currentRole === 'admin') return;
    fetch(`/api/mentions?userId=${currentRepId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then((rawMentions: any[]) => {
        // Transform Prisma shape → MentionItem shape
        const items: MentionItem[] = (rawMentions ?? []).map((m: any) => ({
          id: m.id,
          projectId: m.message?.projectId ?? '',
          projectCustomerName: m.message?.project?.customerName ?? 'Unknown',
          messageId: m.messageId ?? m.message?.id ?? '',
          messageSnippet: (m.message?.text ?? '').slice(0, 120),
          authorName: m.message?.authorName ?? 'Unknown',
          checkItems: (m.message?.checkItems ?? []).map((ci: any) => ({
            id: ci.id,
            text: ci.text,
            completed: ci.completed,
            dueDate: ci.dueDate ?? null,
          })),
          createdAt: m.message?.createdAt ?? new Date().toISOString(),
          read: m.readAt != null,
        }));
        setDashMentions(items);
      })
      .catch(() => setDashMentions([]));
  }, [currentRepId, currentRole]);
  useEffect(() => { fetchMentions(); }, [fetchMentions]);

  if (!isHydrated) {
    return <DashboardSkeleton />;
  }

  if (isMobile) return <MobileDashboard />;

  if (effectiveRole === 'project_manager') {
    return <PMDashboard projects={periodProjects} allProjects={projects} period={period} setPeriod={setPeriod} PERIODS={PERIODS} totalReps={reps.length} />;
  }

  if (effectiveRole === 'admin') {
    return <AdminDashboard
      projects={periodProjects}
      allProjects={projects}
      payroll={periodPayroll}
      period={period}
      setPeriod={setPeriod}
      PERIODS={PERIODS}
      totalReps={reps.length}
      installerPricingVersions={installerPricingVersions}
      productCatalogProducts={productCatalogProducts}
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
  const activeProjects = myProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));

  // ── Financial stats (project-based to account for milestone-triggered payroll) ──
  const todayStr = new Date().toISOString().split('T')[0];
  const paidPayrollByProject = myPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((map, p) => {
    if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());

  // "In Pipeline" = expected commission from active projects minus what's actually been disbursed
  const inPipeline = activeProjects.reduce((sum, p) => {
    const closerM1 = p.setterId ? 0 : (p.m1Amount ?? 0);
    const totalExpected = p.repId === effectiveRepId
      ? closerM1 + (p.m2Amount ?? 0)
      : p.setterId === effectiveRepId
        ? (p.m1Amount ?? 0)
        : 0;
    const alreadyPaid = paidPayrollByProject.get(p.id) ?? 0;
    return sum + Math.max(0, totalExpected - alreadyPaid);
  }, 0);

  // "Total Estimated Pay" = unpaid payroll + expected amounts from projects not yet in payroll
  // (payrollProjectIds is hoisted above the isHydrated guard — already in scope)
  const unpaidPayroll = myPayroll.filter((p) => p.status !== 'Paid').reduce((sum, p) => sum + p.amount, 0);
  const unmatchedProjectPay = myProjects
    .filter((p) => !payrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((sum, p) => {
      const closerM1 = p.setterId ? 0 : (p.m1Amount ?? 0);
      return sum + (p.repId === effectiveRepId ? closerM1 + (p.m2Amount ?? 0) : p.setterId === effectiveRepId ? (p.m1Amount ?? 0) : 0);
    }, 0);
  // M3: build a set of project IDs that already have an M3 payroll entry (paid or unpaid).
  // If unpaid, the amount is already in unpaidPayroll. If paid, it belongs in totalPaid.
  // Only add m3Amount for projects with no M3 entry yet, regardless of phase.
  const m3PayrollProjectIds = new Set(myPayroll.filter((p) => p.paymentStage === 'M3').map((p) => p.projectId).filter(Boolean));
  const pendingM3Pay = myProjects
    .filter((p) => !m3PayrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold' && (p.m3Amount ?? 0) > 0)
    .reduce((sum, p) => {
      const closerM3 = p.setterId ? 0 : (p.m3Amount ?? 0);
      return sum + (p.repId === effectiveRepId ? closerM3 : 0);
    }, 0);
  const totalEstimatedPay = unpaidPayroll + unmatchedProjectPay + pendingM3Pay;

  // Only count as "paid" once the pay date has actually passed
  const totalPaid = myPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr && p.amount > 0).reduce((sum, p) => sum + p.amount, 0);
  const totalChargebacks = Math.abs(myPayroll.filter((p) => p.amount < 0).reduce((sum, p) => sum + p.amount, 0));
  const chargebackCount = myPayroll.filter((p) => p.amount < 0).length;
  const totalKW = activeProjects.reduce((sum, p) => sum + p.kWSize, 0);
  const installedPhases = ['Installed', 'PTO', 'Completed'];
  const totalKWSold = totalKW;
  const totalKWInstalled = myProjects.filter((p) => installedPhases.includes(p.phase)).reduce((sum, p) => sum + p.kWSize, 0);

  // ── Previous-period equivalents for trend-badge percentage changes ──────────
  const prevActiveProjects = myPrevProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  const prevPaidByProject = myPrevPayroll.filter((p) => p.status === 'Paid').reduce((map, p) => {
    if (p.projectId) map.set(p.projectId, (map.get(p.projectId) ?? 0) + p.amount);
    return map;
  }, new Map<string, number>());
  const prevInPipeline = prevActiveProjects.reduce((sum, p) => {
    const closerM1 = p.setterId ? 0 : (p.m1Amount ?? 0);
    const totalExpected = p.repId === effectiveRepId
      ? closerM1 + (p.m2Amount ?? 0)
      : p.setterId === effectiveRepId
        ? (p.m1Amount ?? 0)
        : 0;
    const alreadyPaid = prevPaidByProject.get(p.id) ?? 0;
    return sum + Math.max(0, totalExpected - alreadyPaid);
  }, 0);
  const prevPayrollProjectIds = new Set(myPrevPayroll.map((p) => p.projectId).filter(Boolean));
  const prevUnpaidPayroll = myPrevPayroll.filter((p) => p.status !== 'Paid').reduce((sum, p) => sum + p.amount, 0);
  const prevUnmatchedPay = myPrevProjects
    .filter((p) => !prevPayrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((sum, p) => {
      const closerM1 = p.setterId ? 0 : (p.m1Amount ?? 0);
      return sum + (p.repId === effectiveRepId ? closerM1 + (p.m2Amount ?? 0) : p.setterId === effectiveRepId ? (p.m1Amount ?? 0) : 0);
    }, 0);
  const prevTotalEstimatedPay = prevUnpaidPayroll + prevUnmatchedPay;
  const prevTotalPaid = myPrevPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((sum, p) => sum + p.amount, 0);
  const prevTotalKW = prevActiveProjects.reduce((sum, p) => sum + p.kWSize, 0);
  const prevTotalKWInstalled = myPrevProjects.filter((p) => installedPhases.includes(p.phase)).reduce((sum, p) => sum + p.kWSize, 0);

  // Sparkline data for the five stat cards — last 7 unique dates, summed per day
  const pipelineSparkData   = computeSparklineData(activeProjects.map((p) => ({ date: p.soldDate, amount: (p.m1Amount ?? 0) + (p.m2Amount ?? 0) })));
  const chargebackSparkData: number[] = []; // flat / empty — no chargeback data yet
  const estPaySparkData     = computeSparklineData(myPayroll.filter((p) => p.status !== 'Paid').map((p) => ({ date: p.date, amount: p.amount })));
  const paidSparkData       = computeSparklineData(myPayroll.filter((p) => p.status === 'Paid').map((p) => ({ date: p.date, amount: p.amount })));
  const systemSizeSparkData = computeSparklineData(activeProjects.map((p) => ({ date: p.soldDate, amount: p.kWSize })));
  const installedSparkData = computeSparklineData(myProjects.filter((p) => installedPhases.includes(p.phase)).map((p) => ({ date: p.soldDate, amount: p.kWSize })));

  const thisWeekPayroll = payrollEntries.filter(
    (p) => p.repId === effectiveRepId && isThisWeek(p.date) && p.status !== 'Paid'
  );
  const thisWeekTotal = thisWeekPayroll.reduce((s, p) => s + p.amount, 0);

  // MTD deal count + kW — derived from mtdProjects, which is hoisted above the isHydrated guard
  const mtdDeals = mtdProjects.length;
  const mtdKW = mtdProjects.reduce((s, p) => s + p.kWSize, 0);

  // All-time denominators used for MTD ring-chart ratios (period-independent)
  const allTimeDeals = projects.filter(
    (p) => p.repId === effectiveRepId || p.setterId === effectiveRepId
  ).length;
  const allTimeKW = projects
    .filter((p) => p.repId === effectiveRepId || p.setterId === effectiveRepId)
    .reduce((s, p) => s + p.kWSize, 0);
  const allTimeEstPay = myProjects
    .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((s, p) => {
      const closerM1 = p.setterId ? 0 : (p.m1Amount ?? 0);
      return s + (p.repId === effectiveRepId ? closerM1 + (p.m2Amount ?? 0) : p.setterId === effectiveRepId ? (p.m1Amount ?? 0) : 0);
    }, 0);

  // Circumference for the 48×48 SVG ring (r=20): 2π×20 ≈ 125.66
  const RING_CIRC = 125.66;

  // Next Payout: all Pending + Paid entries dated for the upcoming Friday.
  // "Paid" here means admin published the payroll — money hits on the date.
  const nextFridayDate = (() => {
    const today = new Date();
    const d = (5 - today.getDay() + 7) % 7;
    const nf = new Date(today);
    nf.setDate(today.getDate() + d);
    return nf.toISOString().split('T')[0];
  })();
  const pendingPayrollTotal = payrollEntries
    .filter((p) => p.repId === effectiveRepId && p.date === nextFridayDate && (p.status === 'Pending' || p.status === 'Paid'))
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
      color: 'text-[#00e07a]',
      accentGradient: 'from-emerald-500 to-emerald-400',
      glowClass: 'stat-glow-emerald',
      sparkData: paidSparkData,
      sparkStroke: '#00e07a',
      pctChange: computePctChange(totalPaid, prevTotalPaid),
      href: '/dashboard/my-pay',
      tooltip: 'Total commission disbursed to you across all payment stages',
    },
    {
      label: 'In Pipeline',
      value: fmt$(inPipeline),
      sub: `${activeProjects.length} active projects`,
      icon: TrendingUp,
      color: 'text-[#00e07a]',
      accentGradient: 'from-blue-500 to-blue-400',
      glowClass: 'stat-glow-blue',
      sparkData: pipelineSparkData,
      sparkStroke: '#00c4f0',
      pctChange: computePctChange(inPipeline, prevInPipeline),
      href: '/dashboard/projects',
      tooltip: 'Expected commission from active projects minus amounts already paid',
    },
    {
      label: 'kW Sold',
      value: `${totalKWSold.toFixed(1)} kW`,
      sub: `${activeProjects.length} active projects`,
      icon: Zap,
      color: 'text-yellow-400',
      accentGradient: 'from-yellow-500 to-yellow-400',
      glowClass: 'stat-glow-yellow',
      sparkData: systemSizeSparkData,
      sparkStroke: '#eab308',
      pctChange: computePctChange(totalKW, prevTotalKW),
      href: '/dashboard/projects',
      tooltip: 'Total system size in kilowatts from all active deals',
    },
    {
      label: 'kW Installed',
      value: `${totalKWInstalled.toFixed(1)} kW`,
      sub: `${myProjects.filter((p) => installedPhases.includes(p.phase)).length} installed`,
      icon: Zap,
      color: 'text-[#00e07a]',
      accentGradient: 'from-emerald-500 to-emerald-400',
      glowClass: 'stat-glow-emerald',
      sparkData: installedSparkData,
      sparkStroke: '#00e07a',
      pctChange: computePctChange(totalKWInstalled, prevTotalKWInstalled),
      href: '/dashboard/projects',
      tooltip: 'Total kilowatts from projects that have been physically installed',
    },
    {
      label: 'Chargebacks',
      value: fmt$(totalChargebacks),
      sub: chargebackCount > 0 ? `${chargebackCount} chargeback${chargebackCount === 1 ? '' : 's'}` : 'No chargebacks',
      icon: AlertCircle,
      color: 'text-red-400',
      accentGradient: 'from-red-500 to-red-400',
      glowClass: 'stat-glow-red',
      sparkData: chargebackSparkData,
      sparkStroke: '#ef4444',
      pctChange: undefined as number | null | undefined,
      href: '/dashboard/my-pay',
      tooltip: 'Total negative adjustments from cancelled or clawed-back deals',
    },
  ];

  return (
    <div className="px-3 pt-2 pb-4 md:p-8 animate-fade-in-up">

      {/* ── Welcome Banner with Glow CTA ─────────────────────────────────── */}
      <div className="card-surface rounded-xl md:rounded-2xl mb-6">
        <div className="px-6 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <p className="text-[#c2c8d8] text-sm font-medium tracking-wide mb-1">Welcome, {effectiveRepName}</p>
            <p className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em' }}>
              <span style={{ color: '#f0f2f7' }}>Next Payout:</span> <span style={{ color: '#00e07a' }}>${pendingPayrollTotal.toLocaleString()}</span>
            </p>
            <p className="text-[#8891a8] text-xs mt-1 flex items-center gap-2">
              {nextFridayLabel}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${daysUntilPayday <= 2 ? 'bg-[#00e07a]/15 text-[#00e07a] border border-[#00e07a]/20' : 'bg-[#272b35]/50 text-[#c2c8d8] border border-[#272b35]/30'}`}>
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
      <div className="flex justify-end mb-6">
        <div className="flex gap-1 bg-[#161920] border border-[#333849] rounded-xl p-1 tab-bar-container">
          {periodIndicator && <div className="tab-indicator" style={periodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { periodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors active:scale-[0.97] ${
                period === p.value
                  ? 'text-black'
                  : 'text-[#c2c8d8] hover:text-white'
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
      {myProjects.length === 0 && (
        <div className="card-surface rounded-2xl p-8 mb-6 flex flex-col items-center text-center gap-6">
          {/* Inline SVG — solar panel with a plus badge */}
          <div className="flex-shrink-0">
            <svg
              width="60" height="60" viewBox="0 0 60 60" fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Panel body */}
              <rect x="4" y="14" width="52" height="32" rx="3" fill="#1d2028" stroke="#334155" strokeWidth="1.5" />
              {/* Grid lines — horizontal */}
              <line x1="4" y1="25" x2="56" y2="25" stroke="#334155" strokeWidth="1" />
              <line x1="4" y1="36" x2="56" y2="36" stroke="#334155" strokeWidth="1" />
              {/* Grid lines — vertical */}
              <line x1="21" y1="14" x2="21" y2="46" stroke="#334155" strokeWidth="1" />
              <line x1="38" y1="14" x2="38" y2="46" stroke="#334155" strokeWidth="1" />
              {/* Cell shimmer fills */}
              <rect x="5" y="15" width="15" height="10" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="22" y="15" width="15" height="10" rx="1" fill="#00e07a" fillOpacity="0.5" />
              <rect x="39" y="15" width="16" height="10" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="5" y="26" width="15" height="10" rx="1" fill="#00e07a" fillOpacity="0.5" />
              <rect x="22" y="26" width="15" height="10" rx="1" fill="#00c4f0" fillOpacity="0.45" />
              <rect x="39" y="26" width="16" height="10" rx="1" fill="#00e07a" fillOpacity="0.5" />
              <rect x="5" y="37" width="15" height="8" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="22" y="37" width="15" height="8" rx="1" fill="#00e07a" fillOpacity="0.5" />
              <rect x="39" y="37" width="16" height="8" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              {/* Mount legs */}
              <line x1="20" y1="46" x2="16" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              <line x1="40" y1="46" x2="44" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              <line x1="13" y1="55" x2="47" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              {/* Plus badge — top-right corner */}
              <circle cx="49" cy="15" r="9" fill="#0f172a" />
              <circle cx="49" cy="15" r="8" fill="#00e07a" />
              <line x1="49" y1="10" x2="49" y2="20" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="44" y1="15" x2="54" y2="15" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          <div className="space-y-2 max-w-sm">
            <h2 className="text-2xl font-black text-white tracking-tight">Submit your first deal</h2>
            <p className="text-[#c2c8d8] text-sm leading-relaxed">
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
              className="inline-flex items-center gap-1 text-[#c2c8d8] hover:text-[#c2c8d8] text-sm font-medium transition-colors"
            >
              Explore the calculator →
            </Link>
          </div>
        </div>
      )}

      {/* Stats grid — only shown once at least one deal exists */}
      {myProjects.length > 0 && (
        <>
          <div
            ref={statsRef}
            className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 md:gap-4 mb-6 ${statsVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
          >
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <Link key={stat.label} href={stat.href} className={`group card-surface card-surface-stat rounded-2xl p-4 md:p-5 h-full cursor-pointer hover:border-[#00e07a]/30 hover:scale-[1.02] transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': ACCENT_COLOR_MAP[stat.accentGradient] ?? 'transparent' } as CSSProperties}>
                  <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${stat.accentGradient}`} />
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider flex items-center gap-1">
                      {stat.label}
                      {'tooltip' in stat && stat.tooltip && (
                        <span className="relative group/tip">
                          <HelpCircle className="w-3 h-3 text-[#525c72] hover:text-[#c2c8d8] transition-colors cursor-help" />
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover/tip:block whitespace-normal w-48 rounded-lg bg-[#1d2028] border border-[#272b35]/60 px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-[#c2c8d8] shadow-xl leading-snug">
                            {stat.tooltip}
                          </span>
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <Icon className={`w-4 h-4 ${stat.color}`} />
                      <ChevronRight className="w-3.5 h-3.5 text-[#525c72] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <p className={`stat-value stat-value-glow ${stat.glowClass} text-3xl font-black tabular-nums tracking-tight animate-count-up ${'gradient' in stat && stat.gradient ? stat.gradient : stat.color}`}>{stat.value}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-[#8891a8] text-xs">{stat.sub}</p>
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
                (p.repId === effectiveRepId || p.setterId === effectiveRepId) &&
                (ACTIVE_PHASES.includes(p.phase) || p.phase === 'On Hold')
            )}
            mentions={dashMentions}
          />

          {/* My Tasks — aggregated uncompleted check items from chatter mentions */}
          <MyTasksSection
            mentions={dashMentions}
            onToggleTask={(projectId, messageId, checkItemId, completed) => {
              fetch(`/api/projects/${projectId}/messages/${messageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkItemId, completed, completedBy: effectiveRepId }),
              }).then((res) => {
                if (!res.ok) return;
                // Update local state to remove the completed task
                setDashMentions((prev) =>
                  prev.map((m) =>
                    m.messageId === messageId
                      ? {
                          ...m,
                          checkItems: m.checkItems.map((ci) =>
                            ci.id === checkItemId ? { ...ci, completed: true } : ci
                          ),
                        }
                      : m
                  )
                );
              }).catch(() => {});
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
                <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
                  <FolderKanban className="w-4 h-4 text-[#00e07a]" />
                </div>
                <h2 className="text-white font-bold tracking-tight text-base">Pipeline Overview</h2>
              </div>
              <Link href="/dashboard/projects" className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors">
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
      <div className="hidden md:flex items-center gap-6 bg-[#161920]/60 border border-[#333849] rounded-xl px-4 py-2.5 mb-6 select-none">
        {[
          { key: 'N', label: 'New Deal' },
          { key: 'P', label: 'Projects' },
          { key: 'E', label: 'My Pay' },
          { key: '⌘K', label: 'Search' },
        ].map(({ key, label }) => (
          <span key={key} className="inline-flex items-center gap-2">
            <kbd className="bg-[#1d2028] border border-[#272b35] text-[#c2c8d8] text-xs px-1.5 py-0.5 rounded font-mono">
              {key}
            </kbd>
            <span className="text-[#8891a8] text-xs">{label}</span>
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
              <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
                <Target className="w-4 h-4 text-[#00e07a]" />
              </div>
              <h2 className="text-white font-bold tracking-tight text-base">Active Incentives</h2>
            </div>
            <Link href="/dashboard/incentives" className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors">
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
                <div key={incentive.id} className="bg-[#1d2028]/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-medium">{incentive.title}</p>
                      {incentive.type === 'personal' && (
                        <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">Personal</span>
                      )}
                    </div>
                    <p className="text-[#00e07a] font-bold text-sm">{formatIncentiveMetric(incentive.metric, progress)}</p>
                  </div>
                  <div className="w-full bg-[#272b35] rounded-full h-1.5 mb-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? 'linear-gradient(90deg,#00e07a,#00c4f0)' : 'linear-gradient(90deg,#00e07a,#00c4f0)',
                      }}
                    />
                  </div>
                  {nextMilestone && (
                    <p className="text-[#8891a8] text-xs">
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
            <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
              <DollarSign className="w-4 h-4 text-[#00e07a]" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">This Week&apos;s Pay</h2>
          </div>
          <div className="flex items-center gap-3">
            {thisWeekTotal > 0 && (
              <span className="text-[#00e07a] font-bold">${thisWeekTotal.toLocaleString()}</span>
            )}
            <Link href="/dashboard/my-pay" className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors">
              View All →
            </Link>
          </div>
        </div>
        <div className="divider-gradient-animated" />
        {thisWeekPayroll.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-[#333849] rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[#1d2028]/80 flex items-center justify-center mx-auto mb-3">
                <DollarSign className="w-6 h-6 text-[#525c72] animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No payments this week</p>
              <p className="text-[#8891a8] text-xs mb-4">Payments will appear here once marked for payroll.</p>
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
              <tr className="border-b border-[#333849]">
                <th className="text-left px-6 py-3 text-[#c2c8d8] font-medium text-xs">Customer</th>
                <th className="text-left px-6 py-3 text-[#c2c8d8] font-medium text-xs">Stage</th>
                <th className="text-left px-6 py-3 text-[#c2c8d8] font-medium text-xs">Amount</th>
                <th className="text-left px-6 py-3 text-[#c2c8d8] font-medium text-xs">Date</th>
              </tr>
            </thead>
            <tbody>
              {thisWeekPayroll.map((entry) => (
                <tr key={entry.id} className="relative border-b border-[#333849]/50 even:bg-[#1d2028]/[0.15] hover:bg-[#00e07a]/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[#00e07a] before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                  <td className="px-6 py-3 text-[#c2c8d8]">{entry.customerName || '—'}</td>
                  <td className="px-6 py-3">
                    <span className="bg-[#272b35] text-[#c2c8d8] text-xs px-2 py-0.5 rounded font-medium">
                      {entry.paymentStage}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[#00e07a] font-semibold">${entry.amount.toLocaleString()}</td>
                  <td className="px-6 py-3 text-[#8891a8] text-xs">{entry.date}</td>
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
            <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
              <FolderKanban className="w-4 h-4 text-[#00e07a]" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">Recent Projects</h2>
          </div>
          <Link href="/dashboard/projects" className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors">
            View All →
          </Link>
        </div>
        <div className="divider-gradient-animated" />
        {myProjects.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-[#333849] rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[#1d2028]/80 flex items-center justify-center mx-auto mb-3">
                <FolderKanban className="w-6 h-6 text-[#525c72] animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No projects yet</p>
              <p className="text-[#8891a8] text-xs mb-4">Submit your first deal to see it here</p>
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
            {[...myProjects].sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 8).map((proj) => {
              const installPayPct = installerPayConfigs[proj.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
              const m2DisplayAmount = Math.round((proj.m2Amount ?? 0) * (installPayPct / 100) * 100) / 100;
              const estPay = (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0);
              const soldLabel = (() => {
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
                  <div className="px-5 py-3.5 hover:bg-[#00e07a]/[0.03] transition-colors">
                    {/* Row 1: Customer + Phase + Date */}
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-white font-medium text-sm truncate group-hover:text-[#00c4f0] transition-colors">{proj.customerName}</span>
                        <PhaseBadge phase={proj.phase} />
                      </div>
                      <span className="text-[#8891a8] text-xs whitespace-nowrap flex-shrink-0">{soldLabel}</span>
                    </div>
                    {/* Row 2: kW | Est Pay | Milestones */}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[#8891a8]">{proj.kWSize} kW</span>
                      <span className="text-[#525c72]">·</span>
                      <span className="text-[#00e07a] font-semibold">${estPay.toLocaleString()}</span>
                      <div className="flex items-center gap-2.5 ml-auto">
                        <MilestoneDot label="M1" paid={proj.m1Paid} amount={proj.m1Amount ?? 0} />
                        <MilestoneDot label="M2" paid={proj.m2Paid} amount={proj.m2Amount ?? 0} />
                        {(proj.m3Amount ?? 0) > 0 && (
                          <MilestoneDot label="M3" paid={proj.phase === 'PTO'} amount={proj.m3Amount ?? 0} />
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

// ─── PM Dashboard (no financial data) ──────────────────────────────────────

function PMDashboard({
  projects,
  allProjects,
  period,
  setPeriod,
  PERIODS,
  totalReps,
}: {
  projects: ReturnType<typeof useApp>['projects'];
  allProjects: ReturnType<typeof useApp>['projects'];
  period: Period;
  setPeriod: (p: Period) => void;
  PERIODS: { value: Period; label: string }[];
  totalReps: number;
}) {
  const activeProjects = projects.filter((p) => !['Cancelled', 'On Hold'].includes(p.phase));
  const phaseCounts = ACTIVE_PHASES.reduce((acc, phase) => {
    acc[phase] = projects.filter((p) => p.phase === phase).length;
    return acc;
  }, {} as Record<string, number>);
  const flaggedCount = projects.filter((p) => p.flagged).length;
  const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center gap-2">
        {PERIODS.map((p) => (
          <button key={p.value} onClick={() => setPeriod(p.value)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${period === p.value ? 'bg-[#00e07a] text-black font-bold' : 'text-[#c2c8d8] hover:text-white hover:bg-[#1d2028]'}`}>{p.label}</button>
        ))}
      </div>

      {/* Summary cards — NO dollar amounts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Projects', value: activeProjects.length, color: 'text-[#00e07a]' },
          { label: 'Total Projects', value: projects.length, color: 'text-[#c2c8d8]' },
          { label: 'Total kW', value: `${totalKW.toFixed(1)}`, color: 'text-[#00e07a]' },
          { label: 'Flagged', value: flaggedCount, color: flaggedCount > 0 ? 'text-red-400' : 'text-[#8891a8]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card-surface rounded-2xl p-5">
            <p className="text-xs text-[#8891a8] mb-1">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline breakdown */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2"><FolderKanban className="w-4 h-4 text-[#00e07a]" /> Pipeline</h2>
        <div className="space-y-2">
          {ACTIVE_PHASES.map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct = projects.length > 0 ? (count / projects.length) * 100 : 0;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className="text-xs text-[#c2c8d8] w-28 shrink-0">{phase}</span>
                <div className="flex-1 h-2 bg-[#1d2028] rounded-full overflow-hidden">
                  <div className="h-full bg-[#00e07a]/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-[#8891a8] tabular-nums w-8 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team overview */}
      <div className="card-surface rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-[#00e07a]" /> Team</h2>
        <p className="text-[#c2c8d8] text-sm">{totalReps} active reps</p>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ───────────────────────────────────────────────────────

function AdminDashboard({
  projects,
  allProjects,
  payroll,
  period,
  setPeriod,
  PERIODS,
  totalReps,
  installerPricingVersions,
  productCatalogProducts,
}: {
  projects: ReturnType<typeof useApp>['projects'];
  allProjects: ReturnType<typeof useApp>['projects'];
  payroll: ReturnType<typeof useApp>['payrollEntries'];
  period: Period;
  setPeriod: (p: Period) => void;
  PERIODS: { value: Period; label: string }[];
  totalReps: number;
  installerPricingVersions: InstallerPricingVersion[];
  productCatalogProducts: ProductCatalogProduct[];
}) {
  const { updateProject } = useApp();

  // Search filter for Recent Projects table
  const [recentSearch, setRecentSearch] = useState('');
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [cancellationExpanded, setCancellationExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(true);

  // Sort & pagination for Recent Projects table
  type SortKey = 'customerName' | 'installer' | 'kWSize' | 'netPPW' | 'phase' | 'soldDate';
  const [sortKey, setSortKey] = useState<SortKey>('soldDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [recentPage, setRecentPage] = useState(1);
  const [recentRowsPerPage, setRecentRowsPerPage] = useState(10);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setRecentPage(1);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 text-[#525c72] inline ml-1" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-[#00e07a] inline ml-1" />
      : <ChevronDown className="w-3 h-3 text-[#00e07a] inline ml-1" />;
  };

  // Sliding pill for admin period tabs
  const adminPeriodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [adminPeriodIndicator, setAdminPeriodIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const PERIOD_VALUES: Period[] = ['all', 'this-month', 'last-month', 'this-year'];
    const idx = PERIOD_VALUES.indexOf(period);
    const el = adminPeriodTabRefs.current[idx];
    if (el) setAdminPeriodIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period]);

  /** Returns { closerPerW, kiloPerW } for any project type, respecting overrides. */
  function getProjectBaselines(p: Project): { closerPerW: number; kiloPerW: number } {
    if (p.baselineOverride) return p.baselineOverride;
    if (p.installer === 'SolarTech' && p.solarTechProductId) {
      return getSolarTechBaseline(p.solarTechProductId, p.kWSize);
    }
    if (p.installerProductId) {
      return getProductCatalogBaseline(productCatalogProducts, p.installerProductId, p.kWSize);
    }
    return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
  }

  // Revenue = netPPW × kW × 1000 (actual contract value)
  // Profit  = (closerPerW − kiloPerW) × kW × 1000 (Kilo's baseline spread / margin)
  const { totalRevenue, totalProfit } = projects.reduce(
    (acc, p) => {
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') return acc;
      const { closerPerW, kiloPerW } = getProjectBaselines(p);
      const watts = p.kWSize * 1000;
      acc.totalRevenue += (p.netPPW ?? 0) * watts;
      acc.totalProfit  += (closerPerW - kiloPerW) * watts;
      return acc;
    },
    { totalRevenue: 0, totalProfit: 0 }
  );

  const totalPaid = payroll.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
  const totalKWSold = projects.reduce((s, p) => s + p.kWSize, 0);
  const totalKWInstalled = projects.filter((p) => p.phase === 'PTO' || p.phase === 'Installed' || p.phase === 'Completed').reduce((s, p) => s + p.kWSize, 0);
  const totalUsers = totalReps;

  const activeCount = projects.filter((p) => ['New','Acceptance','Site Survey','Design','Permitting','Pending Install','Installed','PTO'].includes(p.phase)).length;
  const inactiveCount = projects.filter((p) => ['Cancelled','On Hold'].includes(p.phase)).length;
  const completedCount = projects.filter((p) => p.phase === 'Completed').length;

  const topStats = [
    { label: 'Kilo Revenue', value: fmt$(Math.round(totalRevenue)), raw: Math.round(totalRevenue), format: (n: number) => fmt$(n), icon: DollarSign, accentHex: '#00e07a', accentGradient: 'from-emerald-500 to-emerald-400', href: '/dashboard/projects', tooltip: 'Total revenue from installer baselines across all deals' },
    { label: 'Gross Profit', value: fmt$(Math.round(totalProfit)), raw: Math.round(totalProfit), format: (n: number) => fmt$(n), icon: BarChart2, accentHex: '#00c4f0', accentGradient: totalProfit >= 0 ? 'from-emerald-500 to-emerald-400' : 'from-red-500 to-red-400', href: '/dashboard/projects', tooltip: 'Revenue minus Kilo cost basis (closer baseline minus Kilo baseline)' },
    { label: 'Total Paid Out', value: fmt$(Math.round(totalPaid)), raw: Math.round(totalPaid), format: (n: number) => fmt$(n), icon: CheckCircle, accentHex: '#00e07a', accentGradient: 'from-emerald-500 to-emerald-400', href: '/dashboard/payroll?status=Paid', tooltip: 'Total commission disbursed to all reps via payroll' },
    { label: 'Total Users', value: totalUsers.toString(), raw: totalUsers, format: (n: number) => n.toString(), icon: Users, accentHex: '#b47dff', accentGradient: 'from-purple-500 to-purple-400', href: '/dashboard/reps', tooltip: 'Number of active sales reps in the system' },
    { label: 'Total kW Sold', value: `${totalKWSold.toFixed(1)} kW`, raw: Math.round(totalKWSold * 10), format: (n: number) => `${(n / 10).toFixed(1)} kW`, icon: Zap, accentHex: '#00d4c8', accentGradient: 'from-teal-500 to-teal-400', href: '/dashboard/projects', tooltip: 'Total system size in kilowatts from all deals' },
    { label: 'Total kW Installed', value: `${totalKWInstalled.toFixed(1)} kW`, raw: Math.round(totalKWInstalled * 10), format: (n: number) => `${(n / 10).toFixed(1)} kW`, icon: Zap, accentHex: '#ff5252', accentGradient: 'from-red-500 to-red-400', href: '/dashboard/projects', tooltip: 'Kilowatts from projects with Installed or PTO status (Chargebacks row)' },
  ];

  const pipelineStats = [
    { label: 'Active Projects', value: activeCount, raw: activeCount, format: (n: number) => n.toString(), accentHex: '#00c4f0', accentGradient: 'from-blue-500 to-blue-400', href: '/dashboard/projects', tooltip: 'Projects currently in the pipeline (New through PTO)' },
    { label: 'Inactive Projects', value: inactiveCount, raw: inactiveCount, format: (n: number) => n.toString(), accentHex: '#525c72', accentGradient: 'from-blue-500 to-blue-400', href: '/dashboard/projects?phase=On+Hold', tooltip: 'Projects that are cancelled or on hold' },
    { label: 'Completed Projects', value: completedCount, raw: completedCount, format: (n: number) => n.toString(), accentHex: '#00e07a', accentGradient: 'from-emerald-500 to-emerald-400', href: '/dashboard/projects?phase=Completed', tooltip: 'Projects that have been fully completed' },
  ];

  // Inline pipeline phase hex colors for the segmented bar
  const PHASE_HEX: Record<string, string> = {
    'New': '#38bdf8', 'Acceptance': '#818cf8', 'Site Survey': '#a78bfa',
    'Design': '#e879f9', 'Permitting': '#fbbf24', 'Pending Install': '#fb923c',
    'Installed': '#2dd4bf', 'PTO': '#00c4f0',
  };
  const pipelineActive = allProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  const pipelinePhaseCounts = ACTIVE_PHASES.reduce<Record<string, number>>((acc, phase) => {
    acc[phase] = pipelineActive.filter((p) => p.phase === phase).length;
    return acc;
  }, {});
  const pipelineNonEmpty = ACTIVE_PHASES.filter((ph) => pipelinePhaseCounts[ph] > 0);
  const pipelineTotal = pipelineActive.length;

  // Attention items count (used for All Clear vs Needs Attention)
  const attentionActiveProjects = allProjects.filter((p) => ACTIVE_PHASES.includes(p.phase) || p.phase === 'On Hold');
  const PHASE_STUCK_THRESHOLDS_ADMIN = getPhaseStuckThresholds();
  const todayAdmin = new Date(); todayAdmin.setHours(0, 0, 0, 0);
  const attentionItemCount = (() => {
    let count = 0;
    for (const proj of attentionActiveProjects) {
      if (proj.flagged) count++;
    }
    for (const proj of attentionActiveProjects) {
      const threshold = PHASE_STUCK_THRESHOLDS_ADMIN[proj.phase];
      if (threshold == null) continue;
      const [y, m, d] = proj.soldDate.split('-').map(Number);
      const sold = new Date(y, m - 1, d);
      const diffDays = Math.floor((todayAdmin.getTime() - sold.getTime()) / 86_400_000);
      if (diffDays > threshold) count++;
    }
    for (const proj of attentionActiveProjects) {
      if (proj.phase === 'On Hold') count++;
    }
    return count;
  })();

  // GradCard color config for the 6 stat cards
  const gradCardConfig: Record<string, { color: string; grad: string }> = {
    'Kilo Revenue':      { color: '#00e07a', grad: 'linear-gradient(135deg, #00160d 0%, #001c10 100%)' },
    'Gross Profit':      { color: '#00c4f0', grad: 'linear-gradient(135deg, #000e16 0%, #001218 100%)' },
    'Total Paid Out':    { color: '#ffb020', grad: 'linear-gradient(135deg, #120b00 0%, #180e00 100%)' },
    'Total Users':       { color: '#b47dff', grad: 'linear-gradient(135deg, #0a061a 0%, #0e0820 100%)' },
    'Total kW Sold':     { color: '#00d4c8', grad: 'linear-gradient(135deg, #001210 0%, #001614 100%)' },
    'Total kW Installed': { color: '#8891a8', grad: 'linear-gradient(135deg, #101012 0%, #141416 100%)' },
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-[3px] w-12 rounded-full mb-3" style={{ background: 'linear-gradient(to right, #00e07a, #00c4f0)' }} />
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '2rem', color: '#f0f2f7', letterSpacing: '-0.03em' }}>Admin Dashboard</h1>
          <p className="text-sm font-medium mt-1 tracking-wide" style={{ color: '#525c72', fontFamily: "'DM Sans', sans-serif" }}>Overview of all reps and deals</p>
        </div>
        <div className="flex gap-1 bg-[#161920] border border-[#333849] rounded-xl p-1 tab-bar-container">
          {adminPeriodIndicator && <div className="tab-indicator" style={adminPeriodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { adminPeriodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors active:scale-[0.97] ${
                period === p.value
                  ? 'text-black'
                  : 'text-[#c2c8d8] hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick-action toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        {[
          { label: 'Run Payroll', color: '#00e07a', grad: 'linear-gradient(135deg, #00160d, #001c10)', icon: '\u25C8', href: '/dashboard/payroll' },
          { label: 'Add Rep', color: '#b47dff', grad: 'linear-gradient(135deg, #0a061a, #0e0820)', icon: '\u25CE', href: '/dashboard/reps' },
          { label: 'New Deal', color: '#00c4f0', grad: 'linear-gradient(135deg, #000e16, #001218)', icon: '\u2295', href: '/dashboard/new-deal' },
          { label: 'Settings', color: '#ffb020', grad: 'linear-gradient(135deg, #120b00, #180e00)', icon: '\u2699', href: '/dashboard/settings' },
        ].map(a => (
          <Link key={a.label} href={a.href} style={{
            display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center',
            background: a.grad, border: `1px solid ${a.color}35`, borderRadius: 12,
            padding: '11px 20px', color: a.color, fontSize: 13, fontWeight: 700,
            fontFamily: "'DM Sans', sans-serif",
            transition: 'all 0.2s', textDecoration: 'none',
          }}>
            <span style={{ fontSize: 16 }}>{a.icon}</span> {a.label}
          </Link>
        ))}
      </div>

      {/* Top 6 GradCard stats */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-4 mb-4">
        {topStats.map((stat) => {
          const gc = gradCardConfig[stat.label] ?? { color: stat.accentHex, grad: 'linear-gradient(135deg, #101012, #141416)' };
          return (
            <Link key={stat.label} href={stat.href} className="group cursor-pointer hover:scale-[1.02] transition-all duration-200 hover:translate-y-[-2px]" style={{ textDecoration: 'none' }}>
              <div style={{
                background: gc.grad,
                border: `1px solid ${gc.color}40`,
                borderRadius: 16,
                padding: '18px 18px 16px',
                position: 'relative',
                overflow: 'hidden',
                flex: 1,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${gc.color}, transparent 70%)` }} />
                <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${gc.color}15 0%, transparent 70%)` }} />
                <p style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8891a8', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, marginBottom: 14 }}>{stat.label}</p>
                <AnimatedStatValue raw={stat.raw} format={stat.format} style={{ fontSize: 36, fontWeight: 700, color: gc.color, fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em', textShadow: `0 0 20px ${gc.color}50` }} />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Pipeline stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {pipelineStats.map((s, i) => (
          <Link key={s.label} href={s.href} className={`group card-surface card-surface-stat rounded-2xl p-5 h-full cursor-pointer hover:border-[#00e07a]/30 hover:scale-[1.02] transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': `${s.accentHex}14` } as CSSProperties}>
            <div className="h-[2px] w-12 rounded-full mb-3" style={{ background: s.accentHex }} />
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium uppercase tracking-wider flex items-center gap-1" style={{ color: '#525c72', fontFamily: "'DM Sans', sans-serif" }}>
                {s.label}
                {'tooltip' in s && s.tooltip && (
                  <span className="relative group/tip">
                    <HelpCircle className="w-3 h-3 text-[#525c72] hover:text-[#c2c8d8] transition-colors cursor-help" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover/tip:block whitespace-normal w-48 rounded-lg bg-[#1d2028] border border-[#272b35]/60 px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-[#c2c8d8] shadow-xl leading-snug">
                      {s.tooltip}
                    </span>
                  </span>
                )}
              </p>
              <ChevronRight className="w-3.5 h-3.5 text-[#525c72] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <AnimatedStatValue raw={s.raw} format={s.format} className="stat-value text-3xl font-black tabular-nums animate-count-up" style={{ color: s.accentHex, fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em', textShadow: `0 0 20px ${s.accentHex}50` }} />
          </Link>
        ))}
      </div>

      {/* Pipeline Overview — inline segmented bar */}
      <div style={{ background: '#161920', border: '1px solid #272b35', borderRadius: 16, padding: '22px 26px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00e07a', boxShadow: '0 0 8px #00e07a', flexShrink: 0 }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#f0f2f7', fontFamily: "'DM Sans', sans-serif", margin: 0 }}>Pipeline Overview</h2>
          <span style={{ fontSize: 12, color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}>{pipelineTotal} active deal{pipelineTotal !== 1 ? 's' : ''}</span>
        </div>
        {pipelineTotal > 0 ? (
          <>
            <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
              {pipelineNonEmpty.map((phase) => (
                <div
                  key={phase}
                  style={{
                    width: `${(pipelinePhaseCounts[phase] / pipelineTotal) * 100}%`,
                    background: PHASE_HEX[phase] ?? '#525c72',
                    transition: 'width 0.7s ease-out',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
              {pipelineNonEmpty.map((phase) => (
                <Link key={phase} href={`/dashboard/projects?phase=${encodeURIComponent(phase)}`} style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: PHASE_HEX[phase] ?? '#525c72', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#c2c8d8', fontFamily: "'DM Sans', sans-serif" }}>{phase}</span>
                  <span style={{ fontSize: 12, color: '#8891a8', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>{pipelinePhaseCounts[phase]}</span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0', gap: 8 }}>
            <FolderKanban style={{ width: 32, height: 32, color: '#525c72' }} />
            <p style={{ color: '#f0f2f7', fontWeight: 700, fontSize: 14 }}>No active projects</p>
            <p style={{ color: '#525c72', fontSize: 12 }}>Your pipeline will appear here once you close a deal.</p>
          </div>
        )}
      </div>

      {/* Needs Attention / All Clear */}
      {attentionItemCount === 0 ? (
        <div style={{ background: '#161920', border: '1px solid #272b35', borderLeft: '3px solid #00e07a', borderRadius: 16, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(0,224,122,0.13)', border: '1px solid rgba(0,224,122,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle style={{ width: 16, height: 16, color: '#00e07a' }} />
          </div>
          <div>
            <p style={{ color: '#00e07a', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", margin: 0 }}>All Clear</p>
            <p style={{ color: '#8891a8', fontSize: 12, fontFamily: "'DM Sans', sans-serif", margin: 0 }}>No items need attention right now.</p>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          <NeedsAttentionSection
            activeProjects={attentionActiveProjects}
            isAdmin
            onUnflag={(projectId) => updateProject(projectId, { flagged: false })}
          />
        </div>
      )}

      {/* ── Installer Insights ────────────────────────────────────────────── */}
      {(() => {
        const installerMap = new Map<string, { deals: number; kW: number; cancelled: number }>();
        for (const p of allProjects) {
          const prev = installerMap.get(p.installer) ?? { deals: 0, kW: 0, cancelled: 0 };
          prev.deals++;
          prev.kW += p.kWSize;
          if (p.phase === 'Cancelled') prev.cancelled++;
          installerMap.set(p.installer, prev);
        }
        const installerRanking = [...installerMap.entries()]
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.deals - a.deals);
        const maxDeals = Math.max(1, ...installerRanking.map((i) => i.deals));

        return installerRanking.length > 0 ? (
          <div className="card-surface rounded-2xl p-5 mb-8">
            <button
              onClick={() => setInsightsExpanded(e => !e)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(245,158,11,0.15)' }}>
                <BarChart2 className="w-4 h-4 text-amber-400" />
              </div>
              <h2 className="text-white font-bold text-base tracking-tight flex-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>Installer Insights</h2>
              {insightsExpanded
                ? <ChevronUp className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
                : <ChevronDown className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
              }
            </button>
            <div className={`collapsible-panel ${insightsExpanded ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead className="table-header-frost">
                      <tr className="border-b border-[#333849]">
                        <th className="text-left px-4 py-2 text-[#c2c8d8] font-medium text-xs">Installer</th>
                        <th className="text-left px-4 py-2 text-[#c2c8d8] font-medium text-xs">Deals</th>
                        <th className="text-left px-4 py-2 text-[#c2c8d8] font-medium text-xs">Total kW</th>
                        <th className="text-left px-4 py-2 text-[#c2c8d8] font-medium text-xs">Cancelled</th>
                        <th className="text-left px-4 py-2 text-[#c2c8d8] font-medium text-xs w-40">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {installerRanking.map((inst, i) => (
                        <tr key={inst.name} className="border-b border-[#333849]/50 hover:bg-[#1d2028]/30 transition-colors">
                          <td className="px-4 py-2.5 text-white font-medium flex items-center gap-2">
                            {i < 3 && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full bg-gradient-to-br ${i === 0 ? 'from-yellow-400 to-amber-600' : i === 1 ? 'from-slate-300 to-slate-500' : 'from-amber-600 to-amber-800'} text-white`}>#{i + 1}</span>}
                            {inst.name}
                          </td>
                          <td className="px-4 py-2.5 text-[#c2c8d8] tabular-nums">{inst.deals}</td>
                          <td className="px-4 py-2.5 text-[#c2c8d8] tabular-nums">{inst.kW.toFixed(1)}</td>
                          <td className="px-4 py-2.5">
                            {inst.cancelled > 0 ? (
                              <span className="text-red-400 text-xs font-medium">{inst.cancelled}</span>
                            ) : (
                              <span className="text-[#525c72] text-xs">0</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="w-full h-3 rounded-full bg-[#1d2028] overflow-hidden">
                              <div className="h-full rounded-full bg-amber-500/70 transition-all duration-500" style={{ width: `${(inst.deals / maxDeals) * 100}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {/* ── Cancellation Reasons Summary ──────────────────────────────────── */}
      {(() => {
        const cancelledProjects = allProjects.filter((p) => p.phase === 'Cancelled');
        if (cancelledProjects.length === 0) return null;
        const reasonCounts = new Map<string, number>();
        for (const p of cancelledProjects) {
          const reason = (p as Project & { cancellationReason?: string }).cancellationReason || 'Not specified';
          reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
        }
        const reasonList = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
        return (
          <div className="card-surface rounded-2xl p-5 mb-8">
            <button
              onClick={() => setCancellationExpanded(e => !e)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}>
                <AlertCircle className="w-4 h-4 text-red-400" />
              </div>
              <h2 className="text-white font-bold text-base tracking-tight flex-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>Cancellation Reasons</h2>
              <span className="text-[#8891a8] text-xs mr-2">{cancelledProjects.length} cancelled</span>
              {cancellationExpanded
                ? <ChevronUp className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
                : <ChevronDown className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
              }
            </button>
            <div className={`collapsible-panel ${cancellationExpanded ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <div className="space-y-2 mt-4">
                  {reasonList.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between bg-[#1d2028]/40 rounded-lg px-4 py-2">
                      <span className="text-[#c2c8d8] text-sm">{reason}</span>
                      <span className="text-red-400 text-sm font-semibold tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recent projects */}
      {(() => {
        const searchFiltered = projects.filter((p) => {
          if (!recentSearch.trim()) return true;
          const q = recentSearch.trim().toLowerCase();
          return p.customerName.toLowerCase().includes(q) || p.repName.toLowerCase().includes(q);
        });
        const sorted = [...searchFiltered].sort((a, b) => {
          let cmp = 0;
          switch (sortKey) {
            case 'customerName': cmp = a.customerName.localeCompare(b.customerName); break;
            case 'installer': cmp = a.installer.localeCompare(b.installer); break;
            case 'kWSize': cmp = a.kWSize - b.kWSize; break;
            case 'netPPW': cmp = a.netPPW - b.netPPW; break;
            case 'phase': cmp = a.phase.localeCompare(b.phase); break;
            case 'soldDate': cmp = a.soldDate.localeCompare(b.soldDate); break;
          }
          return sortDir === 'asc' ? cmp : -cmp;
        });
        const totalPages = Math.max(1, Math.ceil(sorted.length / recentRowsPerPage));
        const safePage = Math.min(recentPage, totalPages);
        const startIdx = (safePage - 1) * recentRowsPerPage;
        const endIdx = Math.min(startIdx + recentRowsPerPage, sorted.length);
        const paginated = sorted.slice(startIdx, endIdx);
        const showM3 = allProjects.some((p) => (p.m3Amount ?? 0) > 0);
        const thCls = 'text-left px-6 py-3 text-[#c2c8d8] font-medium select-none cursor-pointer hover:text-white transition-colors';

        return (
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <button
            onClick={() => setRecentExpanded(e => !e)}
            className="flex items-center gap-2 text-left group"
          >
            <h2 className="text-white font-bold tracking-tight text-base" style={{ fontFamily: "'DM Sans', sans-serif" }}>Recent Projects</h2>
            {recentExpanded
              ? <ChevronUp className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
              : <ChevronDown className="w-4 h-4 text-[#c2c8d8] group-hover:text-white transition-colors" />
            }
          </button>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search customer or rep..."
              value={recentSearch}
              onChange={(e) => { setRecentSearch(e.target.value); setRecentPage(1); }}
              className="bg-[#1d2028] border border-[#272b35] text-white placeholder-slate-500 rounded-lg px-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-[#00e07a] transition-colors"
            />
            {recentSearch.trim() && (
              <span className="text-xs text-[#8891a8] bg-[#1d2028] px-2 py-0.5 rounded-full">{sorted.length} result{sorted.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <div className={`collapsible-panel ${recentExpanded ? 'open' : ''}`}>
          <div className="collapsible-inner">
            <div className="border-t border-[#333849]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                    <tr className="border-b border-[#333849]">
                      {/* 1 */}<th className={thCls} onClick={() => toggleSort('customerName')}>Customer<SortIcon col="customerName" /></th>
                      {/* 2 */}<th className="text-left px-6 py-3 text-[#c2c8d8] font-medium">Rep</th>
                      {/* 3 */}<th className={thCls} onClick={() => toggleSort('installer')}>Installer<SortIcon col="installer" /></th>
                      {/* 4 */}<th className={thCls} onClick={() => toggleSort('soldDate')}>Sold<SortIcon col="soldDate" /></th>
                      {/* 5 */}<th className={thCls} onClick={() => toggleSort('phase')}>Phase<SortIcon col="phase" /></th>
                      {/* 6 */}<th className={thCls} onClick={() => toggleSort('kWSize')}>kW<SortIcon col="kWSize" /></th>
                      {/* 7 */}<th className={thCls} onClick={() => toggleSort('netPPW')}>$/W<SortIcon col="netPPW" /></th>
                      {/* 8 */}<th className="text-left px-6 py-3 text-[#c2c8d8] font-medium">Est. Pay</th>
                      {/* 9 */}<th className="text-left px-6 py-3 text-[#c2c8d8] font-medium">M1</th>
                      {/* 10 */}<th className="text-left px-6 py-3 text-[#c2c8d8] font-medium">M2</th>
                      {/* 11 */}{showM3 && <th className="text-left px-6 py-3 text-[#c2c8d8] font-medium">M3</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((proj) => {
                      const estPay = (proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0);
                      return (
                      <tr key={proj.id} className="border-b border-[#333849]/50 even:bg-[#1d2028]/20 hover:bg-[#00e07a]/[0.03] transition-colors duration-150">
                        {/* 1 */}<td className="px-6 py-3">
                          <Link href={`/dashboard/projects/${proj.id}`} className="text-white hover:text-[#00e07a] transition-colors">{proj.customerName}</Link>
                          {proj.subDealerId && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">Sub-Dealer</span>}
                        </td>
                        {/* 2 */}<td className="px-6 py-3 text-[#c2c8d8] text-xs">{proj.subDealerName ?? proj.repName}{proj.setterName ? <span className="text-[#525c72]"> / {proj.setterName}</span> : ''}</td>
                        {/* 3 */}<td className="px-6 py-3 text-[#c2c8d8] text-xs whitespace-nowrap">{proj.installer}</td>
                        {/* 4 */}<td className="px-6 py-3 text-[#c2c8d8] text-xs whitespace-nowrap">{formatDate(proj.soldDate)}</td>
                        {/* 5 */}<td className="px-6 py-3"><PhaseBadge phase={proj.phase} /></td>
                        {/* 6 */}<td className="px-6 py-3 text-[#c2c8d8]">{proj.kWSize}</td>
                        {/* 7 */}<td className="px-6 py-3 text-[#c2c8d8]">${(proj.netPPW ?? 0).toFixed(2)}</td>
                        {/* 8 */}<td className="px-6 py-3 text-[#00e07a] font-medium">${estPay.toLocaleString()}</td>
                        {/* 9 */}<td className="px-6 py-3"><StatusDot paid={proj.m1Paid} amount={proj.m1Amount ?? 0} /></td>
                        {/* 10 */}<td className="px-6 py-3"><StatusDot paid={proj.m2Paid} amount={proj.m2Amount ?? 0} /></td>
                        {/* 11 */}{showM3 && <td className="px-6 py-3"><StatusDot paid={proj.phase === 'PTO'} amount={proj.m3Amount ?? 0} /></td>}
                      </tr>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={showM3 ? 11 : 10} className="px-6 py-10 text-center text-[#8891a8]">
                          No projects found for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {sorted.length > 0 && (
                <PaginationBar
                  totalResults={sorted.length}
                  startIdx={startIdx}
                  endIdx={endIdx}
                  currentPage={safePage}
                  totalPages={totalPages}
                  rowsPerPage={recentRowsPerPage}
                  onPageChange={setRecentPage}
                  onRowsPerPageChange={setRecentRowsPerPage}
                />
              )}
            </div>
          </div>
        </div>
      </div>
        );
      })()}
    </div>
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

function PhaseBadge({ phase }: { phase: string }) {
  const s = PHASE_PILL[phase] ?? { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-[#272b35]/30', shadow: '', text: 'text-[#c2c8d8]', dot: 'bg-[#8891a8]' };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {phase}
    </span>
  );
}

function StatusDot({ paid, amount }: { paid: boolean; amount: number }) {
  if (amount === 0) return <span className="text-[#525c72] text-xs">—</span>;
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
      paid ? 'bg-emerald-900/50 text-[#00e07a]' : 'bg-yellow-900/50 text-yellow-400'
    }`}>
      {paid ? fmt$(amount) : 'Unpaid'}
    </span>
  );
}

function MilestoneDot({ label, paid, amount }: { label: string; paid: boolean; amount: number }) {
  if (amount === 0) return <span className="text-[#525c72]">{label}</span>;
  const color = paid ? 'text-[#00e07a]' : 'text-yellow-400';
  const dotColor = paid ? 'bg-emerald-400' : 'bg-yellow-400';
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className={color}>{label} ${amount.toLocaleString()}</span>
    </span>
  );
}

// ─── Sub-Dealer Dashboard ────────────────────────────────────────────────────

function SubDealerDashboard({
  projects,
  allProjects,
  payroll,
  mentions,
  setMentions,
  period,
  setPeriod,
  PERIODS,
  currentRepId,
  currentRepName,
}: {
  projects: Project[];
  allProjects: Project[];
  payroll: ReturnType<typeof useApp>['payrollEntries'];
  mentions: MentionItem[];
  setMentions: React.Dispatch<React.SetStateAction<MentionItem[]>>;
  period: Period;
  setPeriod: (p: Period) => void;
  PERIODS: { value: Period; label: string }[];
  currentRepId: string | null;
  currentRepName: string | null;
}) {
  const periodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [periodIndicator, setPeriodIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const PERIOD_VALUES: Period[] = ['all', 'this-month', 'last-month', 'this-year'];
    const idx = PERIOD_VALUES.indexOf(period);
    const el = periodTabRefs.current[idx];
    if (el) setPeriodIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period]);

  // Filter to sub-dealer's own deals
  const myProjects = projects.filter((p) => p.subDealerId === currentRepId || p.repId === currentRepId);
  const myPayroll = payroll.filter((p) => p.repId === currentRepId);
  const activeProjects = myProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));

  // Stats
  const totalDeals = myProjects.length;
  const activePipeline = activeProjects.length;
  const totalKW = myProjects.reduce((sum, p) => sum + p.kWSize, 0);
  // Total Earned = M2 + M3 payroll only (sub-dealers don't get M1)
  const totalEarned = myPayroll
    .filter((e) => (e.paymentStage === 'M2' || e.paymentStage === 'M3') && e.status === 'Paid')
    .reduce((sum, e) => sum + e.amount, 0);

  const stats = [
    { label: 'Total Deals', value: totalDeals.toString(), icon: FolderKanban, color: 'text-[#00e07a]', accentGradient: 'from-blue-500 to-blue-400' },
    { label: 'Active Pipeline', value: activePipeline.toString(), icon: TrendingUp, color: 'text-purple-400', accentGradient: 'from-purple-500 to-purple-400' },
    { label: 'Total kW', value: `${totalKW.toFixed(1)} kW`, icon: Zap, color: 'text-yellow-400', accentGradient: 'from-yellow-500 to-yellow-400' },
    { label: 'Total Earned', value: fmt$(totalEarned), icon: DollarSign, color: 'text-[#00e07a]', accentGradient: 'from-emerald-500 to-emerald-400' },
  ];

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      {/* Welcome Banner */}
      <div className="card-surface rounded-2xl mb-6">
        <div className="px-6 py-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[#c2c8d8] text-sm font-medium tracking-wide mb-1">Welcome, {currentRepName}</p>
            <p className="text-2xl md:text-3xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em' }}>
              <span style={{ color: '#f0f2f7' }}>Sub-Dealer Dashboard</span>
            </p>
            <p className="text-[#8891a8] text-xs mt-1">Submit deals, track your pipeline and pay</p>
          </div>
          <div className="relative inline-flex shrink-0">
            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-[0.06] blur-[2px] animate-pulse" />
            <Link
              href="/dashboard/new-deal"
              className="relative inline-flex items-center gap-2.5 btn-primary text-black font-bold px-6 py-3 rounded-2xl text-sm"
            >
              <PlusCircle className="w-5 h-5" />
              Submit a Deal
            </Link>
          </div>
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex justify-end mb-6">
        <div className="flex gap-1 bg-[#161920] border border-[#333849] rounded-xl p-1 tab-bar-container">
          {periodIndicator && <div className="tab-indicator" style={periodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { periodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${
                period === p.value ? 'text-black font-bold' : 'text-[#c2c8d8] hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`card-surface card-surface-stat rounded-2xl p-5 h-full animate-slide-in-scale stagger-${i + 1}`}
              style={{ '--card-accent': ACCENT_COLOR_MAP[stat.accentGradient] ?? 'transparent' } as CSSProperties}
            >
              <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${stat.accentGradient}`} />
              <div className="flex items-center justify-between mb-3">
                <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider">{stat.label}</span>
                <Icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <p className={`stat-value text-3xl font-black tabular-nums tracking-tight ${stat.color}`}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* My Tasks — chatter check items assigned to this sub-dealer */}
      <MyTasksSection
        mentions={mentions}
        onToggleTask={(projectId, messageId, checkItemId, completed) => {
          fetch(`/api/projects/${projectId}/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkItemId, completed, completedBy: currentRepId }),
          }).then((res) => {
            if (!res.ok) return;
            setMentions((prev) =>
              prev.map((m) =>
                m.messageId === messageId
                  ? { ...m, checkItems: m.checkItems.map((ci) => ci.id === checkItemId ? { ...ci, completed: true } : ci) }
                  : m
              )
            );
          }).catch(() => {});
        }}
      />

      {/* Pipeline Overview */}
      {activeProjects.length > 0 && (
        <div className="card-surface rounded-2xl mb-6">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
              <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
                <FolderKanban className="w-4 h-4 text-[#00e07a]" />
              </div>
              <h2 className="text-white font-bold tracking-tight text-base">Pipeline Overview</h2>
            </div>
            <Link href="/dashboard/projects" className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors">
              View All &rarr;
            </Link>
          </div>
          <div className="divider-gradient-animated" />
          <div className="p-5">
            <PipelineOverview activeProjects={activeProjects} />
          </div>
        </div>
      )}

      {/* Recent Projects */}
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
            <div className="p-1.5 rounded-lg bg-[#00e07a]/15">
              <FolderKanban className="w-4 h-4 text-[#00e07a]" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">Recent Projects</h2>
          </div>
          <Link href="/dashboard/projects" className="text-[#00e07a] hover:text-[#00c4f0] text-xs transition-colors">
            View All &rarr;
          </Link>
        </div>
        <div className="divider-gradient-animated" />
        {myProjects.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-[#333849] rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[#1d2028]/80 flex items-center justify-center mx-auto mb-3">
                <FolderKanban className="w-6 h-6 text-[#525c72] animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No projects yet</p>
              <p className="text-[#8891a8] text-xs mb-4">Submit your first deal to see it here</p>
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
            {[...myProjects].sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 8).map((proj) => {
              const estPay = (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0);
              const soldLabel = (() => {
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
                  <div className="px-5 py-3.5 hover:bg-[#00e07a]/[0.03] transition-colors">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-white font-medium text-sm truncate group-hover:text-[#00c4f0] transition-colors">{proj.customerName}</span>
                        <PhaseBadge phase={proj.phase} />
                      </div>
                      <span className="text-[#8891a8] text-xs whitespace-nowrap flex-shrink-0">{soldLabel}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[#8891a8]">{proj.kWSize} kW</span>
                      <span className="text-[#525c72]">&middot;</span>
                      <span className="text-[#00e07a] font-semibold">${estPay.toLocaleString()}</span>
                      <div className="flex items-center gap-2.5 ml-auto">
                        <MilestoneDot label="M2" paid={proj.m2Paid} amount={proj.m2Amount ?? 0} />
                        {(proj.m3Amount ?? 0) > 0 && (
                          <MilestoneDot label="M3" paid={proj.phase === 'PTO'} amount={proj.m3Amount ?? 0} />
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
    </div>
  );
}

// ─── Skeleton components ──────────────────────────────────────────────────────

/** Column placeholder widths for the Rep "Recent Projects" table (7 cols). */
const DASH_TABLE_WIDTHS = ['w-36', 'w-14', 'w-20', 'w-10', 'w-16', 'w-14', 'w-14'] as const;

function SkeletonCell({ width, delay }: { width: string; delay: number }) {
  return (
    <td className="px-6 py-3">
      <div
        className={`h-4 ${width} bg-[#1d2028] rounded animate-skeleton`}
        style={{ animationDelay: `${delay}ms` }}
      />
    </td>
  );
}

function SkeletonRow({ index, cols }: { index: number; cols: readonly string[] }) {
  const delay = index * 75;
  return (
    <tr className="border-b border-[#333849]/50">
      {cols.map((w, ci) => (
        <SkeletonCell key={ci} width={w} delay={delay} />
      ))}
    </tr>
  );
}

function SkeletonCard({ index }: { index: number }) {
  const delay = index * 75;
  return (
    <div className="card-surface rounded-2xl p-5 h-full space-y-3">
      <div className="h-[2px] w-12 bg-[#272b35] rounded-full animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
        <div className="h-4 w-4 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      </div>
      <div className="h-8 w-24 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="h-3 w-20 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-[#1d2028] rounded animate-skeleton" />
          <div className="h-3 w-64 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-8 w-20 bg-[#1d2028] rounded-lg animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
          ))}
        </div>
      </div>

      {/* MTD mini-card */}
      <div className="card-surface rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-4 w-4 bg-[#1d2028] rounded animate-skeleton" />
          <div className="h-4 w-40 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-8 w-12 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
              <div className="h-3 w-20 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid — 5 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        {[...Array(5)].map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>

      {/* Recent Projects table */}
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 border-b border-[#333849]">
          <div className="h-5 w-36 bg-[#1d2028] rounded animate-skeleton" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header-frost">
              <tr className="border-b border-[#333849]">
                {DASH_TABLE_WIDTHS.map((_, i) => (
                  <th key={i} className="text-left px-6 py-3">
                    <div className="h-3 w-10 bg-[#1d2028]/60 rounded animate-skeleton" style={{ animationDelay: `${i * 40}ms` }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(3)].map((_, i) => (
                <SkeletonRow key={i} index={i} cols={DASH_TABLE_WIDTHS} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
