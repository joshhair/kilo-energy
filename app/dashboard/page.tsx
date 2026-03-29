'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../lib/context';
import { useIsHydrated, useScrollReveal } from '../../lib/hooks';
import { computeSparklineData, Sparkline } from '../../lib/sparkline';
import {
  computeIncentiveProgress, formatIncentiveMetric,
  getSolarTechBaseline, getProductCatalogBaseline, getInstallerRatesForDeal,
  Project, InstallerPricingVersion, ProductCatalogProduct, ACTIVE_PHASES,
} from '../../lib/data';
import { formatDate } from '../../lib/utils';
import { TrendingUp, TrendingDown, AlertCircle, DollarSign, CheckCircle, Zap, Users, BarChart2, Target, FolderKanban, Flag, Clock, ChevronRight, ChevronUp, ChevronDown, PlusCircle, Banknote, UserPlus, Settings, PauseCircle } from 'lucide-react';
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
  'PTO':             { bar: 'bg-emerald-500',  text: 'text-emerald-300', dot: 'bg-emerald-400', chipBg: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20',  chipBorder: 'border-emerald-700/30'  },
};

// ─── Needs Attention ──────────────────────────────────────────────────────────

type AttentionItem = {
  uid: string;
  projectId: string;
  customerName: string;
  kind: 'no-setter' | 'flagged' | 'stale' | 'on-hold';
  staleDays?: number;
  holdDays?: number;
  repName?: string;
};

