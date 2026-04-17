'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import MobileTraining from '../mobile/MobileTraining';
import {
  TrainerAssignment,
  PayrollEntry,
  Project,
  Rep,
  getTrainerOverrideRate,
  resolveTrainerRate,
  INSTALLER_PAY_CONFIGS,
  DEFAULT_INSTALL_PAY_PCT,
} from '../../../lib/data';
import { MAX_TRAINER_RATE_PER_W } from '../../../lib/schemas/trainer-assignment';
import { isPaidAndEffective, formatDate } from '../../../lib/utils';
import { PHASE_PILL } from '../projects/components/shared';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  GraduationCap,
  DollarSign,
  Users,
  TrendingUp,
  BarChart2,
  Search,
  ChevronDown,
  Home,
  MoreHorizontal,
  Pencil,
  Pause,
  Play,
  Archive,
  ShieldCheck,
  RotateCcw,
  X,
  Check,
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { Breadcrumb } from '../components/Breadcrumb';

// ── Types ─────────────────────────────────────────────────────────────────────

type RepTab = 'overview' | 'active' | 'residuals' | 'payments' | 'rates';
type AdminStatus = 'training' | 'residuals' | 'maxed' | 'paused';

const REP_TABS: { key: RepTab; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'active',    label: 'Active Trainees' },
  { key: 'residuals', label: 'Residuals' },
  { key: 'payments',  label: 'Payments' },
  { key: 'rates',     label: 'Rate Schedule' },
];

// ── Status helpers ────────────────────────────────────────────────────────────

type StatusPill = {
  key: AdminStatus;
  label: string;
  text: string;
  bg: string;
  border: string;
  dot: string;
};

