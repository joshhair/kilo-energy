'use client';

import { useState, useEffect, useRef, useMemo, type CSSProperties } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import {
  getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal,
  Project, InstallerPricingVersion, ProductCatalogProduct, ProductCatalogPricingVersion, ACTIVE_PHASES,
} from '../../../lib/data';
import { formatDate, fmt$, fmtCompact$, formatCompactKW, todayLocalDateStr } from '../../../lib/utils';
import { sumPaid } from '../../../lib/aggregators';
import { DollarSign, CheckCircle, Zap, Users, BarChart2, FolderKanban, ChevronRight, ChevronUp, ChevronDown, PlusCircle, Banknote, UserPlus, Settings, AlertCircle, HelpCircle, Trophy } from 'lucide-react';
import { PaginationBar } from './PaginationBar';
import { InlineBar } from './InlineBar';
import { type Period, getGreeting, getPhaseStuckThresholds, AnimatedStatValue } from './dashboard-utils';
import { NeedsAttentionSection, MyTasksSection, type MentionItem, PhaseBadge, StatusDot } from '../page';

export function AdminDashboard({
  projects,
  allProjects,
  payroll,
  allPayroll,
  period,
  setPeriod,
  PERIODS,
  totalReps,
  installerPricingVersions,
  productCatalogProducts,
  productCatalogPricingVersions,
  solarTechProducts,
  currentRepName,
  mentions,
  onToggleTask,
}: {
  projects: ReturnType<typeof useApp>['projects'];
  allProjects: ReturnType<typeof useApp>['projects'];
  payroll: ReturnType<typeof useApp>['payrollEntries'];
  allPayroll: ReturnType<typeof useApp>['payrollEntries'];
  period: Period;
  setPeriod: (p: Period) => void;
  PERIODS: { value: Period; label: string }[];
  totalReps: number;
  installerPricingVersions: InstallerPricingVersion[];
  productCatalogProducts: ProductCatalogProduct[];
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  solarTechProducts: ReturnType<typeof useApp>['solarTechProducts'];
  currentRepName: string | null;
  mentions: MentionItem[];
  onToggleTask: (projectId: string, messageId: string, checkItemId: string, completed: boolean) => Promise<void>;
}) {
  const { updateProject, reps, currentUserRepType, currentRepId, setViewAsUser } = useApp();

  // Search filter for Recent Projects table
  const [recentSearch, setRecentSearch] = useState('');
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [cancellationExpanded, setCancellationExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [topRepsExpanded, setTopRepsExpanded] = useState(true);

  // Top Reps by deal count — parity with MobileAdminDashboard's Top Reps
  // card. Uses standard competition rank so ties share position (two reps
  // at 5 deals both show #1). Top 5 so a 3-way top tie doesn't push real
  // next reps off-screen. Counts any commission-earning role on the deal
  // (primary closer, setter, co-closer, co-setter).
  const topReps = useMemo(() => {
    const repDeals: Record<string, number> = {};
    for (const p of projects) {
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
      repDeals[p.repId] = (repDeals[p.repId] || 0) + 1;
      if (p.setterId && p.setterId !== p.repId) {
        repDeals[p.setterId] = (repDeals[p.setterId] || 0) + 1;
      }
      for (const ac of p.additionalClosers ?? []) {
        repDeals[ac.userId] = (repDeals[ac.userId] || 0) + 1;
      }
      for (const as_ of p.additionalSetters ?? []) {
        repDeals[as_.userId] = (repDeals[as_.userId] || 0) + 1;
      }
    }
    const sorted = Object.entries(repDeals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let lastCount = -1;
    let lastRank = 0;
    return sorted.map(([id, count], i) => {
      const rank = count === lastCount ? lastRank : i + 1;
      lastCount = count;
      lastRank = rank;
      const rep = reps.find((r) => r.id === id);
      return { id, name: rep?.name ?? 'Unknown', count, rank };
    });
  }, [projects, reps]);

  // Sort & pagination for Recent Projects table
  type SortKey = 'customerName' | 'installer' | 'kWSize' | 'netPPW' | 'phase' | 'soldDate';
  const [sortKey, setSortKey] = useState<SortKey>('soldDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [recentPage, setRecentPage] = useState(1);
  const [recentRowsPerPage, setRecentRowsPerPage] = useState(10);

  useEffect(() => { setRecentPage(1); setRecentSearch(''); }, [period]);

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
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 text-[var(--text-dim)] inline ml-1" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-[var(--accent-emerald-text)] inline ml-1" />
      : <ChevronDown className="w-3 h-3 text-[var(--accent-emerald-text)] inline ml-1" />;
  };

  // Sliding pill for admin period tabs
  const adminPeriodTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [adminPeriodIndicator, setAdminPeriodIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = PERIODS.map(p => p.value).indexOf(period);
    const el = adminPeriodTabRefs.current[idx];
    if (el) setAdminPeriodIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period]);

  /** Returns { closerPerW, kiloPerW } for any project type, respecting overrides. */
  function getProjectBaselines(p: Project): { closerPerW: number; kiloPerW: number } {
    if (p.baselineOverride) return p.baselineOverride;
    if (p.installer === 'SolarTech' && p.solarTechProductId) {
      try {
        return getSolarTechBaseline(p.solarTechProductId, p.kWSize, solarTechProducts);
      } catch {
        return { closerPerW: 0, kiloPerW: 0 };
      }
    }
    if (p.installerProductId) {
      try {
        return getProductCatalogBaselineVersioned(productCatalogProducts, p.installerProductId, p.kWSize, p.soldDate, productCatalogPricingVersions);
      } catch {
        return { closerPerW: 0, kiloPerW: 0 };
      }
    }
    try {
      return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
    } catch {
      return { closerPerW: 0, kiloPerW: 0 };
    }
  }

  // Revenue = netPPW × kW × 1000 (actual contract value)
  // Profit  = (closerPerW − kiloPerW) × kW × 1000 (Kilo's baseline spread / margin)
  const { totalRevenue, totalProfit, totalPaid, totalKWSold, totalKWInstalled } = useMemo(() => {
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

    const todayStr = todayLocalDateStr();
    // Net paid-out across ALL types (Deal + Bonus + Trainer), all reps, all
    // in the selected period. Matches the payroll-tab "combined" total.
    const totalPaid = sumPaid(payroll, { asOf: todayStr });
    const totalKWSold = projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0);
    const totalKWInstalled = projects.filter((p) => p.phase === 'PTO' || p.phase === 'Installed' || p.phase === 'Completed').reduce((s, p) => s + p.kWSize, 0);

    return { totalRevenue, totalProfit, totalPaid, totalKWSold, totalKWInstalled };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getProjectBaselines closes over the same deps; re-declaring as a memo+dep pair would duplicate work
  }, [projects, payroll, solarTechProducts, installerPricingVersions, productCatalogProducts, productCatalogPricingVersions]);
  const totalUsers = totalReps;

  // ── Single-pass project aggregations (all-time, for attention cards) ──
  const { attentionActiveProjects } = useMemo(() => {
    const attentionSet = new Set(['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'On Hold']);

    const attentionActiveProjects: typeof projects = [];

    for (const p of allProjects) {
      if (attentionSet.has(p.phase)) attentionActiveProjects.push(p);
    }

    return { attentionActiveProjects };
  }, [allProjects]);

  // Compact money format for 6-column admin stat cards — prevents overflow
  // when values hit 8+ digits (e.g. $53,869,792 → $53.87M). Tooltip on
  // hover still shows the exact number via the card's title attr.
  const topStats = [
    { label: 'Kilo Revenue', value: fmtCompact$(Math.round(totalRevenue)), raw: Math.round(totalRevenue), format: (n: number) => fmtCompact$(n), icon: DollarSign, accentHex: 'var(--accent-emerald-solid)', accentGradient: 'from-emerald-500 to-emerald-400', href: '/dashboard/projects', tooltip: `Total revenue from installer baselines across all deals · ${fmt$(Math.round(totalRevenue))}` },
    { label: 'Gross Profit', value: fmtCompact$(Math.round(totalProfit)), raw: Math.round(totalProfit), format: (n: number) => fmtCompact$(n), icon: BarChart2, accentHex: 'var(--accent-cyan-solid)', accentGradient: totalProfit >= 0 ? 'from-emerald-500 to-emerald-400' : 'from-red-500 to-red-400', href: '/dashboard/projects', tooltip: `Revenue minus Kilo cost basis (closer baseline minus Kilo baseline) · ${fmt$(Math.round(totalProfit))}` },
    { label: 'Paid Out', value: fmtCompact$(Math.round(totalPaid)), raw: Math.round(totalPaid), format: (n: number) => fmtCompact$(n), icon: CheckCircle, accentHex: 'var(--accent-emerald-solid)', accentGradient: 'from-emerald-500 to-emerald-400', href: '/dashboard/payroll?status=Paid', tooltip: `Commission disbursed to reps via payroll in the selected period · ${fmt$(Math.round(totalPaid))}` },
    { label: 'Total Users', value: totalUsers.toString(), raw: totalUsers, format: (n: number) => n.toString(), icon: Users, accentHex: 'var(--accent-purple-solid)', accentGradient: 'from-purple-500 to-purple-400', href: '/dashboard/users', tooltip: 'Number of active sales reps in the system' },
    { label: 'Total Sold', value: formatCompactKW(totalKWSold), raw: Math.round(totalKWSold * 10), format: (n: number) => formatCompactKW(n / 10), icon: Zap, accentHex: 'var(--accent-teal-solid)', accentGradient: 'from-teal-500 to-teal-400', href: '/dashboard/projects', tooltip: 'Total system size from all deals (kW or MW when ≥1 MW)' },
    { label: 'Total Installed', value: formatCompactKW(totalKWInstalled), raw: Math.round(totalKWInstalled * 10), format: (n: number) => formatCompactKW(n / 10), icon: Zap, accentHex: 'var(--accent-red-solid)', accentGradient: 'from-red-500 to-red-400', href: '/dashboard/projects', tooltip: 'Total system size from Installed, PTO, or Completed projects' },
  ];

  // Period-filtered aggregations (stat cards, pipeline bar, installer ranking)
  const {
    periodActiveCount,
    periodInactiveCount,
    periodCompletedCount,
    periodPipelinePhaseCounts,
    periodPipelineNonEmpty,
    periodPipelineTotal,
    periodInstallerRanking,
    periodMaxInstallerDeals,
  } = useMemo(() => {
    const PIPELINE_PHASES = ACTIVE_PHASES.filter((ph) => ph !== 'Completed');

    let periodActiveCount = 0;
    let periodInactiveCount = 0;
    let periodCompletedCount = 0;
    const periodPipelinePhaseCounts: Record<string, number> = {};
    for (const phase of PIPELINE_PHASES) periodPipelinePhaseCounts[phase] = 0;
    const periodInstallerMap = new Map<string, { deals: number; kW: number; cancelled: number }>();

    for (const p of projects) {
      if (['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO'].includes(p.phase)) {
        periodActiveCount++;
      } else if (p.phase === 'Cancelled' || p.phase === 'On Hold') {
        periodInactiveCount++;
      } else if (p.phase === 'Completed') {
        periodCompletedCount++;
      }
      if (periodPipelinePhaseCounts[p.phase] !== undefined) periodPipelinePhaseCounts[p.phase]++;

      const prev = periodInstallerMap.get(p.installer) ?? { deals: 0, kW: 0, cancelled: 0 };
      prev.deals++;
      if (p.phase !== 'Cancelled' && p.phase !== 'On Hold') prev.kW += p.kWSize;
      if (p.phase === 'Cancelled') prev.cancelled++;
      periodInstallerMap.set(p.installer, prev);
    }

    const periodPipelineNonEmpty = PIPELINE_PHASES.filter((ph) => periodPipelinePhaseCounts[ph] > 0);
    const periodPipelineTotal = periodPipelineNonEmpty.reduce((sum, ph) => sum + periodPipelinePhaseCounts[ph], 0);
    const periodInstallerRanking = [...periodInstallerMap.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.deals - a.deals);
    const periodMaxInstallerDeals = Math.max(1, ...periodInstallerRanking.map((i) => i.deals));

    return {
      periodActiveCount,
      periodInactiveCount,
      periodCompletedCount,
      periodPipelinePhaseCounts,
      periodPipelineNonEmpty,
      periodPipelineTotal,
      periodInstallerRanking,
      periodMaxInstallerDeals,
    };
  }, [projects]);

  const pipelineStats = [
    { label: 'Active Projects', value: periodActiveCount, raw: periodActiveCount, format: (n: number) => n.toString(), accentHex: 'var(--accent-cyan-solid)', accentGradient: 'from-blue-500 to-blue-400', href: '/dashboard/projects', tooltip: 'Projects currently in the pipeline (New through PTO)' },
    { label: 'Inactive Projects', value: periodInactiveCount, raw: periodInactiveCount, format: (n: number) => n.toString(), accentHex: 'var(--text-dim)', accentGradient: 'from-blue-500 to-blue-400', href: '/dashboard/projects?status=inactive', tooltip: 'Projects that are cancelled or on hold' },
    { label: 'Completed Projects', value: periodCompletedCount, raw: periodCompletedCount, format: (n: number) => n.toString(), accentHex: 'var(--accent-emerald-solid)', accentGradient: 'from-emerald-500 to-emerald-400', href: '/dashboard/projects?phase=Completed', tooltip: 'Projects that have been fully completed' },
  ];

  // Inline pipeline phase colors for the segmented bar.
  // Note: phases need 8 visually distinct hues, more than the canonical
  // 7-accent vocabulary supports — these literals are intentional and
  // theme-independent (mid-saturation hues that read fine on both
  // dark and light backgrounds).
  const PHASE_HEX: Record<string, string> = {
    'New': '#38bdf8', 'Acceptance': '#818cf8', 'Site Survey': '#a78bfa',
    'Design': '#e879f9', 'Permitting': '#fbbf24', 'Pending Install': '#fb923c',
    'Installed': '#2dd4bf', 'PTO': 'var(--accent-cyan-solid)',
  };

  // Attention items count (used for All Clear vs Needs Attention)
  const PHASE_STUCK_THRESHOLDS_ADMIN = getPhaseStuckThresholds();
  const todayAdmin = new Date(); todayAdmin.setHours(0, 0, 0, 0);
  const attentionItemCount = (() => {
    let count = 0;
    for (const proj of attentionActiveProjects) {
      if (proj.flagged) count++;
    }
    for (const proj of attentionActiveProjects) {
      if (proj.flagged) continue;
      const threshold = PHASE_STUCK_THRESHOLDS_ADMIN[proj.phase];
      if (threshold == null) continue;
      const phaseSince = proj.phaseChangedAt ? new Date(proj.phaseChangedAt) : (() => {
        if (!proj.soldDate) return null;
        const [y, m, d] = proj.soldDate.split('-').map(Number);
        return new Date(y, m - 1, d);
      })();
      if (!phaseSince) continue;
      const diffDays = Math.floor((todayAdmin.getTime() - phaseSince.getTime()) / 86_400_000);
      if (diffDays > threshold) count++;
    }
    for (const proj of attentionActiveProjects) {
      if (proj.flagged) continue;
      if (proj.phase === 'On Hold') count++;
    }
    count += allPayroll.filter((e) => e.status === 'Draft' || e.status === 'Pending').length;
    return count;
  })();

  // GradCard color config for the 6 stat cards. Each gradient tints the
  // canonical surface-card with the card's accent color via color-mix —
  // this gives the accent-tinted dark feel in dark mode AND a soft
  // accent-tinted light feel in light mode, automatically. The text
  // color uses the -text variant which is the same as -solid in dark
  // mode but a darker, more saturated shade in light mode for legible
  // contrast on near-white surfaces.
  const tintedGrad = (accent: string) =>
    `linear-gradient(135deg, color-mix(in srgb, ${accent} 10%, var(--surface-card)) 0%, var(--surface-card) 100%)`;
  const gradCardConfig: Record<string, { color: string; grad: string }> = {
    'Kilo Revenue':      { color: 'var(--accent-emerald-text)', grad: tintedGrad('var(--accent-emerald-solid)') },
    'Gross Profit':      totalProfit < 0 ? { color: 'var(--accent-red-text)', grad: tintedGrad('var(--accent-red-solid)') } : { color: 'var(--accent-cyan-text)', grad: tintedGrad('var(--accent-cyan-solid)') },
    'Paid Out':          { color: 'var(--accent-amber-text)', grad: tintedGrad('var(--accent-amber-solid)') },
    'Total Users':       { color: 'var(--accent-purple-text)', grad: tintedGrad('var(--accent-purple-solid)') },
    'Total Sold':        { color: 'var(--accent-teal-text)',   grad: tintedGrad('var(--accent-teal-solid)') },
    'Total Installed':   { color: 'var(--text-muted)',         grad: tintedGrad('var(--text-muted)') },
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-[3px] w-12 rounded-full mb-3" style={{ background: 'linear-gradient(to right, var(--accent-emerald-solid), var(--accent-cyan-solid))' }} />
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '2rem', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>{getGreeting(currentRepName)}</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm font-medium tracking-wide" style={{ color: 'var(--text-dim)', fontFamily: "'DM Sans', sans-serif" }}>Admin Dashboard · Overview of all reps and deals</p>
            {currentUserRepType && currentRepId && currentRepName && (
              <button
                onClick={() => setViewAsUser({ id: currentRepId, name: currentRepName, role: 'rep' })}
                className="text-xs font-semibold px-3 py-1 rounded-full border transition-colors whitespace-nowrap"
                style={{ background: 'var(--accent-emerald-soft)', borderColor: 'var(--accent-emerald-glow)', color: 'var(--accent-emerald-text)' }}
              >
                My Rep View
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-1 tab-bar-container">
          {adminPeriodIndicator && <div className="tab-indicator" style={adminPeriodIndicator} />}
          {PERIODS.map((p, i) => (
            <button
              key={p.value}
              ref={(el) => { adminPeriodTabRefs.current[i] = el; }}
              onClick={() => setPeriod(p.value)}
              className={`relative z-10 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors active:scale-[0.97] ${
                period === p.value
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick-action toolbar — accent-tinted surface via color-mix so
           buttons theme correctly in both light and dark. */}
      <div className="grid grid-cols-4 gap-2.5 mb-7">
        {[
          { label: 'Run Payroll', Icon: Banknote,   accent: 'var(--accent-emerald-solid)', text: 'var(--accent-emerald-text)', href: '/dashboard/payroll'  },
          { label: 'Add User',    Icon: UserPlus,   accent: 'var(--accent-purple-solid)',  text: 'var(--accent-purple-text)',  href: '/dashboard/users'    },
          { label: 'New Deal',    Icon: PlusCircle, accent: 'var(--accent-cyan-solid)',    text: 'var(--accent-cyan-text)',    href: '/dashboard/new-deal' },
          { label: 'Settings',    Icon: Settings,   accent: 'var(--accent-amber-solid)',   text: 'var(--accent-amber-text)',   href: '/dashboard/settings' },
        ].map(({ label, Icon, accent, text, href }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 border font-bold text-sm transition-colors"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              background: `color-mix(in srgb, ${accent} 10%, var(--surface-card))`,
              borderColor: `color-mix(in srgb, ${accent} 25%, transparent)`,
              color: text,
            }}
          >
            <Icon className="w-[15px] h-[15px] flex-shrink-0" />
            {label}
          </Link>
        ))}
      </div>

      {/* Top 6 GradCard stats */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-4 mb-4">
        {topStats.map((stat) => {
          const gc = gradCardConfig[stat.label] ?? { color: stat.accentHex, grad: tintedGrad(stat.accentHex) };
          return (
            <Link key={stat.label} href={stat.href} className="group cursor-pointer hover:scale-[1.02] transition-all duration-200 hover:translate-y-[-2px]" style={{ textDecoration: 'none' }}>
              <div title={stat.tooltip} style={{
                background: gc.grad,
                border: `1px solid ${gc.color}40`,
                borderRadius: 16,
                padding: '18px 18px 16px',
                position: 'relative',
                overflow: 'hidden',
                flex: 1,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent)',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${gc.color}, transparent 70%)` }} />
                <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${gc.color}15 0%, transparent 70%)` }} />
                <p style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, marginBottom: 14 }}>{stat.label}</p>
                <AnimatedStatValue raw={stat.raw} format={stat.format} style={{ fontSize: 36, fontWeight: 700, color: gc.color, fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em', textShadow: `0 0 20px ${gc.color}50` }} />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Pipeline stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {pipelineStats.map((s, i) => (
          <Link key={s.label} href={s.href} className={`group card-surface card-surface-stat rounded-2xl p-5 h-full cursor-pointer hover:border-[var(--accent-emerald-solid)]/30 hover:scale-[1.02] transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-${i + 1}`} style={{ '--card-accent': `${s.accentHex}14` } as CSSProperties}>
            <div className="h-[2px] w-12 rounded-full mb-3" style={{ background: s.accentHex }} />
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--text-dim)', fontFamily: "'DM Sans', sans-serif" }}>
                {s.label}
                {'tooltip' in s && s.tooltip && (
                  <span className="relative group/tip">
                    <HelpCircle className="w-3 h-3 text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors cursor-help" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover/tip:block whitespace-normal w-48 rounded-lg bg-[var(--surface-card)] border border-[var(--border)]/60 px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-[var(--text-secondary)] shadow-xl leading-snug">
                      {s.tooltip}
                    </span>
                  </span>
                )}
              </p>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--text-dim)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <AnimatedStatValue raw={s.raw} format={s.format} className="stat-value text-3xl font-black tabular-nums animate-count-up" style={{ color: s.accentHex, fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em', textShadow: `0 0 20px ${s.accentHex}50` }} />
          </Link>
        ))}
      </div>

      {/* Pipeline Overview — inline segmented bar */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 26px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-emerald-solid)', boxShadow: '0 0 8px var(--accent-emerald-solid)', flexShrink: 0 }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif", margin: 0 }}>Pipeline Overview</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>{periodPipelineTotal} active deal{periodPipelineTotal !== 1 ? 's' : ''}</span>
        </div>
        {periodPipelineTotal > 0 ? (
          <>
            <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', marginBottom: 14 }}>
              {periodPipelineNonEmpty.map((phase) => (
                <div
                  key={phase}
                  style={{
                    width: `${(periodPipelinePhaseCounts[phase] / periodPipelineTotal) * 100}%`,
                    background: PHASE_HEX[phase] ?? 'var(--text-dim)',
                    transition: 'width 0.7s ease-out',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
              {periodPipelineNonEmpty.map((phase) => (
                <Link key={phase} href={`/dashboard/projects?phase=${encodeURIComponent(phase)}`} style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: PHASE_HEX[phase] ?? 'var(--text-dim)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif" }}>{phase}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>{periodPipelinePhaseCounts[phase]}</span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0', gap: 8 }}>
            <FolderKanban style={{ width: 32, height: 32, color: 'var(--text-dim)' }} />
            <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 14 }}>No active projects</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>Your pipeline will appear here once you close a deal.</p>
          </div>
        )}
      </div>

      {/* Needs Attention / All Clear */}
      {attentionItemCount === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent-emerald-solid)', borderRadius: 16, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'color-mix(in srgb, var(--accent-emerald-solid) 13%, transparent)', border: '1px solid var(--accent-emerald-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle style={{ width: 16, height: 16, color: 'var(--accent-emerald-text)' }} />
          </div>
          <div>
            <p style={{ color: 'var(--accent-emerald-display)', fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", margin: 0 }}>All Clear</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: "'DM Sans', sans-serif", margin: 0 }}>No items need attention right now.</p>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          <NeedsAttentionSection
            activeProjects={attentionActiveProjects}
            isAdmin
            onUnflag={(projectId) => updateProject(projectId, { flagged: false })}
            payrollAttentionCount={allPayroll.filter((e) => e.status === 'Draft' || e.status === 'Pending').length}
          />
        </div>
      )}

      <MyTasksSection mentions={mentions} onToggleTask={onToggleTask} />

      {/* ── Top Reps ─────────────────────────────────────────────────────────
          Parity with MobileAdminDashboard's Top Reps card. Desktop admin
          previously only saw Installer Insights — reps were invisible at
          the dashboard level, despite being the primary unit of perf
          review. Standard competition rank so ties share position. */}
      {topReps.length > 0 && (
        <div className="card-surface rounded-2xl p-5 mb-6">
          <button
            onClick={() => setTopRepsExpanded((e) => !e)}
            className="flex items-center gap-2 w-full text-left group"
          >
            <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'var(--accent-emerald-soft)' }}>
              <Trophy className="w-4 h-4 text-[var(--accent-emerald-text)]" />
            </div>
            <h2 className="text-[var(--text-primary)] font-bold text-base tracking-tight flex-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>Top Reps</h2>
            <span className="text-xs text-[var(--text-muted)] mr-2">
              {period === 'all' ? 'All time' : PERIODS.find((p) => p.value === period)?.label}
            </span>
            {topRepsExpanded
              ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
              : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
            }
          </button>
          <div className={`collapsible-panel ${topRepsExpanded ? 'open' : ''}`}>
            <div className="collapsible-inner">
              <div className="mt-4 space-y-2">
                {topReps.map((r) => {
                  const maxCount = topReps[0]?.count ?? 1;
                  return (
                    <div key={r.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--surface-card)]/30 transition-colors">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold tabular-nums shrink-0"
                        style={{
                          background: r.rank === 1 ? 'var(--accent-emerald-soft)' : r.rank === 2 ? 'color-mix(in srgb, var(--accent-cyan-solid) 15%, transparent)' : 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
                          color: r.rank === 1 ? 'var(--accent-emerald-solid)' : r.rank === 2 ? 'var(--accent-cyan-solid)' : 'var(--text-muted)',
                        }}
                      >
                        {r.rank}
                      </span>
                      <span className="flex-1 text-[var(--text-primary)] text-sm font-medium truncate">{r.name}</span>
                      <div className="w-24 shrink-0">
                        <InlineBar value={r.count} max={maxCount} fillClass="bg-[var(--accent-emerald-solid)]/70" />
                      </div>
                      <span className="text-[var(--text-secondary)] text-sm font-semibold tabular-nums shrink-0">{r.count} deal{r.count === 1 ? '' : 's'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Installer Insights ────────────────────────────────────────────── */}
      {(() => {
        const maxDeals = periodMaxInstallerDeals;
        return periodInstallerRanking.length > 0 ? (
          <div className="card-surface rounded-2xl p-5 mb-8">
            <button
              onClick={() => setInsightsExpanded(e => !e)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)' }}>
                <BarChart2 className="w-4 h-4 text-[var(--accent-amber-text)]" />
              </div>
              <h2 className="text-[var(--text-primary)] font-bold text-base tracking-tight flex-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>Installer Insights</h2>
              {insightsExpanded
                ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
                : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
              }
            </button>
            <div className={`collapsible-panel ${insightsExpanded ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead className="table-header-frost">
                      <tr className="border-b border-[var(--border-subtle)]">
                        <th className="text-left px-4 py-2 text-[var(--text-secondary)] font-medium text-xs">Installer</th>
                        <th className="text-left px-4 py-2 text-[var(--text-secondary)] font-medium text-xs">Deals</th>
                        <th className="text-left px-4 py-2 text-[var(--text-secondary)] font-medium text-xs">Total kW</th>
                        <th className="text-left px-4 py-2 text-[var(--text-secondary)] font-medium text-xs">Cancelled</th>
                        <th className="text-left px-4 py-2 text-[var(--text-secondary)] font-medium text-xs w-40">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodInstallerRanking.map((inst, i) => (
                        <tr key={inst.name} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-card)]/30 transition-colors">
                          <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium flex items-center gap-2">
                            {i < 3 && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full bg-gradient-to-br ${i === 0 ? 'from-yellow-400 to-amber-600' : i === 1 ? 'from-slate-300 to-slate-500' : 'from-amber-600 to-amber-800'} text-[var(--text-primary)]`}>#{i + 1}</span>}
                            {inst.name}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{inst.deals}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{inst.kW.toFixed(1)}</td>
                          <td className="px-4 py-2.5">
                            {inst.cancelled > 0 ? (
                              <span className="text-[var(--accent-red-text)] text-xs font-medium">{inst.cancelled}</span>
                            ) : (
                              <span className="text-[var(--text-dim)] text-xs">0</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <InlineBar value={inst.deals} max={maxDeals} fillClass="bg-amber-500/70" />
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
              <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-red-solid) 15%, transparent)' }}>
                <AlertCircle className="w-4 h-4 text-[var(--accent-red-text)]" />
              </div>
              <h2 className="text-[var(--text-primary)] font-bold text-base tracking-tight flex-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>Cancellation Reasons <span className="text-[var(--text-muted)] font-normal text-xs">(all time)</span></h2>
              <span className="text-[var(--text-muted)] text-xs mr-2">{cancelledProjects.length} cancelled</span>
              {cancellationExpanded
                ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
                : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
              }
            </button>
            <div className={`collapsible-panel ${cancellationExpanded ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <div className="space-y-2 mt-4">
                  {reasonList.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between bg-[var(--surface-card)]/40 rounded-lg px-4 py-2">
                      <span className="text-[var(--text-secondary)] text-sm">{reason}</span>
                      <span className="text-[var(--accent-red-text)] text-sm font-semibold tabular-nums">{count}</span>
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
        const periodFiltered = projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
        const searchFiltered = periodFiltered.filter((p) => {
          if (!recentSearch.trim()) return true;
          const q = recentSearch.trim().toLowerCase();
          return p.customerName.toLowerCase().includes(q) || (p.repName ?? '').toLowerCase().includes(q) || (p.subDealerName ?? '').toLowerCase().includes(q);
        });
        const sorted = [...searchFiltered].sort((a, b) => {
          let cmp = 0;
          switch (sortKey) {
            case 'customerName': cmp = a.customerName.localeCompare(b.customerName); break;
            case 'installer': cmp = a.installer.localeCompare(b.installer); break;
            case 'kWSize': cmp = a.kWSize - b.kWSize; break;
            case 'netPPW': cmp = (a.netPPW ?? 0) - (b.netPPW ?? 0); break;
            case 'phase': cmp = a.phase.localeCompare(b.phase); break;
            case 'soldDate': cmp = (a.soldDate ?? '').localeCompare(b.soldDate ?? ''); break;
          }
          return sortDir === 'asc' ? cmp : -cmp;
        });
        const totalPages = Math.max(1, Math.ceil(sorted.length / recentRowsPerPage));
        const safePage = Math.min(recentPage, totalPages);
        const startIdx = (safePage - 1) * recentRowsPerPage;
        const endIdx = Math.min(startIdx + recentRowsPerPage, sorted.length);
        const paginated = sorted.slice(startIdx, endIdx);
        const showM3 = periodFiltered.some((p) => (p.m3Amount ?? 0) > 0);
        const thCls = (col: SortKey) =>
          `text-left px-6 py-3 text-xs font-medium select-none cursor-pointer transition-colors ${
            sortKey === col
              ? 'text-[var(--accent-emerald-text)] bg-[var(--accent-emerald-solid)]/[0.04]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`;

        return (
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <button
            onClick={() => setRecentExpanded(e => !e)}
            className="flex items-center gap-2 text-left group"
          >
            <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base" style={{ fontFamily: "'DM Sans', sans-serif" }}>Recent Projects</h2>
            {recentExpanded
              ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
              : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
            }
          </button>
          {recentExpanded && <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search customer or rep..."
              value={recentSearch}
              onChange={(e) => { setRecentSearch(e.target.value); setRecentPage(1); }}
              className="bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] placeholder-slate-500 rounded-lg px-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] transition-colors"
            />
            {recentSearch.trim() && (
              <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded-full">{sorted.length} result{sorted.length !== 1 ? 's' : ''}</span>
            )}
          </div>}
        </div>
        <div className={`collapsible-panel ${recentExpanded ? 'open' : ''}`}>
          <div className="collapsible-inner">
            <div className="border-t border-[var(--border-subtle)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-header-frost sticky top-0 z-10 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-slate-700/50 after:to-transparent">
                    <tr className="border-b border-[var(--border-subtle)]">
                      {/* 1 */}<th className={thCls('customerName')} onClick={() => toggleSort('customerName')}>Customer<SortIcon col="customerName" /></th>
                      {/* 2 */}<th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium">Rep</th>
                      {/* 3 */}<th className={thCls('installer')} onClick={() => toggleSort('installer')}>Installer<SortIcon col="installer" /></th>
                      {/* 4 */}<th className={thCls('soldDate')} onClick={() => toggleSort('soldDate')}>Sold<SortIcon col="soldDate" /></th>
                      {/* 5 */}<th className={thCls('phase')} onClick={() => toggleSort('phase')}>Phase<SortIcon col="phase" /></th>
                      {/* 6 */}<th className={thCls('kWSize')} onClick={() => toggleSort('kWSize')}>kW<SortIcon col="kWSize" /></th>
                      {/* 7 */}<th className={thCls('netPPW')} onClick={() => toggleSort('netPPW')}>$/W<SortIcon col="netPPW" /></th>
                      {/* 8 */}<th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium">Est. Pay</th>
                      {/* 9 */}<th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium">M1</th>
                      {/* 10 */}<th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium">M2</th>
                      {/* 11 */}{showM3 && <th className="text-left px-6 py-3 text-[var(--text-secondary)] font-medium">M3</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((proj) => {
                      const isCancelled = proj.phase === 'Cancelled';
                      const coSetterPay = (proj.additionalSetters ?? []).reduce((s, c) => s + c.m1Amount + c.m2Amount + (c.m3Amount ?? 0), 0);
                      const coCloserPay = (proj.additionalClosers ?? []).reduce((s, c) => s + c.m1Amount + c.m2Amount + (c.m3Amount ?? 0), 0);
                      const closerPay = isCancelled ? 0 : ((proj.m1Amount ?? 0) + (proj.m2Amount ?? 0) + (proj.m3Amount ?? 0) + coCloserPay);
                      const setterPay = isCancelled ? 0 : ((proj.setterM1Amount ?? 0) + (proj.setterM2Amount ?? 0) + (proj.setterM3Amount ?? 0) + coSetterPay);
                      return (
                      <tr key={proj.id} className="border-b border-[var(--border-subtle)]/50 even:bg-[var(--surface-card)]/20 hover:bg-[var(--accent-emerald-solid)]/[0.03] transition-colors duration-150">
                        {/* 1 */}<td className="px-6 py-3">
                          <Link href={`/dashboard/projects/${proj.id}`} className="text-[var(--text-primary)] hover:text-[var(--accent-emerald-text)] transition-colors">{proj.customerName}</Link>
                          {proj.subDealerId && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-[var(--accent-amber-text)] border border-amber-500/20">Sub-Dealer</span>}
                        </td>
                        {/* 2 */}<td className="px-6 py-3 text-[var(--text-secondary)] text-xs">{proj.subDealerName ?? proj.repName}{proj.setterName ? <span className="text-[var(--text-dim)]"> / {proj.setterName}</span> : ''}</td>
                        {/* 3 */}<td className="px-6 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">{proj.installer}</td>
                        {/* 4 */}<td className="px-6 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">{formatDate(proj.soldDate)}</td>
                        {/* 5 */}<td className="px-6 py-3"><PhaseBadge phase={proj.phase} /></td>
                        {/* 6 */}<td className="px-6 py-3 text-[var(--text-secondary)]">{proj.kWSize}</td>
                        {/* 7 */}<td className="px-6 py-3 text-[var(--text-secondary)]">${(proj.netPPW ?? 0).toFixed(2)}</td>
                        {/* 8 */}<td className="px-6 py-3">
                          <span className="text-[var(--accent-emerald-text)] font-medium">${closerPay.toLocaleString()}</span>
                          {setterPay > 0 && <span className="block text-[var(--text-dim)] text-xs">+${setterPay.toLocaleString()} setter</span>}
                        </td>
                        {/* 9 */}<td className="px-6 py-3"><StatusDot paid={proj.m1Paid} amount={isCancelled ? 0 : (proj.m1Amount ?? 0)} /></td>
                        {/* 10 */}<td className="px-6 py-3"><StatusDot paid={proj.m2Paid} amount={isCancelled ? 0 : (proj.m2Amount ?? 0)} /></td>
                        {/* 11 */}{showM3 && <td className="px-6 py-3"><StatusDot paid={proj.m3Paid} amount={isCancelled ? 0 : (proj.m3Amount ?? 0)} /></td>}
                      </tr>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={showM3 ? 11 : 10} className="px-6 py-10 text-center text-[var(--text-muted)]">
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

