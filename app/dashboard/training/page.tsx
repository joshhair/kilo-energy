'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import MobileTraining from '../mobile/MobileTraining';
import {
  TrainerAssignment,
  PayrollEntry,
  getTrainerOverrideRate,
} from '../../../lib/data';
import { isPaidAndEffective } from '../../../lib/utils';
import {
  GraduationCap,
  DollarSign,
  Users,
  TrendingUp,
  BarChart2,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Home,
} from 'lucide-react';
import { Breadcrumb } from '../components/Breadcrumb';

// ── Tab types ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'trainees' | 'payments' | 'rates';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'trainees', label: 'Trainees' },
  { key: 'payments', label: 'Payments' },
  { key: 'rates', label: 'Rate Schedule' },
];

// ── Status pill styles ───────────────────────────────────────────────────────

type PillStyle = { gradient: string; border: string; shadow: string; text: string; dot: string };

const PAYROLL_PILL: Record<string, PillStyle> = {
  Paid:    { gradient: 'bg-gradient-to-r from-emerald-900/40 to-emerald-800/20', border: 'border-emerald-700/30', shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.15)]', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  Pending: { gradient: 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/20',  border: 'border-yellow-700/30',  shadow: 'shadow-[0_0_6px_rgba(234,179,8,0.15)]',  text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
  Draft:   { gradient: 'bg-gradient-to-r from-slate-800/40 to-slate-700/20',    border: 'border-[var(--border)]/30',   shadow: '',                                       text: 'text-[var(--text-secondary)]',   dot: 'bg-[var(--text-muted)]'   },
};