const STATUS_PILLS: Record<AdminStatus, StatusPill> = {
  training:  { key: 'training',  label: 'In Training', text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  residuals: { key: 'residuals', label: 'Residuals',   text: 'text-[var(--text-secondary)]', bg: 'bg-slate-500/10', border: 'border-slate-500/30', dot: 'bg-slate-400' },
  maxed:     { key: 'maxed',     label: 'Maxed',       text: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-card)]/40', border: 'border-[var(--border-subtle)]', dot: 'bg-[var(--text-dim)]' },
  paused:    { key: 'paused',    label: 'Paused',      text: 'text-yellow-300', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', dot: 'bg-yellow-400' },
};

/**
 * Derive status for a single (trainer, trainee) assignment. Precedence:
 *   paused (active=false on underlying Rep)  → Paused
 *   isActiveTraining === false               → Residuals
 *   all capped tiers consumed (no perpetual) → Maxed
 *   else                                     → In Training
 */
function getAssignmentStatus(
  assignment: TrainerAssignment,
  trainee: Rep | undefined,
  consumedDeals: number,
): AdminStatus {
  if (trainee && trainee.active === false) return 'paused';
  if (assignment.isActiveTraining === false) return 'residuals';
  // Check if every tier has a cap and every cap is consumed (no perpetuity tier).
  const hasPerpetual = assignment.tiers.some((t) => t.upToDeal === null);
  if (!hasPerpetual) {
    const lastCap = assignment.tiers[assignment.tiers.length - 1]?.upToDeal ?? 0;
    if (consumedDeals >= lastCap) return 'maxed';
  }
  return 'training';
}

function StatusPillBadge({ status }: { status: AdminStatus }) {
  const s = STATUS_PILLS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.border} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ── Payroll pill ──────────────────────────────────────────────────────────────

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

// ── Sort direction type ──────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

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

/**
 * Compact phase pill — reuses the PHASE_PILL tokens from projects/shared so the
 * coaching view matches what trainers see elsewhere in the app.
 */
function PhasePill({ phase }: { phase: string }) {
  const s = PHASE_PILL[phase];
  if (!s) {
    return <span className="text-[10px] text-[var(--text-muted)] px-2 py-0.5 rounded-full bg-[var(--surface-card)]/50">{phase}</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
      style={{ background: `${s.hex}12`, border: `1px solid ${s.hex}30`, color: s.hex }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.hex }} />
      {phase}
    </span>
  );
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
    setTrainerAssignments,
    payrollEntries,
    projects,
    reps,
  } = useApp();
  const isHydrated = useIsHydrated();
  const { toast } = useToast();

  useEffect(() => {
    document.title = 'Trainer Hub | Kilo Energy';
  }, []);

  const isMobile = useMediaQuery('(max-width: 767px)');

  // ── URL-synced tab state (used by rep-trainer view) ───────────────────────
  const initialTab = (searchParams.get('tab') ?? 'overview') as RepTab;
  const [activeTab, setActiveTabState] = useState<RepTab>(
    REP_TABS.some((t) => t.key === initialTab) ? initialTab : 'overview',
  );
  const setActiveTab = (t: RepTab) => {
    setActiveTabState(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Tab indicator (rep view)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const idx = REP_TABS.findIndex((t) => t.key === activeTab);
    const el = tabRefs.current[idx];
    if (el) setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab, isHydrated]);

  // ── Admin filters (URL-synced — survives back-nav like Projects page) ──────
  const [adminStatusFilter, setAdminStatusFilter] = useState<AdminStatus | 'all'>(() => {
    const v = searchParams.get('status') as AdminStatus | 'all' | null;
    return v && (v === 'all' || v in STATUS_PILLS) ? v : 'all';
  });
  const [adminTrainerFilter, setAdminTrainerFilter] = useState(() => searchParams.get('trainer') ?? '');
  const [adminRepFilter, setAdminRepFilter] = useState(() => searchParams.get('rep') ?? '');
  const [adminSearch, setAdminSearch] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    if (effectiveRole !== 'admin') return;
    const params = new URLSearchParams(window.location.search);
    if (adminStatusFilter !== 'all') params.set('status', adminStatusFilter); else params.delete('status');
    if (adminTrainerFilter) params.set('trainer', adminTrainerFilter); else params.delete('trainer');
    if (adminRepFilter) params.set('rep', adminRepFilter); else params.delete('rep');
    if (adminSearch) params.set('q', adminSearch); else params.delete('q');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '/dashboard/training', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminStatusFilter, adminTrainerFilter, adminRepFilter, adminSearch, effectiveRole]);

  // ── Rep-trainer search + sort for rate schedule ───────────────────────────
  const [traineeSearch, setTraineeSearch] = useState('');
  const [traineeSort, setTraineeSort] = useState<'name' | 'deals' | 'earnings'>('name');
  const [traineeSortDir, setTraineeSortDir] = useState<SortDir>('asc');

  // Payment filters
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'Draft' | 'Pending' | 'Paid'>('all');

  // Row actions menu (admin) — stores the assignment id whose menu is open
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openMenuId) return;
    const onClickAway = (e: MouseEvent) => {
      if (!menuContainerRef.current) return;
      if (!menuContainerRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [openMenuId]);

  // Slide-over: read-only project drill from an Active Trainee card
  const [slideProjectId, setSlideProjectId] = useState<string | null>(null);

  // New Assignment modal
  const [showNewAssignment, setShowNewAssignment] = useState(false);

  // Backfill wizard — stores the assignment ID whose backfill is active
  const [backfillAssignmentId, setBackfillAssignmentId] = useState<string | null>(null);

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

  // Consumed deals per (trainer, trainee) pair — mirrors resolveTrainerRate's
  // counting rule: distinct projectIds where this trainer earned a Trainer
  // PayrollEntry for this trainee. UI-side we still surface all-time counts.
  const getConsumedDeals = (a: TrainerAssignment): number => {
    const seen = new Set<string>();
    for (const e of payrollEntries) {
      if (e.paymentStage !== 'Trainer') continue;
      if (e.repId !== a.trainerId) continue;
      if (e.projectId == null) continue;
      // Only deals where the closer or setter is this trainee.
      const p = projects.find((proj) => proj.id === e.projectId);
      if (!p) continue;
      if (p.repId !== a.traineeId && p.setterId !== a.traineeId) continue;
      seen.add(e.projectId);
    }
    return seen.size;
  };

  // Build trainee info for rep-trainer view
  const traineeData = useMemo(() => {
    return myAssignments.map((assignment) => {
      const trainee = reps.find((r) => r.id === assignment.traineeId);
      const traineeName = trainee ? trainee.name : assignment.traineeId;
      const traineeRole = trainee?.repType ?? 'closer';

      const traineeDeals = projects.filter(
        (p) =>
          (p.repId === assignment.traineeId || p.setterId === assignment.traineeId) &&
          p.phase !== 'Cancelled' &&
          p.phase !== 'On Hold'
      );
      const dealCount = traineeDeals.length;

      const currentRate = getTrainerOverrideRate(assignment, dealCount);

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

      const traineeProjectIds = new Set(traineeDeals.map((p) => p.id));
      const earningsFromTrainee = trainerEntries
        .filter((e) => e.projectId && traineeProjectIds.has(e.projectId) && e.repId === assignment.trainerId && isPaidAndEffective(e))
        .reduce((s, e) => s + e.amount, 0);

      const consumedDeals = getConsumedDeals(assignment);
      const status = getAssignmentStatus(assignment, trainee, consumedDeals);

      return {
        assignment,
        traineeId: assignment.traineeId,
        trainee,
        traineeName,
        traineeRole,
        dealCount,
        consumedDeals,
        currentRate,
        activeTierIndex,
        nextThreshold,
        earningsFromTrainee,
        status,
        projects: traineeDeals,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAssignments, reps, projects, trainerEntries, payrollEntries]);

  // Filter + sort (rep view — Rate Schedule / search is across all trainees)
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

  const activeTrainees = useMemo(
    () => filteredTrainees.filter((t) => t.assignment.isActiveTraining !== false),
    [filteredTrainees]
  );
  const residualTrainees = useMemo(
    () => filteredTrainees.filter((t) => t.assignment.isActiveTraining === false),
    [filteredTrainees]
  );

  // Find trainee for a payment entry (rep view payment table)
  const getTraineeForEntry = (entry: PayrollEntry): { name: string; id: string } | null => {
    if (!entry.projectId) return null;
    const project = projects.find((p) => p.id === entry.projectId);
    if (!project) return null;
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
    // getTraineeForEntry is a closure over traineeData + projects — those are
    // already listed, so depending on the function itself would double-add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainerEntries, paymentSearch, paymentStatusFilter, traineeData, projects]);

  // Overview stats (rep view)
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
  const uniqueTraineeData = [...traineeData.reduce((m, t) => {
    const prev = m.get(t.traineeId);
    if (!prev || t.currentRate > prev.currentRate) m.set(t.traineeId, t);
    return m;
  }, new Map<string, typeof traineeData[number]>()).values()];
  const totalTraineeDeals = uniqueTraineeData.reduce((s, t) => s + t.dealCount, 0);
  const avgOverrideRate = useMemo(() => {
    const unique = [...traineeData.reduce((m, t) => {
      const prev = m.get(t.traineeId);
      if (!prev || t.currentRate > prev.currentRate) m.set(t.traineeId, t);
      return m;
    }, new Map<string, typeof traineeData[number]>()).values()];
    if (unique.length === 0) return 0;
    return unique.reduce((s, t) => s + t.currentRate, 0) / unique.length;
  }, [traineeData]);

  // ── Graduation + pause helpers ─────────────────────────────────────────────

  const patchAssignment = async (
    id: string,
    body: Partial<Pick<TrainerAssignment, 'isActiveTraining'>>,
    successMsg: string,
  ) => {
    const prev = trainerAssignments.find((a) => a.id === id);
    if (!prev) return;
    // Optimistic update
    setTrainerAssignments((list) =>
      list.map((a) => (a.id === id ? { ...a, ...body } : a))
    );
    try {
      const res = await fetch('/api/trainer-assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error('non-2xx');
      toast(successMsg, 'success');
    } catch {
      // Revert
      setTrainerAssignments((list) =>
        list.map((a) => (a.id === id ? prev : a))
      );
      toast('Failed to update trainer assignment', 'error');
    }
  };

  const markGraduated = (id: string) => patchAssignment(id, { isActiveTraining: false }, 'Marked as graduated');
  const resumeTraining = (id: string) => patchAssignment(id, { isActiveTraining: true }, 'Training resumed');

  // ── Admin filter application ─────────────────────────────────────────────

  const adminRows = useMemo(() => {
    if (effectiveRole !== 'admin') return [];
    // Group by (trainer, trainee) and render multi-tier rows so the full
    // tier chain is visible at a glance.
    return trainerAssignments.map((a) => {
      const trainee = reps.find((r) => r.id === a.traineeId);
      const trainer = reps.find((r) => r.id === a.trainerId);
      const consumed = getConsumedDeals(a);
      const status = getAssignmentStatus(a, trainee, consumed);
      const rate = getTrainerOverrideRate(a, consumed);
      const activeTierIndex = a.tiers.findIndex(
        (t) => t.upToDeal === null || consumed < t.upToDeal
      );
      return { assignment: a, trainer, trainee, consumed, status, rate, activeTierIndex };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainerAssignments, reps, projects, payrollEntries, effectiveRole]);

  const filteredAdminRows = useMemo(() => {
    return adminRows.filter((row) => {
      if (adminStatusFilter !== 'all' && row.status !== adminStatusFilter) return false;
      if (adminTrainerFilter && row.assignment.trainerId !== adminTrainerFilter) return false;
      if (adminRepFilter && row.assignment.traineeId !== adminRepFilter) return false;
      if (adminSearch) {
        const q = adminSearch.toLowerCase();
        const match =
          (row.trainer?.name ?? '').toLowerCase().includes(q) ||
          (row.trainee?.name ?? '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [adminRows, adminStatusFilter, adminTrainerFilter, adminRepFilter, adminSearch]);

  // Unique trainer + rep lists for filter dropdowns
  const trainerOptions = useMemo(() => {
    const ids = new Set(trainerAssignments.map((a) => a.trainerId));
    return reps.filter((r) => ids.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [trainerAssignments, reps]);
  const repOptions = useMemo(() => {
    const ids = new Set(trainerAssignments.map((a) => a.traineeId));
    return reps.filter((r) => ids.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [trainerAssignments, reps]);

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

  const handleTraineeSort = (field: 'name' | 'deals' | 'earnings') => {
    if (traineeSort === field) {
      setTraineeSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTraineeSort(field);
      setTraineeSortDir('asc');
    }
  };

  // ── ADMIN VIEW ────────────────────────────────────────────────────────────
  if (effectiveRole === 'admin') {
    return (
      <div className="p-4 md:p-8 max-w-6xl animate-fade-in-up">
        <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Training' }]} />
        {/* Header */}
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
          <p className="text-[var(--text-muted)] text-sm mt-2 ml-[52px]">
            All trainer-trainee assignments across the org. Use filters to scope.
          </p>
          <button
            onClick={() => setShowNewAssignment(true)}
            className="mt-3 ml-[52px] inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-[0.97]"
            style={{ backgroundColor: 'var(--brand)', color: '#050d18' }}
          >
            <Plus className="w-4 h-4" />
            New Assignment
          </button>
        </div>

        {/* Filters */}
        <div className="card-surface rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search trainer or rep..."
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--border-subtle)] text-white rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-500"
            />
          </div>
          <select
            value={adminStatusFilter}
            onChange={(e) => setAdminStatusFilter(e.target.value as AdminStatus | 'all')}
            className="bg-[var(--surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="training">In Training</option>
            <option value="residuals">Residuals</option>
            <option value="maxed">Maxed</option>
            <option value="paused">Paused</option>
          </select>
          <select
            value={adminTrainerFilter}
            onChange={(e) => setAdminTrainerFilter(e.target.value)}
            className="bg-[var(--surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="">All Trainers</option>
            {trainerOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select
            value={adminRepFilter}
            onChange={(e) => setAdminRepFilter(e.target.value)}
            className="bg-[var(--surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="">All Reps</option>
            {repOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {(adminStatusFilter !== 'all' || adminTrainerFilter || adminRepFilter || adminSearch) && (
            <button
              onClick={() => {
                setAdminStatusFilter('all');
                setAdminTrainerFilter('');
                setAdminRepFilter('');
                setAdminSearch('');
              }}
              className="text-xs text-[var(--text-muted)] hover:text-white transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        {/* Results count */}
        <p className="text-xs text-[var(--text-muted)] mb-3">
          {filteredAdminRows.length} of {adminRows.length} assignment{adminRows.length === 1 ? '' : 's'}
        </p>

        {/* Table — overflow-visible so the ⋯ row-actions dropdown isn't clipped. */}
        <div className="card-surface rounded-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-header-frost border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Trainer</th>
                  <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Rep</th>
                  <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Tier Chain</th>
                  <th className="text-right px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Rate</th>
                  <th className="text-right px-4 py-3 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Progress</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredAdminRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-[var(--text-muted)] text-sm">
                      No assignments match your filters.
                    </td>
                  </tr>
                )}
                {filteredAdminRows.map((row, idx) => {
                  const a = row.assignment;
                  const trainerName = row.trainer?.name ?? 'Unknown';
                  const traineeName = row.trainee?.name ?? 'Unknown';
                  // Capped-tier progress bar: show consumed against the last capped tier.
                  const hasPerpetual = a.tiers.some((t) => t.upToDeal === null);
                  const lastCappedTier = [...a.tiers].reverse().find((t) => t.upToDeal !== null);
                  const cap = lastCappedTier?.upToDeal ?? null;
                  const progressPct = cap ? Math.min(100, Math.round((row.consumed / cap) * 100)) : null;
                  return (
                    <tr
                      key={a.id}
                      className={`table-row-enter row-stagger-${Math.min(idx, 24)} hover:bg-[var(--surface-card)]/30 transition-colors`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {getInitials(trainerName)}
                          </div>
                          <Link href={`/dashboard/users/${a.trainerId}`} className="text-white truncate hover:text-[var(--accent-cyan)] transition-colors">
                            {trainerName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-[var(--accent-green)]/20 text-[var(--accent-green)] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {getInitials(traineeName)}
                          </div>
                          <Link href={`/dashboard/users/${a.traineeId}`} className="text-[var(--text-secondary)] truncate hover:text-[var(--accent-cyan)] transition-colors">
                            {traineeName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPillBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {a.tiers.map((tier, i) => {
                            const isActive = i === row.activeTierIndex;
                            const rangeEnd = tier.upToDeal === null ? '∞' : tier.upToDeal;
                            return (
                              <span
                                key={i}
                                title={`Tier ${i + 1}: up to ${rangeEnd} deals`}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums border ${
                                  isActive
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                    : 'bg-[var(--surface-card)]/40 text-[var(--text-muted)] border-[var(--border-subtle)]'
                                }`}
                              >
                                ${tier.ratePerW.toFixed(2)}<span className="opacity-60">/W·{rangeEnd}</span>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-amber-400 font-semibold tabular-nums">
                        ${row.rate.toFixed(2)}/W
                      </td>
                      <td className="px-4 py-3 text-right">
                        {progressPct !== null ? (
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-24 h-1.5 bg-[var(--surface-card)] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                              {row.consumed}/{cap}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--text-muted)]">∞ {row.consumed}</span>
                        )}
                        {!hasPerpetual && progressPct === 100 && (
                          <p className="text-[9px] text-[var(--text-dim)] mt-0.5">All tiers consumed</p>
                        )}
                      </td>
                      <td className="px-4 py-3 relative">
                        <div ref={openMenuId === a.id ? menuContainerRef : undefined}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === a.id ? null : a.id);
                            }}
                            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--border)]/60 transition-colors"
                            aria-label="Row actions"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {openMenuId === a.id && (
                            <div
                              className="absolute right-4 bottom-full mb-1 z-30 min-w-[200px] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-2xl py-1 motion-safe:animate-[fadeSlideIn_160ms_cubic-bezier(0.16,1,0.3,1)_both]"
                            >
                              <Link
                                href={`/dashboard/users/${a.traineeId}`}
                                onClick={() => setOpenMenuId(null)}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-white transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" /> Edit assignment
                              </Link>
                              {a.isActiveTraining === false ? (
                                <button
                                  onClick={() => { setOpenMenuId(null); resumeTraining(a.id); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-white transition-colors"
                                >
                                  <Play className="w-3.5 h-3.5" /> Resume Training
                                </button>
                              ) : (
                                <button
                                  onClick={() => { setOpenMenuId(null); markGraduated(a.id); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-white transition-colors"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" /> Mark Graduated
                                </button>
                              )}
                              <button
                                onClick={() => { setOpenMenuId(null); toast(row.status === 'paused' ? 'Resume handled via rep activation (coming soon)' : 'Pause handled via rep deactivation (coming soon)', 'info'); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-white transition-colors"
                              >
                                <Pause className="w-3.5 h-3.5" /> {row.status === 'paused' ? 'Resume' : 'Pause'}
                              </button>
                              <button
                                onClick={() => { setOpenMenuId(null); toast('Archive coming soon', 'info'); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-white transition-colors"
                              >
                                <Archive className="w-3.5 h-3.5" /> Archive
                              </button>
                              <div className="border-t border-[var(--border-subtle)] my-1" />
                              <button
                                onClick={() => { setOpenMenuId(null); setBackfillAssignmentId(a.id); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-white transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> Run Backfill
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* New Assignment modal */}
        {showNewAssignment && (
          <NewAssignmentModal
            reps={reps}
            onClose={() => setShowNewAssignment(false)}
            onCreated={(assignment) => {
              setTrainerAssignments((prev) => [...prev, assignment]);
              setShowNewAssignment(false);
              toast('Assignment created', 'success');
            }}
          />
        )}

        {/* Backfill wizard */}
        {backfillAssignmentId && (() => {
          const bfAssignment = trainerAssignments.find((a) => a.id === backfillAssignmentId);
          if (!bfAssignment) return null;
          return (
            <BackfillWizard
              assignment={bfAssignment}
              reps={reps}
              projects={projects}
              payrollEntries={payrollEntries}
              onClose={() => setBackfillAssignmentId(null)}
              onComplete={(created, skippedCount) => {
                toast(`Created ${created} trainer entries${skippedCount > 0 ? `, skipped ${skippedCount}` : ''}`, 'success');
                setBackfillAssignmentId(null);
                // Reload context data to pick up new payroll entries
                window.location.reload();
              }}
            />
          );
        })()}
      </div>
    );
  }

  // ── REP-TRAINER VIEW ─────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 max-w-5xl animate-fade-in-up">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Training' }]} />
      {/* Header */}
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

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-6 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit tab-bar-container">
        {indicatorStyle && <div className="tab-indicator" style={indicatorStyle} />}
        {REP_TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => setActiveTab(t.key)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97] ${
              activeTab === t.key ? 'text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {t.label}
            {t.key === 'active' && activeTrainees.length > 0 && (
              <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">({activeTrainees.length})</span>
            )}
            {t.key === 'residuals' && residualTrainees.length > 0 && (
              <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">({residualTrainees.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div key="overview" className="animate-tab-enter space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Earned" value={fmt$(totalEarned)} color="text-amber-400" border="border-l-amber-500/40" accent="rgba(245,158,11,0.08)" glow="rgba(245,158,11,0.25)" stagger={1} icon={<DollarSign className="w-4 h-4 text-amber-400/50" />} />
            <StatCard label="Active Trainees" value={String(activeTraineeCount)} color="text-orange-400" border="border-l-orange-500/40" accent="rgba(249,115,22,0.08)" glow="rgba(249,115,22,0.25)" stagger={2} icon={<Users className="w-4 h-4 text-orange-400/50" />} />
            <StatCard label="Avg Override Rate" value={`$${avgOverrideRate.toFixed(2)}/W`} color="text-yellow-400" border="border-l-yellow-500/40" accent="rgba(234,179,8,0.08)" glow="rgba(234,179,8,0.25)" stagger={3} icon={<TrendingUp className="w-4 h-4 text-yellow-400/50" />} />
            <StatCard label="Trainee Deals" value={String(totalTraineeDeals)} color="text-[var(--accent-green)]" border="border-l-emerald-500/40" accent="rgba(16,185,129,0.08)" glow="rgba(16,185,129,0.25)" stagger={4} icon={<BarChart2 className="w-4 h-4 text-[var(--accent-green)]/50" />} />
          </div>

          <div className="card-surface rounded-2xl p-6">
            <h3 className="text-white font-bold text-sm mb-4 uppercase tracking-wider">Pay Breakdown</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <BreakdownRow color="bg-emerald-400" label="Paid" textColor="text-[var(--accent-green)]" value={fmt$(totalEarned)} />
              <BreakdownRow color="bg-yellow-400" label="Pending" textColor="text-yellow-400" value={fmt$(pendingAmount)} />
              <BreakdownRow color="bg-[var(--text-muted)]" label="Draft" textColor="text-[var(--text-secondary)]" value={fmt$(draftAmount)} />
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE TRAINEES */}
      {activeTab === 'active' && (
        <div key="active" className="animate-tab-enter space-y-4">
          <TraineeSearch
            value={traineeSearch}
            onChange={setTraineeSearch}
            count={activeTrainees.length}
            sort={traineeSort}
            sortDir={traineeSortDir}
            onSort={handleTraineeSort}
          />
          {activeTrainees.length === 0 ? (
            <EmptyState
              icon={<GraduationCap className="w-12 h-12 text-[var(--text-dim)]" />}
              title={traineeSearch ? 'No active trainees match your search' : 'No active trainees'}
              subtitle={traineeSearch ? 'Try a different search or check Residuals' : 'Mark a trainee as graduated to move them to Residuals'}
            />
          ) : (
            <div className="space-y-4">
              {activeTrainees.map((t, idx) => (
                <ActiveTraineeCard
                  key={t.assignment.id}
                  data={t}
                  idx={idx}
                  onGraduate={() => markGraduated(t.assignment.id)}
                  onOpenProject={(id) => setSlideProjectId(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* RESIDUALS */}
      {activeTab === 'residuals' && (
        <div key="residuals" className="animate-tab-enter space-y-4">
          <TraineeSearch
            value={traineeSearch}
            onChange={setTraineeSearch}
            count={residualTrainees.length}
            sort={traineeSort}
            sortDir={traineeSortDir}
            onSort={handleTraineeSort}
          />
          {residualTrainees.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="w-12 h-12 text-[var(--text-dim)]" />}
              title={traineeSearch ? 'No residuals match your search' : 'No residual trainees'}
              subtitle={traineeSearch ? 'Try a different search' : 'Graduated trainees appear here — their overrides still earn until tiers max out'}
            />
          ) : (
            <div className="space-y-4">
              {residualTrainees.map((t, idx) => (
                <ResidualTraineeCard
                  key={t.assignment.id}
                  data={t}
                  idx={idx}
                  recentEntries={trainerEntries
                    .filter((e) => e.projectId && t.projects.some((p) => p.id === e.projectId) && e.repId === t.assignment.trainerId)
                    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
                    .slice(0, 5)}
                  onResume={() => resumeTraining(t.assignment.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* PAYMENTS */}
      {activeTab === 'payments' && (
        <div key="payments" className="animate-tab-enter space-y-4">
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

          {filteredPayments.length === 0 ? (
            <EmptyState
              icon={<DollarSign className="w-12 h-12 text-[var(--text-dim)]" />}
              title={paymentSearch || paymentStatusFilter !== 'all' ? 'No payments match your filters' : 'No trainer payments yet'}
              subtitle={paymentSearch || paymentStatusFilter !== 'all' ? 'Try adjusting your search or status filter' : 'Override payments appear here when trainees close deals'}
            />
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
                    {filteredPayments.map((entry, idx) => (
                      <tr
                        key={entry.id}
                        className={`table-row-enter row-stagger-${Math.min(idx, 24)} hover:bg-[var(--surface-card)]/30 transition-colors`}
                      >
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

      {/* RATE SCHEDULE */}
      {activeTab === 'rates' && (
        <div key="rates" className="animate-tab-enter space-y-4">
          {filteredTrainees.map((t, idx) => (
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
                <StatusPillBadge status={t.status} />
              </div>

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
                            isActive ? 'bg-amber-500/8' : 'hover:bg-[var(--surface-card)]/30'
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-semibold ${isActive ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
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

      {/* ── Project slide-over (coaching read-only view) ──────────────────── */}
      {slideProjectId && (
        <ProjectSlideOver
          projectId={slideProjectId}
          projects={projects}
          reps={reps}
          onClose={() => setSlideProjectId(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, color, border, accent, glow, stagger, icon,
}: {
  label: string; value: string; color: string; border: string; accent: string; glow: string; stagger: number; icon: React.ReactNode;
}) {
  return (
    <div
      className={`card-surface card-surface-stat rounded-2xl p-5 border-l-2 ${border} animate-slide-in-scale stagger-${stagger}`}
      style={{ '--card-accent': accent } as React.CSSProperties}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[var(--text-muted)] text-[10px] font-semibold uppercase tracking-widest">{label}</span>
        {icon}
      </div>
      <p
        className={`text-3xl font-black tabular-nums ${color} stat-value`}
        style={{ textShadow: `0 0 20px ${glow}` }}
      >
        {value}
      </p>
    </div>
  );
}

function BreakdownRow({ color, label, textColor, value }: { color: string; label: string; textColor: string; value: string }) {
  return (
    <div className="flex items-center gap-3 bg-[var(--surface-card)]/40 rounded-xl px-4 py-3">
      <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-secondary)] text-xs">{label}</p>
        <p className={`${textColor} font-bold tabular-nums`}>{value}</p>
      </div>
    </div>
  );
}

function TraineeSearch({
  value, onChange, count, sort, sortDir, onSort,
}: {
  value: string; onChange: (v: string) => void; count: number;
  sort: 'name' | 'deals' | 'earnings'; sortDir: SortDir;
  onSort: (f: 'name' | 'deals' | 'earnings') => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="Search trainees..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[var(--surface)] border border-[var(--border-subtle)] text-white rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder-slate-500"
        />
      </div>
      {value && (
        <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full self-center">{count} result{count !== 1 ? 's' : ''}</span>
      )}
      <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit">
        {(['name', 'deals', 'earnings'] as const).map((s) => (
          <button
            key={s}
            onClick={() => onSort(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              sort === s ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {sort === s && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl bg-[var(--surface)]/30 border border-dashed border-[var(--border-subtle)]">
      {icon}
      <div className="text-center">
        <p className="text-lg font-semibold text-white">{title}</p>
        <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

// Expandable active-trainee card. Lists projects when expanded — no $$.
function ActiveTraineeCard({
  data, idx, onGraduate, onOpenProject,
}: {
  data: {
    assignment: TrainerAssignment; traineeId: string; traineeName: string; traineeRole: string;
    dealCount: number; currentRate: number; activeTierIndex: number; nextThreshold: number | null;
    earningsFromTrainee: number; status: AdminStatus; projects: Project[];
  };
  idx: number;
  onGraduate: () => void;
  onOpenProject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { assignment: t, traineeName, traineeRole, dealCount, currentRate, activeTierIndex, nextThreshold, projects, status } = data;

  const prevThreshold = activeTierIndex > 0 ? t.tiers[activeTierIndex - 1].upToDeal ?? 0 : 0;
  const progressMax = nextThreshold ? (nextThreshold + 1) - prevThreshold : 1;
  const progressVal = nextThreshold ? Math.min(dealCount - prevThreshold, progressMax) : 1;
  const progressPct = Math.round((progressVal / progressMax) * 100);

  const roleBadgeColor =
    traineeRole === 'closer' ? 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20'
    : traineeRole === 'setter' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
    : 'text-teal-400 bg-teal-500/10 border-teal-500/20';

  const activeProjects = projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold' && p.phase !== 'Completed');

  return (
    <div className={`card-surface rounded-2xl p-5 animate-slide-in-scale stagger-${Math.min(idx + 1, 6)}`}>
      <div className="flex items-start gap-4">
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-[2px] rounded-full flex-shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: 'var(--navy-card)' }}>
            {getInitials(traineeName)}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/dashboard/users/${data.traineeId}`} className="text-white font-bold text-sm truncate hover:text-[var(--accent-cyan)] transition-colors">
              {traineeName}
            </Link>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${roleBadgeColor}`}>
              {traineeRole === 'both' ? 'Closer/Setter' : traineeRole.charAt(0).toUpperCase() + traineeRole.slice(1)}
            </span>
            <StatusPillBadge status={status} />
          </div>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {dealCount} deal{dealCount !== 1 ? 's' : ''} · {activeProjects.length} active in pipeline
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onGraduate}
            title="Mark as graduated — moves this trainee to Residuals"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Mark Graduated
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-card)]/60 transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-amber-400/80 text-xs font-semibold">
            Tier {activeTierIndex + 1}: ${currentRate.toFixed(2)}/W
          </span>
          {nextThreshold ? (
            <span className="text-[var(--text-muted)] text-[10px]">{dealCount}/{nextThreshold + 1} deals</span>
          ) : (
            <span className="text-[var(--text-muted)] text-[10px]">Final tier</span>
          )}
        </div>
        <div className="h-1.5 bg-[var(--surface-card)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4 motion-safe:animate-[fadeSlideIn_200ms_cubic-bezier(0.16,1,0.3,1)_both]">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">Projects</p>
          {projects.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic">No projects yet</p>
          ) : (
            <div className="space-y-1.5">
              {projects.map((p, pIdx) => (
                <button
                  key={p.id}
                  onClick={() => onOpenProject(p.id)}
                  className={`w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--surface-card)]/60 transition-colors group table-row-enter row-stagger-${Math.min(pIdx, 12)}`}
                >
                  <span className="flex-1 min-w-0 text-sm text-white truncate group-hover:text-[var(--accent-cyan)] transition-colors">{p.customerName}</span>
                  <PhasePill phase={p.phase} />
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">{formatDate(p.soldDate)}</span>
                  <span className="text-[10px] text-[var(--text-secondary)] tabular-nums whitespace-nowrap">{p.kWSize.toFixed(1)} kW</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResidualTraineeCard({
  data, idx, recentEntries, onResume,
}: {
  data: {
    assignment: TrainerAssignment; traineeId: string; traineeName: string;
    dealCount: number; currentRate: number; activeTierIndex: number; nextThreshold: number | null;
    earningsFromTrainee: number; status: AdminStatus;
  };
  idx: number;
  recentEntries: PayrollEntry[];
  onResume: () => void;
}) {
  const { assignment: t, traineeName, dealCount, currentRate, activeTierIndex, nextThreshold, earningsFromTrainee, status } = data;

  const prevThreshold = activeTierIndex > 0 ? t.tiers[activeTierIndex - 1].upToDeal ?? 0 : 0;
  const progressMax = nextThreshold ? (nextThreshold + 1) - prevThreshold : 1;
  const progressVal = nextThreshold ? Math.min(dealCount - prevThreshold, progressMax) : 1;
  const progressPct = Math.round((progressVal / progressMax) * 100);

  return (
    <div className={`card-surface rounded-2xl p-5 animate-slide-in-scale stagger-${Math.min(idx + 1, 6)}`}>
      <div className="flex items-start gap-4 mb-4">
        <div className="bg-gradient-to-br from-slate-500 to-slate-700 p-[2px] rounded-full flex-shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: 'var(--navy-card)' }}>
            {getInitials(traineeName)}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/dashboard/users/${data.traineeId}`} className="text-white font-bold text-sm truncate hover:text-[var(--accent-cyan)] transition-colors">
              {traineeName}
            </Link>
            <StatusPillBadge status={status} />
          </div>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Graduated — residual override still earning on existing tier capacity
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onResume}
            title="Resume training — move back to Active Trainees"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Resume Training
          </button>
        </div>
      </div>

      {/* Earnings grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Current Rate</p>
          <p className="text-amber-400 font-bold tabular-nums">${currentRate.toFixed(2)}/W</p>
        </div>
        <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total Earned</p>
          <p className="text-[var(--accent-green)] font-bold tabular-nums">{fmt$(earningsFromTrainee)}</p>
        </div>
        <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Tier Progress</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1.5 bg-[var(--surface-card)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
              {nextThreshold ? `${dealCount}/${nextThreshold + 1}` : '∞'}
            </span>
          </div>
        </div>
      </div>

      {/* Recent payments */}
      <div>
        <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">Recent Override Payments</p>
        {recentEntries.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] italic">No override payments yet</p>
        ) : (
          <div className="space-y-1">
            {recentEntries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-[var(--surface-card)]/30">
                <span className="text-sm text-[var(--text-secondary)] truncate">{e.customerName || e.notes || '—'}</span>
                <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">{formatDate(e.date)}</span>
                <span className="text-sm text-amber-400 font-semibold tabular-nums whitespace-nowrap">{fmt$(e.amount)}</span>
                <StatusBadge status={e.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Project slide-over (coaching, read-only) ──────────────────────────────
type ProjectActivityEntry = { id: string; type: string; detail: string; createdAt: string };

function ProjectSlideOver({
  projectId, projects, reps, onClose,
}: {
  projectId: string; projects: Project[]; reps: Rep[]; onClose: () => void;
}) {
  const project = projects.find((p) => p.id === projectId);
  // Tracks activity state keyed by projectId. Keeping the key alongside the
  // data lets us derive "loading" = `state.key !== projectId` without calling
  // setState synchronously in the effect (ESLint flag
  // react-hooks/set-state-in-effect). When projectId changes, the effect
  // kicks off a new fetch and replaces both fields atomically on success.
  const [activityState, setActivityState] = useState<{ key: string; entries: ProjectActivityEntry[] } | null>(null);
  const activityLoading = activityState?.key !== projectId;
  const activity = activityState?.key === projectId ? activityState.entries : null;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/activity?limit=10`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((data) => {
        if (cancelled) return;
        const entries = Array.isArray(data?.activities) ? data.activities : [];
        setActivityState({ key: projectId, entries });
      })
      .catch(() => {
        if (cancelled) return;
        setActivityState({ key: projectId, entries: [] });
      });
    return () => { cancelled = true; };
  }, [projectId]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!project) return null;

  const closerName = reps.find((r) => r.id === project.repId)?.name ?? project.repName ?? '—';
  const setterName = project.setterId ? reps.find((r) => r.id === project.setterId)?.name ?? project.setterName ?? '—' : null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 bottom-0 z-[70] w-full md:w-[520px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl overflow-y-auto motion-safe:animate-slide-in-right">
        <div className="sticky top-0 z-10 bg-[var(--surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)] px-5 py-4 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Coaching view · Read-only</p>
            <h3 className="text-white text-lg font-semibold mt-0.5 truncate">{project.customerName}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <PhasePill phase={project.phase} />
              <span className="text-[10px] text-[var(--text-muted)] tabular-nums px-2 py-0.5 rounded-full bg-[var(--surface-card)]/50 border border-[var(--border-subtle)]">
                {project.kWSize.toFixed(1)} kW
              </span>
              <span className="text-[10px] text-[var(--text-muted)] px-2 py-0.5 rounded-full bg-[var(--surface-card)]/50 border border-[var(--border-subtle)]">
                Sold {formatDate(project.soldDate)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Installer</p>
                <p className="text-sm text-white mt-0.5">{project.installer}</p>
              </div>
              <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Closer</p>
                <p className="text-sm text-white mt-0.5">{closerName}</p>
              </div>
              {setterName && (
                <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Setter</p>
                  <p className="text-sm text-white mt-0.5">{setterName}</p>
                </div>
              )}
              <div className="bg-[var(--surface-card)]/40 rounded-xl px-3 py-2">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Financer</p>
                <p className="text-sm text-white mt-0.5">{project.financer}</p>
              </div>
            </div>
          </div>

          {/* Milestone status (paid/pending only, no $$) */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">Milestones</p>
            <div className="grid grid-cols-3 gap-2">
              <MilestoneDot label="M1" paid={project.m1Paid} />
              <MilestoneDot label="M2" paid={project.m2Paid} />
              <MilestoneDot label="M3" paid={project.m3Paid} />
            </div>
          </div>

          {/* Phase history from ProjectActivity */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">Phase History</p>
            {activityLoading ? (
              <p className="text-xs text-[var(--text-muted)] italic">Loading…</p>
            ) : activity && activity.length > 0 ? (
              <ol className="space-y-2">
                {activity.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-3 text-sm">
                    <span className="w-1.5 h-1.5 mt-[9px] rounded-full bg-amber-400/60 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate">{ev.detail}</p>
                      <p className="text-[10px] text-[var(--text-muted)] tabular-nums">
                        {new Date(ev.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-[var(--text-muted)] italic">No phase history recorded yet</p>
            )}
          </div>

          <p className="text-[10px] text-[var(--text-dim)] italic text-center pt-2">
            Coaching view — commission numbers and edit controls are hidden.
          </p>
        </div>
      </div>
    </>
  );
}

function MilestoneDot({ label, paid }: { label: string; paid: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 border text-center ${paid ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[var(--surface-card)]/40 border-[var(--border-subtle)]'}`}>
      <div className="flex items-center justify-center gap-1.5 mb-0.5">
        {paid ? (
          <Check className="w-3 h-3 text-emerald-400" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-[var(--text-dim)]" />
        )}
        <span className={`text-xs font-semibold ${paid ? 'text-emerald-300' : 'text-[var(--text-secondary)]'}`}>{label}</span>
      </div>
      <p className={`text-[10px] ${paid ? 'text-emerald-400/80' : 'text-[var(--text-muted)]'}`}>
        {paid ? 'Paid' : 'Pending'}
      </p>
    </div>
  );
}

// ─── New Assignment Modal ────────────────────────────────────────────────────

interface TierRow {
  ratePerW: string;
  upToDeal: string;
  perpetuity: boolean;
}

function NewAssignmentModal({
  reps,
  onClose,
  onCreated,
}: {
  reps: Rep[];
  onClose: () => void;
  onCreated: (assignment: TrainerAssignment) => void;
}) {
  const { toast } = useToast();
  const [trainerId, setTrainerId] = useState('');
  const [traineeId, setTraineeId] = useState('');
  const [isActiveTraining, setIsActiveTraining] = useState(true);
  const [tiers, setTiers] = useState<TierRow[]>([{ ratePerW: '0.20', upToDeal: '10', perpetuity: false }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Eligible trainers: users with repType set
  const trainerOptions = useMemo(
    () => reps.filter((r) => r.repType).sort((a, b) => a.name.localeCompare(b.name)),
    [reps],
  );
  // Eligible trainees: active reps, excluding chosen trainer
  const traineeOptions = useMemo(
    () => reps.filter((r) => r.active && r.id !== trainerId && r.repType).sort((a, b) => a.name.localeCompare(b.name)),
    [reps, trainerId],
  );

  const addTier = () => setTiers((prev) => [...prev, { ratePerW: '0.10', upToDeal: '', perpetuity: true }]);
  const removeTier = (idx: number) => setTiers((prev) => prev.filter((_, i) => i !== idx));
  const updateTier = (idx: number, field: keyof TierRow, value: string | boolean) => {
    setTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  };

  // Preview text
  const trainerName = reps.find((r) => r.id === trainerId)?.name ?? '';
  const traineeName = reps.find((r) => r.id === traineeId)?.name ?? '';
  const previewTiers = tiers.map((t) => ({
    rate: parseFloat(t.ratePerW) || 0,
    cap: t.perpetuity ? null : (parseInt(t.upToDeal) || null),
  }));
  const firstTier = previewTiers[0];
  const secondTier = previewTiers.length > 1 ? previewTiers[1] : null;

  const validate = (): string | null => {
    if (!trainerId) return 'Select a trainer';
    if (!traineeId) return 'Select a rep (trainee)';
    if (trainerId === traineeId) return 'Trainer and rep must be different';
    if (tiers.length === 0) return 'At least one tier is required';
    for (let i = 0; i < tiers.length; i++) {
      const rate = parseFloat(tiers[i].ratePerW);
      if (isNaN(rate) || rate < 0 || rate > MAX_TRAINER_RATE_PER_W) {
        return `Tier ${i + 1}: rate must be $0–$${MAX_TRAINER_RATE_PER_W}/W`;
      }
      if (!tiers[i].perpetuity) {
        const cap = parseInt(tiers[i].upToDeal);
        if (isNaN(cap) || cap <= 0 || !Number.isInteger(cap)) {
          return `Tier ${i + 1}: cap must be a positive integer or Perpetuity`;
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setSaving(true);

    const payload = {
      trainerId,
      traineeId,
      isActiveTraining,
      tiers: tiers.map((t) => ({
        ratePerW: parseFloat(t.ratePerW),
        upToDeal: t.perpetuity ? null : parseInt(t.upToDeal),
      })),
    };

    try {
      const res = await fetch('/api/trainer-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        setError('This trainer already has an assignment for this rep. Open their row to add tiers instead.');
        setSaving(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to create assignment');
        setSaving(false);
        return;
      }
      const data = await res.json();
      // Transform to client shape
      const assignment: TrainerAssignment = {
        id: data.id,
        trainerId: data.trainerId,
        traineeId: data.traineeId,
        isActiveTraining: data.isActiveTraining ?? true,
        tiers: (data.tiers ?? []).map((t: { upToDeal: number | null; ratePerW: number }) => ({
          upToDeal: t.upToDeal,
          ratePerW: t.ratePerW,
        })),
      };
      onCreated(assignment);
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && !saving && (e.metaKey || e.ctrlKey)) handleSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainerId, traineeId, tiers, isActiveTraining, saving]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-modal-backdrop flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)]/80 shadow-2xl shadow-black/40 animate-modal-panel rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/15">
              <GraduationCap className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold">New Assignment</h2>
              <p className="text-xs text-[var(--text-muted)]">Create a trainer-trainee relationship</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Trainer picker */}
          <div>
            <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Trainer</label>
            <SearchableSelect
              value={trainerId}
              onChange={setTrainerId}
              options={trainerOptions.map((r) => ({ value: r.id, label: r.name, sub: r.repType }))}
              placeholder="Select trainer..."
            />
          </div>

          {/* Trainee picker */}
          <div>
            <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-1">Rep (trainee)</label>
            <SearchableSelect
              value={traineeId}
              onChange={setTraineeId}
              options={traineeOptions.map((r) => ({ value: r.id, label: r.name, sub: r.repType }))}
              placeholder="Select rep..."
            />
          </div>

          {/* isActiveTraining */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActiveTraining}
              onChange={(e) => setIsActiveTraining(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border)] text-amber-500 focus:ring-amber-500/50 bg-[var(--surface-card)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">Active coaching</span>
            <span className="text-[10px] text-[var(--text-muted)]">(uncheck for Residuals from day one)</span>
          </label>

          {/* Tier list */}
          <div>
            <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider block mb-2">Tier Chain</label>
            <div className="space-y-2">
              {tiers.map((tier, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-[var(--surface-card)]/50 rounded-xl p-3 border border-[var(--border-subtle)]">
                  <span className="text-[10px] text-[var(--text-muted)] font-semibold w-6 flex-shrink-0">T{idx + 1}</span>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">$/W</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={MAX_TRAINER_RATE_PER_W}
                        value={tier.ratePerW}
                        onChange={(e) => updateTier(idx, 'ratePerW', e.target.value)}
                        className="w-full bg-[var(--surface)] border border-[var(--border)] text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <label className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Up to deal</label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tier.perpetuity}
                            onChange={(e) => updateTier(idx, 'perpetuity', e.target.checked)}
                            className="w-3 h-3 rounded border-[var(--border)] text-amber-500 focus:ring-amber-500/50 bg-[var(--surface)]"
                          />
                          <span className="text-[9px] text-[var(--text-muted)]">Perpetuity</span>
                        </label>
                      </div>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={tier.perpetuity ? '' : tier.upToDeal}
                        disabled={tier.perpetuity}
                        onChange={(e) => updateTier(idx, 'upToDeal', e.target.value)}
                        placeholder={tier.perpetuity ? 'n/a' : ''}
                        className={`w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                          tier.perpetuity ? 'text-[var(--text-dim)] opacity-50 cursor-not-allowed' : 'text-white'
                        }`}
                      />
                    </div>
                  </div>
                  {tiers.length > 1 && (
                    <button
                      onClick={() => removeTier(idx)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1"
                      title="Remove tier"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addTier}
              className="mt-2 text-xs text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add tier
            </button>
          </div>

          {/* Preview strip */}
          {trainerId && traineeId && firstTier && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-[var(--text-secondary)]">
              {firstTier.cap ? (
                <>
                  Next {firstTier.cap} deals by <span className="text-white font-medium">{traineeName}</span> will pay{' '}
                  <span className="text-amber-400 font-medium">{trainerName}</span> ${firstTier.rate.toFixed(2)}/W.
                  {secondTier && (
                    <> After cap, falls back to ${secondTier.rate.toFixed(2)}/W{secondTier.cap === null ? ' perpetuity' : ` for ${secondTier.cap} deals`}.</>
                  )}
                </>
              ) : (
                <>
                  All deals by <span className="text-white font-medium">{traineeName}</span> will pay{' '}
                  <span className="text-amber-400 font-medium">{trainerName}</span> ${firstTier.rate.toFixed(2)}/W perpetuity.
                </>
              )}
              {' '}Rate kicks in on M2 + M3 per installer pay schedule.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:text-white transition-colors border border-[var(--border-subtle)] hover:border-[var(--border)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Creating...' : 'Create Assignment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Backfill Wizard ─────────────────────────────────────────────────────────

type BackfillStep = 'select' | 'preview' | 'done';

interface BackfillPreview {
  m2Count: number;
  m3Count: number;
  m2Total: number;
  m3Total: number;
  entries: Array<{
    projectId: string;
    customerName: string;
    milestone: 'M2' | 'M3';
    amount: number;
    rate: number;
  }>;
  skipped: Array<{ projectId: string; customerName: string; reason: string }>;
}

function BackfillWizard({
  assignment,
  reps,
  projects,
  payrollEntries,
  onClose,
  onComplete,
}: {
  assignment: TrainerAssignment;
  reps: Rep[];
  projects: Project[];
  payrollEntries: PayrollEntry[];
  onClose: () => void;
  onComplete: (created: number, skipped: number) => void;
}) {
  const { toast } = useToast();
  const trainer = reps.find((r) => r.id === assignment.trainerId);
  const trainee = reps.find((r) => r.id === assignment.traineeId);
  const trainerName = trainer?.name ?? 'Unknown Trainer';
  const traineeName = trainee?.name ?? 'Unknown Rep';

  const [step, setStep] = useState<BackfillStep>('select');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'paidM2' | 'paidM3' | 'completed' | 'hasTrainer'>('all');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ created: number; skipped: Array<{ projectId: string; reason: string }> } | null>(null);

  // Find rep's projects
  const repProjects = useMemo(
    () => projects.filter((p) => (p.repId === assignment.traineeId || p.setterId === assignment.traineeId) && p.phase !== 'Cancelled'),
    [projects, assignment.traineeId],
  );

  // Determine which projects already have trainer entries for this trainer
  const projectsWithTrainer = useMemo(() => {
    const ids = new Set<string>();
    for (const e of payrollEntries) {
      if (e.paymentStage === 'Trainer' && e.repId === assignment.trainerId && e.projectId) {
        ids.add(e.projectId);
      }
    }
    return ids;
  }, [payrollEntries, assignment.trainerId]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    let list = repProjects;
    if (statusFilter === 'paidM2') list = list.filter((p) => p.m2Paid);
    if (statusFilter === 'paidM3') list = list.filter((p) => p.m3Paid);
    if (statusFilter === 'completed') list = list.filter((p) => p.phase === 'Completed');
    if (statusFilter === 'hasTrainer') list = list.filter((p) => projectsWithTrainer.has(p.id));
    return list.sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? ''));
  }, [repProjects, statusFilter, projectsWithTrainer]);

  // Default selection: Installed/PTO/Completed with no existing trainer entry
  useEffect(() => {
    const defaultIds = new Set<string>();
    for (const p of repProjects) {
      if (['Installed', 'PTO', 'Completed'].includes(p.phase) && !projectsWithTrainer.has(p.id)) {
        defaultIds.add(p.id);
      }
    }
    setSelectedIds(defaultIds);
  }, [repProjects, projectsWithTrainer]);

  const toggleProject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selectedIds.size === filteredProjects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProjects.map((p) => p.id)));
    }
  };

  // Compute preview
  const preview = useMemo((): BackfillPreview => {
    const selected = projects.filter((p) => selectedIds.has(p.id));
    const entries: BackfillPreview['entries'] = [];
    const skipped: BackfillPreview['skipped'] = [];

    // Create a mutable copy of payroll entries for rate resolution
    const workingEntries = [...payrollEntries.map((e) => ({
      repId: e.repId,
      projectId: e.projectId,
      paymentStage: e.paymentStage,
    }))];

    const resolverAssignments = [{
      id: assignment.id,
      trainerId: assignment.trainerId,
      traineeId: assignment.traineeId,
      tiers: assignment.tiers,
      isActiveTraining: assignment.isActiveTraining,
    }];

    for (const p of selected) {
      const resolution = resolveTrainerRate(
        { id: p.id, trainerId: p.trainerId, trainerRate: p.trainerRate },
        p.repId === assignment.traineeId ? p.repId : p.setterId,
        resolverAssignments,
        workingEntries,
      );

      if (resolution.rate <= 0) {
        skipped.push({ projectId: p.id, customerName: p.customerName, reason: 'Rate is $0 (tiers maxed)' });
        continue;
      }

      const installPayPct = INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      const kW = p.kWSize;
      const rate = resolution.rate;

      // M2
      if (p.m2Paid || ['Installed', 'PTO', 'Completed'].includes(p.phase)) {
        const amt = Math.round(rate * kW * 1000 * (installPayPct / 100) * 100) / 100;
        if (amt > 0) entries.push({ projectId: p.id, customerName: p.customerName, milestone: 'M2', amount: amt, rate });
      }
      // M3
      if (installPayPct < 100 && (p.m3Paid || ['PTO', 'Completed'].includes(p.phase))) {
        const amt = Math.round(rate * kW * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
        if (amt > 0) entries.push({ projectId: p.id, customerName: p.customerName, milestone: 'M3', amount: amt, rate });
      }

      if (!entries.some((e) => e.projectId === p.id)) {
        skipped.push({ projectId: p.id, customerName: p.customerName, reason: 'No milestones qualify' });
      } else {
        // Track for tier counting
        workingEntries.push({ repId: assignment.trainerId, projectId: p.id, paymentStage: 'Trainer' });
      }
    }

    const m2Entries = entries.filter((e) => e.milestone === 'M2');
    const m3Entries = entries.filter((e) => e.milestone === 'M3');

    return {
      m2Count: m2Entries.length,
      m3Count: m3Entries.length,
      m2Total: m2Entries.reduce((s, e) => s + e.amount, 0),
      m3Total: m3Entries.reduce((s, e) => s + e.amount, 0),
      entries,
      skipped,
    };
  }, [selectedIds, projects, payrollEntries, assignment]);

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const res = await fetch(`/api/trainer-assignments/${assignment.id}/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIds: [...selectedIds],
          statusForMilestones: 'Paid',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? 'Backfill failed', 'error');
        setCommitting(false);
        return;
      }
      const data = await res.json();
      setCommitResult(data);
      setStep('done');
    } catch {
      toast('Network error', 'error');
    } finally {
      setCommitting(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 bottom-0 z-[70] w-full md:w-[600px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl overflow-y-auto motion-safe:animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Backfill Trainer Overrides</p>
              <h3 className="text-white text-lg font-semibold mt-0.5">
                {trainerName} on {traineeName}&apos;s deals
              </h3>
            </div>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Current tier chain */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {assignment.tiers.map((tier, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums border bg-amber-500/15 text-amber-300 border-amber-500/40"
              >
                ${tier.ratePerW.toFixed(2)}/W
                <span className="opacity-60">{tier.upToDeal === null ? 'perpetuity' : `cap ${tier.upToDeal}`}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="p-5">
          {/* Step 1: Deal selection */}
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Select which of {traineeName}&apos;s historical deals should receive retroactive trainer entries for {trainerName}.
              </p>

              {/* Filter chips */}
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['all', 'All'],
                  ['paidM2', 'Paid M2'],
                  ['paidM3', 'Paid M3'],
                  ['completed', 'Completed'],
                  ['hasTrainer', 'Has trainer'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === key ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'text-[var(--text-secondary)] bg-[var(--surface-card)] border border-[var(--border-subtle)] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Deal table */}
              <div className="card-surface rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[50vh]">
                  <table className="w-full text-sm">
                    <thead className="table-header-frost border-b border-[var(--border-subtle)] sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === filteredProjects.length && filteredProjects.length > 0}
                            onChange={toggleAll}
                            className="w-4 h-4 rounded border-[var(--border)] text-amber-500 focus:ring-amber-500/50 bg-[var(--surface)]"
                          />
                        </th>
                        <th className="text-left px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Customer</th>
                        <th className="text-left px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Sold</th>
                        <th className="text-right px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">kW</th>
                        <th className="text-center px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Phase</th>
                        <th className="text-center px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">M1/M2/M3</th>
                        <th className="text-center px-3 py-2 text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Trainer?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filteredProjects.length === 0 && (
                        <tr><td colSpan={7} className="text-center py-8 text-[var(--text-muted)] text-sm">No matching projects.</td></tr>
                      )}
                      {filteredProjects.map((p) => {
                        const hasTrainer = projectsWithTrainer.has(p.id);
                        return (
                          <tr key={p.id} className={`hover:bg-[var(--surface-card)]/30 transition-colors ${selectedIds.has(p.id) ? 'bg-amber-500/5' : ''}`}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(p.id)}
                                onChange={() => toggleProject(p.id)}
                                className="w-4 h-4 rounded border-[var(--border)] text-amber-500 focus:ring-amber-500/50 bg-[var(--surface)]"
                              />
                            </td>
                            <td className="px-3 py-2 text-white truncate max-w-[160px]">{p.customerName}</td>
                            <td className="px-3 py-2 text-[var(--text-secondary)] text-xs tabular-nums">{p.soldDate}</td>
                            <td className="px-3 py-2 text-right text-[var(--text-secondary)] tabular-nums">{p.kWSize.toFixed(1)}</td>
                            <td className="px-3 py-2 text-center"><PhasePill phase={p.phase} /></td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <span className={`w-2 h-2 rounded-full ${p.m1Paid ? 'bg-emerald-400' : 'bg-[var(--text-dim)]'}`} title={`M1 ${p.m1Paid ? 'Paid' : 'Pending'}`} />
                                <span className={`w-2 h-2 rounded-full ${p.m2Paid ? 'bg-emerald-400' : 'bg-[var(--text-dim)]'}`} title={`M2 ${p.m2Paid ? 'Paid' : 'Pending'}`} />
                                <span className={`w-2 h-2 rounded-full ${p.m3Paid ? 'bg-emerald-400' : 'bg-[var(--text-dim)]'}`} title={`M3 ${p.m3Paid ? 'Paid' : 'Pending'}`} />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {hasTrainer ? (
                                <span className="text-amber-400 text-[10px] font-medium">Yes</span>
                              ) : (
                                <span className="text-[var(--text-dim)] text-[10px]">No</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{selectedIds.size} of {filteredProjects.length} selected</p>
                <button
                  onClick={() => setStep('preview')}
                  disabled={selectedIds.size === 0}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  Preview Entries
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <button
                onClick={() => setStep('select')}
                className="text-xs text-[var(--text-muted)] hover:text-white transition-colors flex items-center gap-1"
              >
                <ChevronDown className="w-3 h-3 rotate-90" /> Back to selection
              </button>

              <div className="card-surface rounded-xl p-4 space-y-3">
                <h4 className="text-white font-semibold text-sm">Preview</h4>
                <p className="text-sm text-[var(--text-secondary)]">
                  Will create <span className="text-white font-medium">{preview.entries.length}</span> Trainer PayrollEntries totaling{' '}
                  <span className="text-amber-400 font-medium">${(preview.m2Total + preview.m3Total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--surface-card)]/50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">M2 Paid</p>
                    <p className="text-white font-bold tabular-nums">{preview.m2Count} entries</p>
                    <p className="text-amber-400 text-sm tabular-nums">${preview.m2Total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-[var(--surface-card)]/50 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">M3 Paid</p>
                    <p className="text-white font-bold tabular-nums">{preview.m3Count} entries</p>
                    <p className="text-amber-400 text-sm tabular-nums">${preview.m3Total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {/* Entry list */}
                {preview.entries.length > 0 && (
                  <div className="max-h-[200px] overflow-y-auto space-y-1">
                    {preview.entries.map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-[var(--border-subtle)]/50">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${e.milestone === 'M2' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-blue-500/10 text-blue-300'}`}>{e.milestone}</span>
                          <span className="text-[var(--text-secondary)] truncate">{e.customerName}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[var(--text-muted)] tabular-nums">${e.rate.toFixed(2)}/W</span>
                          <span className="text-amber-400 font-medium tabular-nums">${e.amount.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Skipped */}
                {preview.skipped.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Will skip ({preview.skipped.length})</p>
                    <div className="max-h-[100px] overflow-y-auto space-y-1">
                      {preview.skipped.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-[var(--text-dim)]">
                          <span className="truncate">{s.customerName}</span>
                          <span className="flex-shrink-0 ml-2">{s.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">Entries will be created as <span className="text-white font-medium">Paid</span> status (historical backfill).</p>
                <button
                  onClick={handleCommit}
                  disabled={committing || preview.entries.length === 0}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {committing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {committing ? 'Creating...' : `Create ${preview.entries.length} Entries`}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 'done' && commitResult && (
            <div className="text-center py-12 space-y-4">
              <div className="inline-flex p-4 rounded-2xl bg-emerald-500/10">
                <CheckCircle className="w-12 h-12 text-emerald-400" />
              </div>
              <h3 className="text-white text-lg font-bold">Backfill Complete</h3>
              <p className="text-[var(--text-secondary)] text-sm">
                Created <span className="text-white font-medium">{commitResult.created}</span> trainer entries
                {commitResult.skipped.length > 0 && (
                  <>, skipped <span className="text-amber-400 font-medium">{commitResult.skipped.length}</span></>
                )}
              </p>
              <button
                onClick={() => onComplete(commitResult.created, commitResult.skipped.length)}
                className="mt-4 px-6 py-2 rounded-xl text-sm font-semibold text-black transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TrainingSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 bg-[var(--surface-card)] rounded animate-skeleton" />
          <div className="h-8 w-48 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
        </div>
        <div className="h-3 w-64 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: '150ms' }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card-surface rounded-2xl p-5 space-y-3">
            <div className="h-[2px] w-12 bg-[var(--border)] rounded-full animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="h-3 w-16 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="h-8 w-24 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${i * 75 + 40}ms` }} />
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 w-fit mb-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 w-24 bg-[var(--surface-card)] rounded-lg animate-skeleton" style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>

      <div className="space-y-3">
        {[...Array(4)].map((_, i) => {
          const delay = i * 75;
          return (
            <div key={i} className="card-surface rounded-2xl p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[var(--surface-card)] flex-shrink-0 animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-[var(--surface-card)] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
                <div className="h-3 w-48 bg-[var(--surface-card)]/70 rounded animate-skeleton" style={{ animationDelay: `${delay + 40}ms` }} />
              </div>
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