function NeedsAttentionSection({
  activeProjects,
  isAdmin = false,
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
}) {
  const [sectionRef, sectionVisible] = useScrollReveal<HTMLDivElement>();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items: AttentionItem[] = [];

  for (const proj of activeProjects) {
    if (!proj.setterId) {
      items.push({
        uid: `no-setter-${proj.id}`,
        projectId: proj.id,
        customerName: proj.customerName,
        kind: 'no-setter',
        repName: proj.repName,
      });
    }
  }

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
    const [y, m, d] = proj.soldDate.split('-').map(Number);
    const sold = new Date(y, m - 1, d);
    const diffDays = Math.floor((today.getTime() - sold.getTime()) / 86_400_000);
    if (diffDays > 30) {
      items.push({
        uid: `stale-${proj.id}`,
        projectId: proj.id,
        customerName: proj.customerName,
        kind: 'stale',
        staleDays: diffDays,
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

  // Auto-collapse when more than 10 items need attention
  const [open, setOpen] = useState(items.length <= 10);

  const capped = items.slice(0, 5);
  const hasMore = items.length > 5;

  return (
    <div
      ref={sectionRef}
      className={`card-surface rounded-2xl mb-6 ${sectionVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors rounded-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-amber-500 to-amber-400" />
          <div className="p-1.5 rounded-lg bg-amber-500/15">
            <AlertCircle className="w-4 h-4 text-amber-400" />
          </div>
          <h2 className="text-white font-bold tracking-tight text-base">Needs Attention</h2>
          {items.length > 0 && (
            <span className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          )}
        </div>
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <>
          <div className="divider-gradient-animated" />

          {items.length === 0 ? (
            /* ── Empty / all-clear state ── */
            <div className="flex items-center gap-3 px-6 py-6">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-slate-300 text-sm">All clear! No items need attention right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {capped.map((item) => (
                <Link
                  key={item.uid}
                  href={`/dashboard/projects/${item.projectId}`}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-800/40 transition-colors group"
                >
                  {/* Kind icon */}
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      item.kind === 'no-setter'
                        ? 'bg-slate-700/60'
                        : item.kind === 'flagged'
                        ? 'bg-red-500/15'
                        : item.kind === 'on-hold'
                        ? 'bg-yellow-500/15'
                        : 'bg-amber-500/15'
                    }`}
                  >
                    {item.kind === 'no-setter' && <Users className="w-4 h-4 text-slate-400" />}
                    {item.kind === 'flagged' && <Flag className="w-4 h-4 text-red-400" />}
                    {item.kind === 'stale' && <Clock className="w-4 h-4 text-amber-400" />}
                    {item.kind === 'on-hold' && <PauseCircle className="w-4 h-4 text-yellow-400" />}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{item.customerName}</p>
                    <p className="text-slate-500 text-xs">
                      {item.kind === 'no-setter' && 'Self gen'}
                      {item.kind === 'flagged' && 'Flagged for review'}
                      {item.kind === 'stale' && `${item.staleDays} days in pipeline`}
                      {item.kind === 'on-hold' && `On hold ${item.holdDays} day${item.holdDays !== 1 ? 's' : ''}`}
                      {isAdmin && item.repName ? ` · ${item.repName}` : ''}
                    </p>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
                </Link>
              ))}

              {/* View all link when capped */}
              {hasMore && (
                <div className="px-6 py-3 flex items-center justify-between">
                  <span className="text-slate-500 text-xs">{items.length - 5} more item{items.length - 5 !== 1 ? 's' : ''} hidden</span>
                  <Link
                    href="/dashboard/projects"
                    className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
                  >
                    View all projects →
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}
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
      <div className="border border-dashed border-slate-800 rounded-2xl px-5 py-12 text-center">
        <FolderKanban className="w-8 h-8 text-slate-600 mx-auto mb-3" />
        <p className="text-white font-bold text-sm mb-1">No active projects — submit your first deal</p>
        <p className="text-slate-500 text-xs mt-1">Your pipeline will appear here once you close a deal.</p>
      </div>
    );
  }

  return (
    <>
      {/* Stacked bar — overflow-hidden clips segment edges cleanly at the rounded corners */}
      <div className="relative mb-4" ref={barRef}>
        <div className="flex h-8 rounded-xl bg-slate-800 overflow-hidden">
          {nonEmpty.map((phase) => {
            const count = phaseCounts[phase];
            const s = PIPELINE_PHASE_COLORS[phase] ?? { bar: 'bg-slate-500', text: '', dot: '', chipBg: '', chipBorder: '' };
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
            className="pointer-events-none absolute -top-8 bg-slate-800 border border-slate-700 text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap z-20 -translate-x-1/2"
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
          const s = PIPELINE_PHASE_COLORS[phase] ?? { bar: 'bg-slate-500', text: 'text-slate-300', dot: 'bg-slate-400', chipBg: '', chipBorder: '' };
          return (
            <Link
              key={phase}
              href={`/dashboard/projects?phase=${encodeURIComponent(phase)}`}
              className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-all hover:brightness-110 ${s.chipBg} ${s.chipBorder} ${s.text}`}
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
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400">
        —
      </span>
    );
  }

  if (pctChange > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
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
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400">
      —
    </span>
  );
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
  const { currentRole, currentRepId, currentRepName, projects, payrollEntries, incentives, reps, installerPricingVersions, productCatalogProducts } = useApp();
  useEffect(() => { document.title = 'Dashboard | Kilo Energy'; }, []);
  const [period, setPeriod] = useState<Period>('all');
  const periodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [periodIndicator, setPeriodIndicator] = useState<{ left: number; width: number } | null>(null);
  const isHydrated = useIsHydrated();
  const router = useRouter();

  // Scroll-triggered reveal refs for below-fold dashboard sections
  const [statsRef, statsVisible] = useScrollReveal<HTMLDivElement>();
  const [pipelineRef, pipelineVisible] = useScrollReveal<HTMLDivElement>();
  const [incentivesRef, incentivesVisible] = useScrollReveal<HTMLDivElement>();

  // Keyboard shortcuts (N/P/E/D) handled globally in layout.tsx

  const periodProjects = projects.filter((p) => isInPeriod(p.soldDate, period));
  const periodPayroll = payrollEntries.filter((p) => isInPeriod(p.date, period));

  const myProjects =
    currentRole === 'admin'
      ? periodProjects
      : periodProjects.filter((p) => p.repId === currentRepId || p.setterId === currentRepId);

  const myPayroll =
    currentRole === 'admin'
      ? periodPayroll
      : periodPayroll.filter((p) => p.repId === currentRepId);

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
    ? (currentRole === 'admin'
        ? prevPeriodProjects
        : prevPeriodProjects.filter((p) => p.repId === currentRepId || p.setterId === currentRepId))
    : [];
  const myPrevPayroll = hasPreviousPeriod
    ? (currentRole === 'admin'
        ? prevPeriodPayroll
        : prevPeriodPayroll.filter((p) => p.repId === currentRepId))
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
    (p) => (p.repId === currentRepId || p.setterId === currentRepId) && isThisMonth(p.soldDate)
  );
  const mtdPayrollCommission = payrollEntries
    .filter((p) => p.repId === currentRepId && isThisMonth(p.date))
    .reduce((s, p) => s + p.amount, 0);
  const mtdUnmatchedCommission = mtdProjects
    .filter((p) => !payrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((s, p) => s + (p.m1Amount ?? 0) + (p.m2Amount ?? 0), 0);
  const mtdCommission = mtdPayrollCommission + mtdUnmatchedCommission;

  // Animated count-up for the MTD commission hero — always called (hook rules)
  const animatedMtdCommission = useCountUp(mtdCommission, 1200);

  if (!isHydrated) {
    return <DashboardSkeleton />;
  }

  if (currentRole === 'admin') {
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
    const totalExpected = (p.m1Amount ?? 0) + (p.m2Amount ?? 0);
    const alreadyPaid = paidPayrollByProject.get(p.id) ?? 0;
    return sum + Math.max(0, totalExpected - alreadyPaid);
  }, 0);

  // "Total Estimated Pay" = unpaid payroll + expected amounts from projects not yet in payroll
  // (payrollProjectIds is hoisted above the isHydrated guard — already in scope)
  const unpaidPayroll = myPayroll.filter((p) => p.status !== 'Paid').reduce((sum, p) => sum + p.amount, 0);
  const unmatchedProjectPay = myProjects
    .filter((p) => !payrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((sum, p) => sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0), 0);
  const totalEstimatedPay = unpaidPayroll + unmatchedProjectPay;

  // Only count as "paid" once the pay date has actually passed
  const totalPaid = myPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr && p.amount > 0).reduce((sum, p) => sum + p.amount, 0);
  const totalChargebacks = Math.abs(myPayroll.filter((p) => p.amount < 0).reduce((sum, p) => sum + p.amount, 0));
  const chargebackCount = myPayroll.filter((p) => p.amount < 0).length;
  const totalKW = myProjects.reduce((sum, p) => sum + p.kWSize, 0);
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
    const totalExpected = (p.m1Amount ?? 0) + (p.m2Amount ?? 0);
    const alreadyPaid = prevPaidByProject.get(p.id) ?? 0;
    return sum + Math.max(0, totalExpected - alreadyPaid);
  }, 0);
  const prevPayrollProjectIds = new Set(myPrevPayroll.map((p) => p.projectId).filter(Boolean));
  const prevUnpaidPayroll = myPrevPayroll.filter((p) => p.status !== 'Paid').reduce((sum, p) => sum + p.amount, 0);
  const prevUnmatchedPay = myPrevProjects
    .filter((p) => !prevPayrollProjectIds.has(p.id) && p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((sum, p) => sum + (p.m1Amount ?? 0) + (p.m2Amount ?? 0), 0);
  const prevTotalEstimatedPay = prevUnpaidPayroll + prevUnmatchedPay;
  const prevTotalPaid = myPrevPayroll.filter((p) => p.status === 'Paid' && p.date <= todayStr).reduce((sum, p) => sum + p.amount, 0);
  const prevTotalKW = myPrevProjects.reduce((sum, p) => sum + p.kWSize, 0);
  const prevTotalKWInstalled = myPrevProjects.filter((p) => installedPhases.includes(p.phase)).reduce((sum, p) => sum + p.kWSize, 0);

  // Sparkline data for the five stat cards — last 7 unique dates, summed per day
  const pipelineSparkData   = computeSparklineData(activeProjects.map((p) => ({ date: p.soldDate, amount: (p.m1Amount ?? 0) + (p.m2Amount ?? 0) })));
  const chargebackSparkData: number[] = []; // flat / empty — no chargeback data yet
  const estPaySparkData     = computeSparklineData(myPayroll.filter((p) => p.status !== 'Paid').map((p) => ({ date: p.date, amount: p.amount })));
  const paidSparkData       = computeSparklineData(myPayroll.filter((p) => p.status === 'Paid').map((p) => ({ date: p.date, amount: p.amount })));
  const systemSizeSparkData = computeSparklineData(myProjects.map((p) => ({ date: p.soldDate, amount: p.kWSize })));
  const installedSparkData = computeSparklineData(myProjects.filter((p) => installedPhases.includes(p.phase)).map((p) => ({ date: p.soldDate, amount: p.kWSize })));

  const thisWeekPayroll = payrollEntries.filter(
    (p) => p.repId === currentRepId && isThisWeek(p.date) && p.status !== 'Paid'
  );
  const thisWeekTotal = thisWeekPayroll.reduce((s, p) => s + p.amount, 0);

  // MTD deal count + kW — derived from mtdProjects, which is hoisted above the isHydrated guard
  const mtdDeals = mtdProjects.length;
  const mtdKW = mtdProjects.reduce((s, p) => s + p.kWSize, 0);

  // All-time denominators used for MTD ring-chart ratios (period-independent)
  const allTimeDeals = projects.filter(
    (p) => p.repId === currentRepId || p.setterId === currentRepId
  ).length;
  const allTimeKW = projects
    .filter((p) => p.repId === currentRepId || p.setterId === currentRepId)
    .reduce((s, p) => s + p.kWSize, 0);
  const allTimeEstPay = myProjects
    .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
    .reduce((s, p) => s + (p.m1Amount ?? 0) + (p.m2Amount ?? 0), 0);

  // Circumference for the 48×48 SVG ring (r=20): 2π×20 ≈ 125.66
  const RING_CIRC = 125.66;

  // Next Payout: all Pending + Paid entries dated for the upcoming Friday.
  // "Paid" here means admin published the payroll — money hits on the date.
  const nextFridayDate = (() => {
    const today = new Date();
    const d = ((5 - today.getDay() + 7) % 7) || 7;
    const nf = new Date(today);
    nf.setDate(today.getDate() + d);
    return nf.toISOString().split('T')[0];
  })();
  const pendingPayrollTotal = payrollEntries
    .filter((p) => p.repId === currentRepId && p.date === nextFridayDate && (p.status === 'Pending' || p.status === 'Paid'))
    .reduce((sum, p) => sum + p.amount, 0);

  // Calculate label for next Friday (if today is Friday, show next week's Friday)
  const daysUntilPayday = (() => {
    const today = new Date();
    return ((5 - today.getDay() + 7) % 7) || 7;
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
    (i) => i.active && (i.type === 'company' || (i.type === 'personal' && i.targetRepId === currentRepId))
  );

  const stats = [
    {
      label: 'In Pipeline',
      value: `$${inPipeline.toLocaleString()}`,
      sub: `${activeProjects.length} active projects`,
      icon: TrendingUp,
      color: 'text-blue-400',
      gradient: 'text-gradient-brand',
      accentGradient: 'from-blue-500 to-blue-400',
      glowClass: 'stat-glow-blue',
      sparkData: pipelineSparkData,
      sparkStroke: '#3b82f6',
      pctChange: computePctChange(inPipeline, prevInPipeline),
    },
    {
      label: 'Chargebacks',
      value: `$${totalChargebacks.toLocaleString()}`,
      sub: chargebackCount > 0 ? `${chargebackCount} chargeback${chargebackCount === 1 ? '' : 's'}` : 'No chargebacks',
      icon: AlertCircle,
      color: 'text-red-400',
      accentGradient: 'from-red-500 to-red-400',
      glowClass: 'stat-glow-red',
      sparkData: chargebackSparkData,
      sparkStroke: '#ef4444',
      pctChange: undefined as number | null | undefined,
    },
    {
      label: 'kW Sold',
      value: `${totalKWSold.toFixed(1)} kW`,
      sub: `${myProjects.length} projects`,
      icon: Zap,
      color: 'text-yellow-400',
      accentGradient: 'from-yellow-500 to-yellow-400',
      glowClass: 'stat-glow-yellow',
      sparkData: systemSizeSparkData,
      sparkStroke: '#eab308',
      pctChange: computePctChange(totalKW, prevTotalKW),
    },
    {
      label: 'kW Installed',
      value: `${totalKWInstalled.toFixed(1)} kW`,
      sub: `${myProjects.filter((p) => installedPhases.includes(p.phase)).length} installed`,
      icon: Zap,
      color: 'text-emerald-400',
      accentGradient: 'from-emerald-500 to-emerald-400',
      glowClass: 'stat-glow-emerald',
      sparkData: installedSparkData,
      sparkStroke: '#10b981',
      pctChange: computePctChange(totalKWInstalled, prevTotalKWInstalled),
    },
    {
      label: 'Paid',
      value: `$${totalPaid.toLocaleString()}`,
      sub: 'Deposited',
      icon: CheckCircle,
      color: 'text-emerald-400',
      accentGradient: 'from-emerald-500 to-emerald-400',
      glowClass: 'stat-glow-emerald',
      sparkData: paidSparkData,
      sparkStroke: '#10b981',
      pctChange: computePctChange(totalPaid, prevTotalPaid),
    },
  ];

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">

      {/* ── Welcome Banner with Glow CTA ─────────────────────────────────── */}
      <div className="card-surface rounded-2xl mb-6">
        <div className="px-6 py-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-slate-400 text-sm font-medium tracking-wide mb-1">Welcome, {currentRepName}</p>
            <p className="text-2xl md:text-3xl font-black tracking-tight">
              <span className="text-gradient-brand">Next Payout:</span> <span className="text-gradient-emerald">${pendingPayrollTotal.toLocaleString()}</span>
            </p>
            <p className="text-slate-500 text-xs mt-1 flex items-center gap-2">
              {nextFridayLabel}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${daysUntilPayday <= 2 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-slate-700/50 text-slate-400 border border-slate-600/30'}`}>
                {paydayCountdownLabel}
              </span>
            </p>
          </div>

          <div className="relative inline-flex shrink-0">
            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 opacity-[0.06] blur-[2px] animate-pulse" />
            <Link
              href="/dashboard/new-deal"
              className="relative inline-flex items-center gap-2.5 btn-primary text-white font-bold px-6 py-3 rounded-2xl text-sm"
            >
              <PlusCircle className="w-5 h-5" />
              Submit a Deal
            </Link>
          </div>
        </div>
      </div>

      {/* Period tabs — compact row, flush right */}
      <div className="flex justify-end mb-6">
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 tab-bar-container">
          {periodIndicator && <div className="tab-indicator" style={periodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { periodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${
                period === p.value
                  ? 'text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Next Payout shown in welcome banner above — no duplicate needed */}

      {/* MTD ring charts removed — financial detail lives in the Vault */}

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
              <rect x="4" y="14" width="52" height="32" rx="3" fill="#1e3a5f" stroke="#334155" strokeWidth="1.5" />
              {/* Grid lines — horizontal */}
              <line x1="4" y1="25" x2="56" y2="25" stroke="#334155" strokeWidth="1" />
              <line x1="4" y1="36" x2="56" y2="36" stroke="#334155" strokeWidth="1" />
              {/* Grid lines — vertical */}
              <line x1="21" y1="14" x2="21" y2="46" stroke="#334155" strokeWidth="1" />
              <line x1="38" y1="14" x2="38" y2="46" stroke="#334155" strokeWidth="1" />
              {/* Cell shimmer fills */}
              <rect x="5" y="15" width="15" height="10" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="22" y="15" width="15" height="10" rx="1" fill="#2563eb" fillOpacity="0.5" />
              <rect x="39" y="15" width="16" height="10" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="5" y="26" width="15" height="10" rx="1" fill="#2563eb" fillOpacity="0.5" />
              <rect x="22" y="26" width="15" height="10" rx="1" fill="#3b82f6" fillOpacity="0.45" />
              <rect x="39" y="26" width="16" height="10" rx="1" fill="#2563eb" fillOpacity="0.5" />
              <rect x="5" y="37" width="15" height="8" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              <rect x="22" y="37" width="15" height="8" rx="1" fill="#2563eb" fillOpacity="0.5" />
              <rect x="39" y="37" width="16" height="8" rx="1" fill="#1d4ed8" fillOpacity="0.4" />
              {/* Mount legs */}
              <line x1="20" y1="46" x2="16" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              <line x1="40" y1="46" x2="44" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              <line x1="13" y1="55" x2="47" y2="55" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
              {/* Plus badge — top-right corner */}
              <circle cx="49" cy="15" r="9" fill="#0f172a" />
              <circle cx="49" cy="15" r="8" fill="#2563eb" />
              <line x1="49" y1="10" x2="49" y2="20" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="44" y1="15" x2="54" y2="15" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          <div className="space-y-2 max-w-sm">
            <h2 className="text-2xl font-black text-white tracking-tight">Submit your first deal</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Once you close a deal, your pipeline, commissions, and earnings will appear here.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              href="/dashboard/new-deal"
              className="btn-primary inline-flex items-center gap-2 text-white font-semibold px-6 py-3 rounded-xl text-sm whitespace-nowrap"
            >
              <PlusCircle className="w-4 h-4" />
              Submit Your First Deal
            </Link>
            <Link
              href="/dashboard/calculator"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 text-sm font-medium transition-colors"
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
            className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6 ${statsVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
          >
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className={`card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': ACCENT_COLOR_MAP[stat.accentGradient] ?? 'transparent' } as CSSProperties}>
                  <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${stat.accentGradient}`} />
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{stat.label}</span>
                    <Icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <p className={`stat-value stat-value-glow ${stat.glowClass} text-3xl font-black tabular-nums tracking-tight animate-count-up ${'gradient' in stat && stat.gradient ? stat.gradient : stat.color}`}>{stat.value}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-slate-500 text-xs">{stat.sub}</p>
                    <TrendBadge pctChange={stat.pctChange} />
                  </div>
                  <Sparkline data={stat.sparkData} stroke={stat.sparkStroke} />
                </div>
              );
            })}
          </div>

          {/* Needs Attention */}
          <NeedsAttentionSection
            activeProjects={projects.filter(
              (p) =>
                (p.repId === currentRepId || p.setterId === currentRepId) &&
                ACTIVE_PHASES.includes(p.phase)
            )}
          />

          {/* Pipeline Overview */}
          <div
            ref={pipelineRef}
            className={`card-surface rounded-2xl mb-6 ${pipelineVisible ? 'scroll-reveal-visible' : 'scroll-reveal-hidden'}`}
          >
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-[2px] w-8 rounded-full bg-gradient-to-r from-blue-500 to-blue-400" />
                <div className="p-1.5 rounded-lg bg-blue-500/15">
                  <FolderKanban className="w-4 h-4 text-blue-400" />
                </div>
                <h2 className="text-white font-bold tracking-tight text-base">Pipeline Overview</h2>
              </div>
              <Link href="/dashboard/projects" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
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
      <div className="hidden md:flex items-center gap-6 bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5 mb-6 select-none">
        {[
          { key: 'N', label: 'New Deal' },
          { key: 'P', label: 'Projects' },
          { key: 'E', label: 'Earnings' },
          { key: '⌘K', label: 'Search' },
        ].map(({ key, label }) => (
          <span key={key} className="inline-flex items-center gap-2">
            <kbd className="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-1.5 py-0.5 rounded font-mono">
              {key}
            </kbd>
            <span className="text-slate-500 text-xs">{label}</span>
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
              <div className="p-1.5 rounded-lg bg-blue-500/15">
                <Target className="w-4 h-4 text-blue-400" />
              </div>
              <h2 className="text-white font-bold tracking-tight text-base">Active Incentives</h2>
            </div>
            <Link href="/dashboard/incentives" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
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
                <div key={incentive.id} className="bg-slate-800/50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-medium">{incentive.title}</p>
                      {incentive.type === 'personal' && (
                        <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">Personal</span>
                      )}
                    </div>
                    <p className="text-blue-400 font-bold text-sm">{formatIncentiveMetric(incentive.metric, progress)}</p>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1.5 mb-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#2563eb,#3b82f6)',
                      }}
                    />
                  </div>
                  {nextMilestone && (
                    <p className="text-slate-500 text-xs">
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
            <div className="p-1.5 rounded-lg bg-emerald-500/15">
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">This Week&apos;s Pay</h2>
          </div>
          <div className="flex items-center gap-3">
            {thisWeekTotal > 0 && (
              <span className="text-emerald-400 font-bold">${thisWeekTotal.toLocaleString()}</span>
            )}
            <Link href="/dashboard/earnings" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
              View All →
            </Link>
          </div>
        </div>
        <div className="divider-gradient-animated" />
        {thisWeekPayroll.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-slate-800 rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto mb-3">
                <DollarSign className="w-6 h-6 text-slate-600 animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No payments this week</p>
              <p className="text-slate-500 text-xs mb-4">Payments will appear here once marked for payroll.</p>
              <Link
                href="/dashboard/earnings"
                className="btn-primary inline-flex items-center gap-2 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                View Earnings History
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
              <tr className="border-b border-slate-800">
                <th className="text-left px-6 py-3 text-slate-400 font-medium text-xs">Customer</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium text-xs">Stage</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium text-xs">Amount</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium text-xs">Date</th>
              </tr>
            </thead>
            <tbody>
              {thisWeekPayroll.map((entry) => (
                <tr key={entry.id} className="relative border-b border-slate-800/50 even:bg-slate-800/[0.15] hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                  <td className="px-6 py-3 text-slate-300">{entry.customerName || '—'}</td>
                  <td className="px-6 py-3">
                    <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded font-medium">
                      {entry.paymentStage}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-emerald-400 font-semibold">${entry.amount.toLocaleString()}</td>
                  <td className="px-6 py-3 text-slate-500 text-xs">{entry.date}</td>
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
            <div className="p-1.5 rounded-lg bg-blue-500/15">
              <FolderKanban className="w-4 h-4 text-blue-400" />
            </div>
            <h2 className="text-white font-bold tracking-tight text-base">Recent Projects</h2>
          </div>
          <Link href="/dashboard/projects" className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
            View All →
          </Link>
        </div>
        <div className="divider-gradient-animated" />
        {myProjects.length === 0 ? (
          <div className="mx-6 my-6 border border-dashed border-slate-800 rounded-2xl px-5 py-12 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto mb-3">
                <FolderKanban className="w-6 h-6 text-slate-600 animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm mb-1">No projects yet</p>
              <p className="text-slate-500 text-xs mb-4">Submit your first deal to see it here</p>
              <Link
                href="/dashboard/new-deal"
                className="btn-primary inline-flex items-center gap-2 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                + New Deal
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                <tr className="border-b border-slate-800">
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">Customer</th>
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">Sold</th>
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">Phase</th>
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">kW</th>
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">Est. Pay</th>
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">M1</th>
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">M2</th>
                  {[...myProjects].sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 8).some((p) => (p.m3Amount ?? 0) > 0) && (
                    <th className="text-left px-6 py-3 text-slate-400 font-medium">M3</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sorted = [...myProjects].sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 8);
                  const showM3 = sorted.some((p) => (p.m3Amount ?? 0) > 0);
                  return sorted.map((proj) => (
                  <tr key={proj.id} className="relative border-b border-slate-800/50 even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                    <td className="px-6 py-3">
                      <Link
                        href={`/dashboard/projects/${proj.id}`}
                        className="text-white hover:text-blue-400 transition-colors"
                      >
                        {proj.customerName}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-400 text-xs whitespace-nowrap">{(() => {
                      const [y, m, d] = proj.soldDate.split('-').map(Number);
                      const sold = new Date(y, m - 1, d);
                      const now = new Date();
                      const diff = Math.floor((now.getTime() - sold.getTime()) / 86_400_000);
                      if (diff < 1) return 'Today';
                      if (diff === 1) return '1d ago';
                      if (diff < 7) return `${diff}d ago`;
                      if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
                      return sold.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    })()}</td>
                    <td className="px-6 py-3"><PhaseBadge phase={proj.phase} /></td>
                    <td className="px-6 py-3 text-slate-300">{proj.kWSize}</td>
                    <td className="px-6 py-3 text-blue-400 font-medium">
                      ${(proj.m1Amount + proj.m2Amount).toLocaleString()}
                    </td>
                    <td className="px-6 py-3"><StatusDot paid={proj.m1Paid} amount={proj.m1Amount} /></td>
                    <td className="px-6 py-3"><StatusDot paid={proj.m2Paid} amount={proj.m2Amount} /></td>
                    {showM3 && (
                      <td className="px-6 py-3"><StatusDot paid={proj.phase === 'PTO'} amount={proj.m3Amount ?? 0} /></td>
                    )}
                  </tr>
                  ));
                })()}
              </tbody>
            </table>
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
  // Search filter for Recent Projects table
  const [recentSearch, setRecentSearch] = useState('');

  // Sort & pagination for Recent Projects table
  type SortKey = 'customerName' | 'kWSize' | 'netPPW' | 'phase' | 'soldDate';
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
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 text-slate-600 inline ml-1" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-400 inline ml-1" />
      : <ChevronDown className="w-3 h-3 text-blue-400 inline ml-1" />;
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

  // Revenue = closer baseline × kW × 1000 (what Kilo takes in per deal from the installer)
  // Profit  = (closerPerW − kiloPerW) × kW × 1000 (Kilo's margin per deal)
  const { totalRevenue, totalProfit } = projects.reduce(
    (acc, p) => {
      const { closerPerW, kiloPerW } = getProjectBaselines(p);
      const watts = p.kWSize * 1000;
      acc.totalRevenue += closerPerW * watts;
      acc.totalProfit  += (closerPerW - kiloPerW) * watts;
      return acc;
    },
    { totalRevenue: 0, totalProfit: 0 }
  );

  const totalPaid = payroll.filter((p) => p.status === 'Paid').reduce((s, p) => s + p.amount, 0);
  const totalKWSold = projects.reduce((s, p) => s + p.kWSize, 0);
  const totalKWInstalled = projects.filter((p) => p.phase === 'PTO' || p.phase === 'Installed').reduce((s, p) => s + p.kWSize, 0);
  const totalUsers = totalReps;

  const activeCount = projects.filter((p) => ['New','Acceptance','Site Survey','Design','Permitting','Pending Install','Installed','PTO'].includes(p.phase)).length;
  const inactiveCount = projects.filter((p) => ['Cancelled','On Hold'].includes(p.phase)).length;
  const completedCount = projects.filter((p) => p.phase === 'Completed').length;

  const topStats = [
    { label: 'Kilo Revenue', value: `$${Math.round(totalRevenue).toLocaleString()}`, icon: DollarSign, color: 'text-blue-400', accentGradient: 'from-blue-500 to-blue-400' },
    { label: 'Gross Profit', value: `$${Math.round(totalProfit).toLocaleString()}`, icon: BarChart2, color: totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400', accentGradient: totalProfit >= 0 ? 'from-emerald-500 to-emerald-400' : 'from-red-500 to-red-400' },
    { label: 'Total Paid Out', value: `$${Math.round(totalPaid).toLocaleString()}`, icon: CheckCircle, color: 'text-yellow-400', accentGradient: 'from-yellow-500 to-yellow-400' },
    { label: 'Total Users', value: totalUsers.toString(), icon: Users, color: 'text-purple-400', accentGradient: 'from-purple-500 to-purple-400' },
    { label: 'Total kW Sold', value: `${totalKWSold.toFixed(1)} kW`, icon: Zap, color: 'text-sky-400', accentGradient: 'from-blue-500 to-blue-400' },
    { label: 'Total kW Installed', value: `${totalKWInstalled.toFixed(1)} kW`, icon: Zap, color: 'text-amber-400', accentGradient: 'from-amber-500 to-amber-400' },
  ];

  const pipelineStats = [
    { label: 'Active Projects', value: activeCount, color: 'text-blue-400', accentGradient: 'from-blue-500 to-blue-400' },
    { label: 'Inactive Projects', value: inactiveCount, color: 'text-slate-400', accentGradient: 'from-blue-500 to-blue-400' },
    { label: 'Completed Projects', value: completedCount, color: 'text-emerald-400', accentGradient: 'from-emerald-500 to-emerald-400' },
  ];

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Admin Dashboard</h1>
          <p className="text-slate-400 text-sm font-medium mt-1 tracking-wide">Overview of all reps and deals</p>
        </div>
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 tab-bar-container">
          {adminPeriodIndicator && <div className="tab-indicator" style={adminPeriodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { adminPeriodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${
                period === p.value
                  ? 'text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick-action toolbar */}
      <div className="flex gap-3 mb-6">
        {[
          { label: 'Run Payroll', href: '/dashboard/payroll', icon: Banknote, accent: 'from-emerald-500 to-emerald-400' },
          { label: 'Add Rep', href: '/dashboard/reps', icon: UserPlus, accent: 'from-purple-500 to-purple-400' },
          { label: 'New Deal', href: '/dashboard/new-deal', icon: PlusCircle, accent: 'from-blue-500 to-blue-400' },
          { label: 'Settings', href: '/dashboard/settings', icon: Settings, accent: 'from-yellow-500 to-yellow-400' },
        ].map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.label}
              href={action.href}
              className="card-surface rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-sm font-medium text-slate-300 hover:text-white transition-all duration-200 hover:translate-y-[-1px] active:scale-[0.97]"
              style={{ '--card-accent': ACCENT_COLOR_MAP[action.accent] ?? 'transparent' } as CSSProperties}
            >
              <div className={`p-1.5 rounded-lg bg-gradient-to-r ${action.accent} bg-opacity-15`} style={{ backgroundColor: (ACCENT_COLOR_MAP[action.accent] ?? 'transparent').replace('0.08', '0.15') }}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
              {action.label}
            </Link>
          );
        })}
      </div>

      {/* Top 6 stats */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-4 mb-4">
        {topStats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className={`card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': ACCENT_COLOR_MAP[stat.accentGradient] ?? 'transparent' } as CSSProperties}>
              <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${stat.accentGradient}`} />
              <div className="flex items-center justify-between mb-3">
                <span className="text-slate-400 text-xs font-medium uppercase tracking-wider leading-tight">{stat.label}</span>
                <Icon className={`w-4 h-4 ${stat.color} shrink-0`} />
              </div>
              <p className={`stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up ${'gradient' in stat && stat.gradient ? stat.gradient : stat.color}`}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Pipeline stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {pipelineStats.map((s, i) => (
          <div key={s.label} className={`card-surface card-surface-stat rounded-2xl p-5 h-full transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': ACCENT_COLOR_MAP[s.accentGradient] ?? 'transparent' } as CSSProperties}>
            <div className={`h-[2px] w-12 rounded-full bg-gradient-to-r mb-3 ${s.accentGradient}`} />
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">{s.label}</p>
            <p className={`stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline Overview — stacked bar + phase chips */}
      <div className="card-surface rounded-2xl p-5 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'rgba(59,130,246,0.15)' }}>
            <FolderKanban className="w-4 h-4 text-blue-400" />
          </div>
          <h2 className="text-white font-bold text-base tracking-tight">Pipeline Overview</h2>
        </div>
        <PipelineOverview activeProjects={allProjects.filter((p) => ACTIVE_PHASES.includes(p.phase))} />
      </div>

      {/* Needs Attention — all active projects across every rep */}
      <NeedsAttentionSection
        activeProjects={allProjects.filter((p) => ACTIVE_PHASES.includes(p.phase))}
        isAdmin
      />

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
        const showM3 = projects.some((p) => (p.m3Amount ?? 0) > 0);
        const thCls = 'text-left px-6 py-3 text-slate-400 font-medium select-none cursor-pointer hover:text-white transition-colors';

        return (
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <h2 className="text-white font-bold tracking-tight text-base">Recent Projects</h2>
          <input
            type="text"
            placeholder="Search customer or rep..."
            value={recentSearch}
            onChange={(e) => { setRecentSearch(e.target.value); setRecentPage(1); }}
            className="bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-lg px-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header-frost after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
              <tr className="border-b border-slate-800">
                <th className={thCls} onClick={() => toggleSort('customerName')}>Customer<SortIcon col="customerName" /></th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium">Rep</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium">Setter</th>
                <th className={thCls} onClick={() => toggleSort('soldDate')}>Sold<SortIcon col="soldDate" /></th>
                <th className={thCls} onClick={() => toggleSort('phase')}>Phase<SortIcon col="phase" /></th>
                <th className={thCls} onClick={() => toggleSort('kWSize')}>kW<SortIcon col="kWSize" /></th>
                <th className={thCls} onClick={() => toggleSort('netPPW')}>Sold $/W<SortIcon col="netPPW" /></th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium">Kilo Rev</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium">Profit</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium">M1</th>
                <th className="text-left px-6 py-3 text-slate-400 font-medium">M2</th>
                {showM3 && (
                  <th className="text-left px-6 py-3 text-slate-400 font-medium">M3</th>
                )}
              </tr>
            </thead>
            <tbody>
                  {paginated.map((proj) => (
                <tr key={proj.id} className="relative border-b border-slate-800/50 even:bg-slate-800/20 hover:bg-blue-500/[0.03] transition-colors duration-150 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-blue-500 before:rounded-full before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-200 before:origin-center">
                  <td className="px-6 py-3">
                    <Link
                      href={`/dashboard/projects/${proj.id}`}
                      className="text-white hover:text-blue-400 transition-colors"
                    >
                      {proj.customerName}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-slate-400">{proj.repName}</td>
                  <td className="px-6 py-3 text-slate-500 text-xs">{proj.setterName ?? <span className="italic text-slate-600">self-gen</span>}</td>
                  <td className="px-6 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDate(proj.soldDate)}</td>
                  <td className="px-6 py-3"><PhaseBadge phase={proj.phase} /></td>
                  <td className="px-6 py-3 text-slate-300">{proj.kWSize}</td>
                  <td className="px-6 py-3 text-slate-400">${proj.netPPW.toFixed(2)}</td>
                  {(() => {
                    const { closerPerW, kiloPerW } = getProjectBaselines(proj);
                    const watts = proj.kWSize * 1000;
                    return (
                      <>
                        <td className="px-6 py-3 text-blue-400 font-medium">
                          ${Math.round(closerPerW * watts).toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-emerald-400 font-medium">
                          ${Math.round((closerPerW - kiloPerW) * watts).toLocaleString()}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-6 py-3"><StatusDot paid={proj.m1Paid} amount={proj.m1Amount} /></td>
                  <td className="px-6 py-3"><StatusDot paid={proj.m2Paid} amount={proj.m2Amount} /></td>
                  {showM3 && (
                    <td className="px-6 py-3"><StatusDot paid={proj.phase === 'PTO'} amount={proj.m3Amount ?? 0} /></td>
                  )}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={showM3 ? 12 : 11} className="px-6 py-10 text-center text-slate-500">
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
        );
      })()}
    </div>
  );
}

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
  const s = PHASE_PILL[phase] ?? { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20', border: 'border-slate-600/30', shadow: '', text: 'text-slate-300', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {phase}
    </span>
  );
}

function StatusDot({ paid, amount }: { paid: boolean; amount: number }) {
  if (amount === 0) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
      paid ? 'bg-emerald-900/50 text-emerald-400' : 'bg-yellow-900/50 text-yellow-400'
    }`}>
      {paid ? `$${amount.toLocaleString()}` : 'Unpaid'}
    </span>
  );
}

// ─── Skeleton components ──────────────────────────────────────────────────────

/** Column placeholder widths for the Rep "Recent Projects" table (7 cols). */
const DASH_TABLE_WIDTHS = ['w-36', 'w-14', 'w-20', 'w-10', 'w-16', 'w-14', 'w-14'] as const;

function SkeletonCell({ width, delay }: { width: string; delay: number }) {
  return (
    <td className="px-6 py-3">
      <div
        className={`h-4 ${width} bg-slate-800 rounded animate-skeleton`}
        style={{ animationDelay: `${delay}ms` }}
      />
    </td>
  );
}

function SkeletonRow({ index, cols }: { index: number; cols: readonly string[] }) {
  const delay = index * 75;
  return (
    <tr className="border-b border-slate-800/50">
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
      <div className="h-[2px] w-12 bg-slate-700 rounded-full animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
        <div className="h-4 w-4 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      </div>
      <div className="h-8 w-24 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="h-3 w-20 bg-slate-800/70 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-slate-800 rounded animate-skeleton" />
          <div className="h-3 w-64 bg-slate-800/70 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-8 w-20 bg-slate-800 rounded-lg animate-skeleton"
              style={{ animationDelay: `${i * 75}ms` }}
            />
          ))}
        </div>
      </div>

      {/* MTD mini-card */}
      <div className="card-surface rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-4 w-4 bg-slate-800 rounded animate-skeleton" />
          <div className="h-4 w-40 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-8 w-12 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
              <div className="h-3 w-20 bg-slate-800/70 rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
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
        <div className="px-6 py-4 border-b border-slate-800">
          <div className="h-5 w-36 bg-slate-800 rounded animate-skeleton" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {DASH_TABLE_WIDTHS.map((_, i) => (
                  <th key={i} className="text-left px-6 py-3">
                    <div className="h-3 w-10 bg-slate-800/60 rounded animate-skeleton" style={{ animationDelay: `${i * 40}ms` }} />
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