function StatusBadge({ status }: { status: string }) {
  const s = PAYROLL_PILL[status] ?? PAYROLL_PILL.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border ${s.gradient} ${s.border} ${s.shadow} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

// ── Sort icon ────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

function SortIcon<K extends string>({ colKey, sortKey, sortDir }: { colKey: K; sortKey: K; sortDir: SortDir }) {
  if (sortKey !== colKey) return <ChevronsUpDown className="w-3.5 h-3.5 ml-1 inline-block text-[var(--text-dim)]" />;
  if (sortDir === 'asc') return <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" />;
  return <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function fmt$(n: number): string {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TrainingPage() {
  return (
    <Suspense>
      <TrainingPageInner />
    </Suspense>
  );
}

function TrainingPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    effectiveRepId,
    effectiveRole,
    trainerAssignments,
    payrollEntries,
    projects,
    reps,
  } = useApp();
  const isHydrated = useIsHydrated();

  useEffect(() => {
    document.title = 'Trainer Hub | Kilo Energy';
  }, []);

  // ── State ──────────────────────────────────────────────────────────────────

  const initialTab = (searchParams.get('tab') ?? 'overview') as Tab;
  const [activeTab, setActiveTabState] = useState<Tab>(TABS.some(t => t.key === initialTab) ? initialTab : 'overview');
  const setActiveTab = (t: Tab) => {
    setActiveTabState(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Tab indicator
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === activeTab);
    const el = tabRefs.current[idx];
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab, isHydrated]);

  // Trainee search + sort
  const [traineeSearch, setTraineeSearch] = useState('');
  const [traineeSort, setTraineeSort] = useState<'name' | 'deals' | 'earnings'>('name');
  const [traineeSortDir, setTraineeSortDir] = useState<SortDir>('asc');

  // Payment filters
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'Draft' | 'Pending' | 'Paid'>('all');

  // ── Derived data ───────────────────────────────────────────────────────────

  const myAssignments = useMemo(
    () => effectiveRole === 'admin'
      ? trainerAssignments
      : trainerAssignments.filter((a) => a.trainerId === effectiveRepId),
    [trainerAssignments, effectiveRepId, effectiveRole]
  );

  const isTrainer = myAssignments.length > 0;

  // Trainer payroll entries — all trainers for admin, self-only for reps
  const trainerEntries = useMemo(
    () => effectiveRole === 'admin'
      ? payrollEntries.filter((e) => e.paymentStage === 'Trainer')
      : payrollEntries.filter((e) => e.repId === effectiveRepId && e.paymentStage === 'Trainer'),
    [payrollEntries, effectiveRepId, effectiveRole]
  );

  // Build trainee info
  const traineeData = useMemo(() => {
    return myAssignments.map((assignment) => {
      const trainee = reps.find((r) => r.id === assignment.traineeId);
      const traineeName = trainee ? trainee.name : assignment.traineeId;
      const traineeRole = trainee?.repType ?? 'closer';

      // Deals involving this trainee as closer or setter (both count toward tier advancement)
      const traineeDeals = projects.filter(
        (p) =>
          (p.repId === assignment.traineeId || p.setterId === assignment.traineeId) &&
          p.phase !== 'Cancelled' &&
          p.phase !== 'On Hold'
      );
      const dealCount = traineeDeals.length;

      // Current tier
      const currentRate = getTrainerOverrideRate(assignment, dealCount);

      // Find which tier is active and next threshold
      let activeTierIndex = assignment.tiers.length - 1;
      let nextThreshold: number | null = null;
      for (let i = 0; i < assignment.tiers.length; i++) {
        const tier = assignment.tiers[i];
        if (tier.upToDeal === null || dealCount <= tier.upToDeal) {
          activeTierIndex = i;
          nextThreshold = tier.upToDeal;
          break;
        }
      }

      // Earnings from this trainee — match by projectId across closer and setter roles
      const traineeProjectIds = new Set(traineeDeals.map((p) => p.id));
      const earningsFromTrainee = trainerEntries
        .filter((e) => e.projectId && traineeProjectIds.has(e.projectId) && e.repId === assignment.trainerId && isPaidAndEffective(e))
        .reduce((s, e) => s + e.amount, 0);

      return {
        assignment,
        traineeId: assignment.traineeId,
        traineeName,
        traineeRole,
        dealCount,
        currentRate,
        activeTierIndex,
        nextThreshold,
        earningsFromTrainee,
      };
    });
  }, [myAssignments, reps, projects, trainerEntries]);

  // Filter + sort trainees
  const filteredTrainees = useMemo(() => {
    let list = [...traineeData];
    if (traineeSearch) {
      const q = traineeSearch.toLowerCase();
      list = list.filter((t) => t.traineeName.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (traineeSort === 'name') cmp = a.traineeName.localeCompare(b.traineeName);
      else if (traineeSort === 'deals') cmp = a.dealCount - b.dealCount;
      else cmp = a.earningsFromTrainee - b.earningsFromTrainee;
      return traineeSortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [traineeData, traineeSearch, traineeSort, traineeSortDir]);

  // Find trainee info for a payment entry by matching projectId
  const getTraineeForEntry = (entry: PayrollEntry): { name: string; id: string } | null => {
    if (!entry.projectId) return null;
    const project = projects.find((p) => p.id === entry.projectId);
    if (!project) return null;
    // Check if the project's closer or setter is one of my trainees
    for (const td of traineeData) {
      if (project.repId === td.traineeId || project.setterId === td.traineeId) {
        return { name: td.traineeName, id: td.traineeId };
      }
    }
    return null;
  };

  // Filter payments
  const filteredPayments = useMemo(() => {
    let list = [...trainerEntries];
    if (paymentSearch) {
      const q = paymentSearch.toLowerCase();
      list = list.filter((e) => {
        const trainee = getTraineeForEntry(e);
        return (
          (e.customerName ?? '').toLowerCase().includes(q) ||
          (trainee?.name ?? '').toLowerCase().includes(q) ||
          (e.notes ?? '').toLowerCase().includes(q)
        );
      });
    }
    if (paymentStatusFilter !== 'all') {
      list = list.filter((e) => e.status === paymentStatusFilter);
    }
    return list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [trainerEntries, paymentSearch, paymentStatusFilter, traineeData, projects]);

  // Overview stats
  const totalEarned = useMemo(
    () => trainerEntries.filter(isPaidAndEffective).reduce((s, e) => s + e.amount, 0),
    [trainerEntries]
  );
  const pendingAmount = useMemo(
    () => trainerEntries.filter((e) => e.status === 'Pending').reduce((s, e) => s + e.amount, 0),
    [trainerEntries]
  );
  const draftAmount = useMemo(
    () => trainerEntries.filter((e) => e.status === 'Draft').reduce((s, e) => s + e.amount, 0),
    [trainerEntries]
  );
  const activeTraineeCount = new Set(myAssignments.map((a) => a.traineeId)).size;
  const uniqueTraineeData = [...new Map(traineeData.map((t) => [t.traineeId, t])).values()];
  const totalTraineeDeals = uniqueTraineeData.reduce((s, t) => s + t.dealCount, 0);
  const avgOverrideRate = useMemo(() => {
    const unique = [...new Map(traineeData.map((t) => [t.traineeId, t])).values()];
    if (unique.length === 0) return 0;
    return unique.reduce((s, t) => s + t.currentRate, 0) / unique.length;
  }, [traineeData]);

  const isMobile = useMediaQuery('(max-width: 767px)');

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isMobile) return <MobileTraining />;

  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  if (!isHydrated) return <TrainingSkeleton />;

  if (!isTrainer && effectiveRole !== 'admin') {
    return (
      <div className="p-4 md:p-8 max-w-5xl animate-fade-in-up">
        <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Training' }]} />
        <div className="card-surface rounded-2xl p-8 text-center">
          <div className="inline-flex p-3 rounded-2xl mb-4" style={{ backgroundColor: 'rgba(245,158,11,0.12)' }}>
            <GraduationCap className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-white text-lg font-bold mb-2">No Trainees Assigned</h2>
          <p className="text-[var(--text-secondary)] text-sm max-w-md mx-auto mb-4">
            You don&apos;t have any trainees assigned. Contact your admin to set up trainer assignments.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-5 py-2 rounded-lg text-white transition-all hover:opacity-90 active:scale-[0.97]"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            <Home className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Toggle sort direction or change sort field
  const handleTraineeSort = (field: 'name' | 'deals' | 'earnings') => {
    if (traineeSort === field) {
      setTraineeSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTraineeSort(field);
      setTraineeSortDir('asc');
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl animate-fade-in-up">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Training' }]} />
      {/* ── Header ── */}
      <div className="mb-6">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-amber-500 to-orange-400 mb-3" />
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ backgroundColor: 'rgba(245,158,11,0.12)' }}>
            <GraduationCap className="w-5 h-5 text-amber-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
            Trainer Hub
          </h1>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex flex-wrap gap-1 mb-6 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container">
        {indicatorStyle && <div className="tab-indicator" style={indicatorStyle} />}
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => setActiveTab(t.key)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${
              activeTab === t.key ? 'text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}

      {/* ─────────── OVERVIEW TAB ─────────── */}
      {activeTab === 'overview' && (
        <div key="overview" className="animate-tab-enter space-y-6">
          {/* Hero stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Earned */}
            <div
              className="card-surface card-surface-stat rounded-2xl p-5 border-l-2 border-l-amber-500/40 animate-slide-in-scale stagger-1"
              style={{ '--card-accent': 'rgba(245,158,11,0.08)' } as React.CSSProperties}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--text-muted)] text-[10px] font-semibold uppercase tracking-widest">Total Earned</span>
                <DollarSign className="w-4 h-4 text-amber-400/50" />
              </div>
              <p
                className="text-3xl font-black tabular-nums text-amber-400 stat-value"
                style={{ textShadow: '0 0 20px rgba(245,158,11,0.25)' }}
              >
                {fmt$(totalEarned)}
              </p>
            </div>

            {/* Active Trainees */}
            <div
              className="card-surface card-surface-stat rounded-2xl p-5 border-l-2 border-l-orange-500/40 animate-slide-in-scale stagger-2"
              style={{ '--card-accent': 'rgba(249,115,22,0.08)' } as React.CSSProperties}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--text-muted)] text-[10px] font-semibold uppercase tracking-widest">Active Trainees</span>
                <Users className="w-4 h-4 text-orange-400/50" />
              </div>
              <p
                className="text-3xl font-black tabular-nums text-orange-400 stat-value"
                style={{ textShadow: '0 0 20px rgba(249,115,22,0.25)' }}
              >
                {activeTraineeCount}
              </p>
            </div>

            {/* Avg Override Rate */}
            <div
              className="card-surface card-surface-stat rounded-2xl p-5 border-l-2 border-l-yellow-500/40 animate-slide-in-scale stagger-3"
              style={{ '--card-accent': 'rgba(234,179,8,0.08)' } as React.CSSProperties}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--text-muted)] text-[10px] font-semibold uppercase tracking-widest">Avg Override Rate</span>
                <TrendingUp className="w-4 h-4 text-yellow-400/50" />
              </div>
              <p
                className="text-3xl font-black tabular-nums text-yellow-400 stat-value"
                style={{ textShadow: '0 0 20px rgba(234,179,8,0.25)' }}
              >
                ${avgOverrideRate.toFixed(2)}/W
              </p>
            </div>

            {/* Total Trainee Deals */}
            <div
              className="card-surface card-surface-stat rounded-2xl p-5 border-l-2 border-l-emerald-500/40 animate-slide-in-scale stagger-4"
              style={{ '--card-accent': 'rgba(16,185,129,0.08)' } as React.CSSProperties}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--text-muted)] text-[10px] font-semibold uppercase tracking-widest">Trainee Deals</span>
                <BarChart2 className="w-4 h-4 text-[var(--accent-green)]/50" />
              </div>
              <p
                className="text-3xl font-black tabular-nums text-[var(--accent-green)] stat-value"
                style={{ textShadow: '0 0 20px rgba(16,185,129,0.25)' }}
              >
                {totalTraineeDeals}
              </p>
            </div>
          </div>

          {/* Earnings breakdown */}
          <div className="card-surface rounded-2xl p-6">
            <h3 className="text-white font-bold text-sm mb-4 uppercase tracking-wider">Pay Breakdown</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 bg-[var(--surface-card)]/40 rounded-xl px-4 py-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-secondary)] text-xs">Paid</p>
                  <p className="text-[var(--accent-green)] font-bold tabular-nums">{fmt$(totalEarned)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-[var(--surface-card)]/40 rounded-xl px-4 py-3">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-secondary)] text-xs">Pending</p>
                  <p className="text-yellow-400 font-bold tabular-nums">{fmt$(pendingAmount)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-[var(--surface-card)]/40 rounded-xl px-4 py-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--text-muted)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-secondary)] text-xs">Draft</p>
                  <p className="text-[var(--text-secondary)] font-bold tabular-nums">{fmt$(draftAmount)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── TRAINEES TAB ─────────── */}
      {activeTab === 'trainees' && (
        <div key="trainees" className="animate-tab-enter space-y-4">
          {/* Search + sort controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search trainees..."
                value={traineeSearch}
                onChange={(e) => setTraineeSearch(e.target.value)}
                className="w-full bg-[var(--surface)] border border-[var(--border-subtle)] text-white rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-500"
              />
            </div>
            {traineeSearch && (
              <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full">{filteredTrainees.length} result{filteredTrainees.length !== 1 ? 's' : ''}</span>
            )}
            <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit">
              {(['name', 'deals', 'earnings'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => handleTraineeSort(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    traineeSort === s ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {traineeSort === s && (
                    <span className="ml-1">{traineeSortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Trainee cards */}
          {filteredTrainees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-[var(--surface)]/30 border border-dashed border-[var(--border-subtle)]">
              <GraduationCap className="w-12 h-12 text-[var(--text-dim)]" />
              <div className="text-center">
                <p className="text-lg font-semibold text-white">{traineeSearch ? 'No trainees match your search' : 'No trainees yet'}</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">{traineeSearch ? 'Try adjusting your search query or sort criteria' : 'Trainer assignments will populate trainees automatically'}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredTrainees.map((t, idx) => {
                // Progress toward next tier
                const prevThreshold =
                  t.activeTierIndex > 0
                    ? t.assignment.tiers[t.activeTierIndex - 1].upToDeal ?? 0
                    : 0;
                const progressMax = t.nextThreshold ? (t.nextThreshold + 1) - prevThreshold : 1;
                const progressVal = t.nextThreshold
                  ? Math.min(t.dealCount - prevThreshold, progressMax)
                  : 1;
                const progressPct = Math.round((progressVal / progressMax) * 100);

                const roleBadgeColor =
                  t.traineeRole === 'closer'
                    ? 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20'
                    : t.traineeRole === 'setter'
                    ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
                    : 'text-teal-400 bg-teal-500/10 border-teal-500/20';

                return (
                  <div
                    key={t.assignment.id}
                    className={`card-surface rounded-2xl p-5 animate-slide-in-scale stagger-${Math.min(idx + 1, 6)}`}
                  >
                    <div className="flex items-start gap-4 mb-4">
                      {/* Initials avatar */}
                      <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-[2px] rounded-full flex-shrink-0">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                          style={{ backgroundColor: 'var(--navy-card)' }}
                        >
                          {getInitials(t.traineeName)}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/dashboard/users/${t.traineeId}`} className="text-white font-bold text-sm truncate hover:text-[var(--accent-cyan)] transition-colors">{t.traineeName}</Link>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${roleBadgeColor}`}>
                            {t.traineeRole === 'both' ? 'Closer/Setter' : t.traineeRole.charAt(0).toUpperCase() + t.traineeRole.slice(1)}
                          </span>
                        </div>
                        <p className="text-[var(--text-muted)] text-xs mt-0.5">
                          {t.dealCount} deal{t.dealCount !== 1 ? 's' : ''} closed
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-amber-400 font-bold text-sm tabular-nums">{fmt$(t.earningsFromTrainee)}</p>
                        <p className="text-[var(--text-muted)] text-[10px]">earned</p>
                      </div>
                    </div>

                    {/* Current tier */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-amber-400/80 text-xs font-semibold">
                        Tier {t.activeTierIndex + 1}: ${t.currentRate.toFixed(2)}/W
                      </span>
                      {t.nextThreshold && (
                        <span className="text-[var(--text-muted)] text-[10px]">
                          {t.dealCount}/{t.nextThreshold} deals
                        </span>
                      )}
                      {!t.nextThreshold && (
                        <span className="text-[var(--text-muted)] text-[10px]">Final tier</span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 bg-[var(--surface-card)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────── PAYMENTS TAB ─────────── */}
      {activeTab === 'payments' && (
        <div key="payments" className="animate-tab-enter space-y-4">
          {/* Search + filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search by customer or trainee..."
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                className="w-full bg-[var(--surface)] border border-[var(--border-subtle)] text-white rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-500"
              />
            </div>
            {paymentSearch && (
              <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full">{filteredPayments.length} result{filteredPayments.length !== 1 ? 's' : ''}</span>
            )}
            <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit">
              {(['all', 'Draft', 'Pending', 'Paid'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPaymentStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    paymentStatusFilter === s ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {filteredPayments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-[var(--surface)]/30 border border-dashed border-[var(--border-subtle)]">
              <DollarSign className="w-12 h-12 text-[var(--text-dim)]" />
              <div className="text-center">
                <p className="text-lg font-semibold text-white">{paymentSearch || paymentStatusFilter !== 'all' ? 'No payments match your filters' : 'No trainer payments yet'}</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">{paymentSearch || paymentStatusFilter !== 'all' ? 'Try adjusting your search or status filter' : 'Override payments appear here when trainees close deals'}</p>
              </div>
            </div>
          ) : (
            <div className="card-surface rounded-2xl overflow-clip">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-header-frost border-b border-[var(--border-subtle)]">
                    <tr>
                      <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Customer</th>
                      <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Trainee</th>
                      <th className="text-right px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Amount</th>
                      <th className="text-center px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {filteredPayments.map((entry) => (
                      <tr key={entry.id} className="hover:bg-[var(--surface-card)]/30 transition-colors">
                        <td className="px-4 py-3 text-white text-sm">{entry.customerName || '—'}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{(() => { const t = getTraineeForEntry(entry); return t ? <Link href={`/dashboard/users/${t.id}`} className="hover:text-[var(--accent-cyan)] transition-colors">{t.name}</Link> : '—'; })()}</td>
                        <td className="px-4 py-3 text-right text-amber-400 font-semibold tabular-nums">{fmt$(entry.amount)}</td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={entry.status} /></td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────── RATE SCHEDULE TAB ─────────── */}
      {activeTab === 'rates' && (
        <div key="rates" className="animate-tab-enter space-y-4">
          {traineeData.map((t, idx) => (
            <div
              key={t.assignment.id}
              className={`card-surface rounded-2xl p-5 animate-slide-in-scale stagger-${Math.min(idx + 1, 6)}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-[2px] rounded-full flex-shrink-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: 'var(--navy-card)' }}
                  >
                    {getInitials(t.traineeName)}
                  </div>
                </div>
                <Link href={`/dashboard/users/${t.traineeId}`} className="text-white font-bold text-sm hover:text-[var(--accent-cyan)] transition-colors">{t.traineeName}</Link>
              </div>

              {/* Tier table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-header-frost">
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Tier</th>
                      <th className="text-left px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Deal Range</th>
                      <th className="text-right px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {t.assignment.tiers.map((tier, tierIdx) => {
                      const isActive = tierIdx === t.activeTierIndex;
                      const prevEnd =
                        tierIdx > 0 ? t.assignment.tiers[tierIdx - 1].upToDeal ?? 0 : 0;
                      const rangeLabel =
                        tier.upToDeal === null
                          ? `${prevEnd + 1}+ deals`
                          : `${tierIdx === 0 ? 0 : prevEnd + 1} – ${tier.upToDeal} deals`;

                      return (
                        <tr
                          key={tierIdx}
                          className={`transition-colors ${
                            isActive
                              ? 'bg-amber-500/8'
                              : 'hover:bg-[var(--surface-card)]/30'
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-sm font-semibold ${
                                  isActive ? 'text-amber-400' : 'text-[var(--text-secondary)]'
                                }`}
                              >
                                Tier {tierIdx + 1}
                              </span>
                              {isActive && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`px-3 py-2.5 text-sm ${isActive ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                            {rangeLabel}
                          </td>
                          <td className={`px-3 py-2.5 text-right text-sm font-bold tabular-nums ${isActive ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
                            ${tier.ratePerW.toFixed(2)}/W
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Current position indicator */}
              <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <GraduationCap className="w-3.5 h-3.5 text-amber-400/60" />
                <span>
                  {t.traineeName} has {t.dealCount} deal{t.dealCount !== 1 ? 's' : ''} —
                  currently at ${t.currentRate.toFixed(2)}/W
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TrainingSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 bg-[var(--surface-card)] rounded animate-skeleton" />
          <div className="h-8 w-48 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-3 w-64 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: '150ms' }} />
      </div>

      {/* Stat cards — 4 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card-surface rounded-2xl p-5 space-y-3">
            <div className="h-[2px] w-12 bg-[var(--border)] rounded-full animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="h-3 w-16 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="h-8 w-24 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${i * 75 + 40}ms` }} />
          </div>
        ))}
      </div>

      {/* Tab bar — 4 pills */}
      <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-24 bg-[var(--surface-card)] rounded-lg animate-skeleton" style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>

      {/* 4 trainee row placeholders */}
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => {
          const delay = i * 75;
          return (
            <div key={i} className="card-surface rounded-2xl p-5 flex items-center gap-4">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-[var(--surface-card)] flex-shrink-0 animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
              {/* Name + detail */}
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
                <div className="h-3 w-48 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: `${delay + 40}ms` }} />
              </div>
              {/* Stats */}
              <div className="flex gap-6">
                {[...Array(3)].map((_, si) => (
                  <div key={si} className="text-center space-y-1">
                    <div className="h-4 w-10 bg-[var(--surface-card)] rounded animate-skeleton mx-auto" style={{ animationDelay: `${delay + si * 30}ms` }} />
                    <div className="h-3 w-14 bg-[var(--surface-card)]/70 rounded animate-skeleton mx-auto" style={{ animationDelay: `${delay + si * 30}ms` }} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
