'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$, formatDate } from '../../../lib/utils';
import {
  ACTIVE_PHASES,
  getSolarTechBaseline,
  getProductCatalogBaseline,
  getInstallerRatesForDeal,
} from '../../../lib/data';
import { AlertTriangle, TrendingUp, Users, Zap, CreditCard, FolderKanban, ChevronRight, Flag, Clock } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileBadge from './shared/MobileBadge';
import MobileCard from './shared/MobileCard';

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmt$(n);
}

export default function MobileAdminDashboard() {
  const {
    projects,
    payrollEntries,
    reps,
    installerPricingVersions,
    productCatalogProducts,
  } = useApp();
  const router = useRouter();

  // ── Baseline helper ─────────────────────────────────────────────────────
  function getBaselines(p: (typeof projects)[number]) {
    if (p.baselineOverride) return p.baselineOverride;
    if (p.installer === 'SolarTech' && p.solarTechProductId) return getSolarTechBaseline(p.solarTechProductId, p.kWSize);
    if (p.installerProductId) return getProductCatalogBaseline(productCatalogProducts, p.installerProductId, p.kWSize);
    return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
  }

  // ── Computations ────────────────────────────────────────────────────────
  const active = useMemo(() => projects.filter((p) => ACTIVE_PHASES.includes(p.phase)), [projects]);

  const { totalPaid, totalRevenue, totalProfit } = useMemo(() => {
    let paid = 0, rev = 0, prof = 0;
    for (const e of payrollEntries) { if (e.status === 'Paid') paid += e.amount; }
    for (const p of active) {
      const { closerPerW, kiloPerW } = getBaselines(p);
      const w = p.kWSize * 1000;
      rev += (p.netPPW ?? 0) * w;
      prof += (closerPerW - kiloPerW) * w;
    }
    return { totalPaid: paid, totalRevenue: rev, totalProfit: prof };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, payrollEntries, installerPricingVersions, productCatalogProducts]);

  const totalKW = useMemo(() => active.reduce((s, p) => s + p.kWSize, 0), [active]);
  const flaggedCount = useMemo(() => projects.filter((p) => p.flagged).length, [projects]);

  // Stalled projects (in same phase > 14 days)
  const stalledProjects = useMemo(() => {
    const now = Date.now();
    return active.filter((p) => {
      const sold = new Date(p.soldDate).getTime();
      const days = Math.floor((now - sold) / 86400000);
      return days > 14 && p.phase !== 'Completed';
    }).slice(0, 5);
  }, [active]);

  const flaggedProjects = useMemo(() => projects.filter((p) => p.flagged).slice(0, 5), [projects]);

  // Payroll
  const draftCount = useMemo(() => payrollEntries.filter((e) => e.status === 'Draft').length, [payrollEntries]);
  const pendingCount = useMemo(() => payrollEntries.filter((e) => e.status === 'Pending').length, [payrollEntries]);
  const pendingTotal = useMemo(() => payrollEntries.filter((e) => e.status === 'Pending').reduce((s, e) => s + e.amount, 0), [payrollEntries]);

  // Pipeline counts
  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const phase of ACTIVE_PHASES) counts[phase] = 0;
    for (const p of projects) { if (counts[p.phase] !== undefined) counts[p.phase]++; }
    return counts;
  }, [projects]);

  // Recent deals
  const recentDeals = useMemo(() => [...projects].sort((a, b) => b.soldDate.localeCompare(a.soldDate)).slice(0, 5), [projects]);

  // Top reps by deal count
  const topReps = useMemo(() => {
    const repDeals: Record<string, number> = {};
    for (const p of active) { repDeals[p.repId] = (repDeals[p.repId] || 0) + 1; }
    return Object.entries(repDeals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => {
        const rep = reps.find((r) => r.id === id);
        return { name: rep?.name ?? 'Unknown', count };
      });
  }, [active, reps]);

  const needsAttention = flaggedCount + draftCount + pendingCount + stalledProjects.length;

  return (
    <div className="px-5 pt-4 pb-24 space-y-5">
      <MobilePageHeader title="Dashboard" />

      {/* ── Hero: Total Paid with context ── */}
      <MobileCard>
        <div className="flex items-center justify-between mb-3">
          <p className="text-base text-slate-400">Total Paid</p>
          <TrendingUp className="w-5 h-5 text-emerald-500" />
        </div>
        <p className="text-4xl font-black text-emerald-400 tabular-nums">{fmtCompact(Math.round(totalPaid))}</p>
        <div className="flex items-center gap-4 mt-3">
          <div>
            <p className="text-lg font-bold text-white tabular-nums">{fmtCompact(Math.round(totalRevenue))}</p>
            <p className="text-sm text-slate-500">Revenue</p>
          </div>
          <div className="w-px h-8 bg-slate-800" />
          <div>
            <p className="text-lg font-bold text-white tabular-nums">{fmtCompact(Math.round(totalProfit))}</p>
            <p className="text-sm text-slate-500">Profit</p>
          </div>
        </div>
      </MobileCard>

      {/* ── Quick stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        <MobileCard onTap={() => router.push('/dashboard/projects')}>
          <FolderKanban className="w-5 h-5 text-blue-400 mb-2" />
          <p className="text-2xl font-black text-white tabular-nums">{active.length}</p>
          <p className="text-sm text-slate-500">Active</p>
        </MobileCard>
        <MobileCard onTap={() => router.push('/dashboard/reps')}>
          <Users className="w-5 h-5 text-blue-400 mb-2" />
          <p className="text-2xl font-black text-white tabular-nums">{reps.length}</p>
          <p className="text-sm text-slate-500">Reps</p>
        </MobileCard>
        <MobileCard>
          <Zap className="w-5 h-5 text-amber-400 mb-2" />
          <p className="text-2xl font-black text-white tabular-nums">{totalKW.toFixed(0)}</p>
          <p className="text-sm text-slate-500">kW</p>
        </MobileCard>
      </div>

      {/* ── Needs Attention (action-oriented) ── */}
      {needsAttention > 0 && (
        <MobileCard>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <p className="text-base font-semibold text-white">Needs Attention</p>
            <span className="ml-auto text-sm font-bold text-amber-400">{needsAttention}</span>
          </div>

          {draftCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:bg-slate-800/40 transition-colors border-b border-slate-800/20"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4 text-slate-400" />
                <span className="text-base text-white">{draftCount} payroll drafts</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          )}

          {pendingCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:bg-slate-800/40 transition-colors border-b border-slate-800/20"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4 text-amber-400" />
                <span className="text-base text-amber-300">{pendingCount} pending · {fmtCompact(pendingTotal)}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          )}

          {flaggedCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/projects')}
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:bg-slate-800/40 transition-colors border-b border-slate-800/20"
            >
              <div className="flex items-center gap-3">
                <Flag className="w-4 h-4 text-red-400" />
                <span className="text-base text-red-300">{flaggedCount} flagged projects</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          )}

          {stalledProjects.length > 0 && (
            <button
              onClick={() => router.push('/dashboard/projects')}
              className="w-full flex items-center justify-between min-h-[48px] py-2 text-left active:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-base text-slate-300">{stalledProjects.length} stalled projects</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          )}
        </MobileCard>
      )}

      {/* ── Pipeline snapshot ── */}
      <MobileCard>
        <p className="text-base font-semibold text-white mb-3">Pipeline</p>
        <div className="space-y-2">
          {ACTIVE_PHASES.filter((phase) => (phaseCounts[phase] || 0) > 0).map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct = active.length > 0 ? (count / active.length) * 100 : 0;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className="text-sm text-slate-400 w-24 shrink-0 truncate">{phase}</span>
                <div className="flex-1 h-2 bg-slate-800 rounded-full">
                  <div className="h-full bg-blue-500/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm font-semibold text-white w-6 text-right tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </MobileCard>

      {/* ── Top Reps ── */}
      {topReps.length > 0 && (
        <MobileCard onTap={() => router.push('/dashboard/reps')}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-base font-semibold text-white">Top Reps</p>
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </div>
          <div className="space-y-2">
            {topReps.map((r, i) => (
              <div key={r.name} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-blue-600 text-white">{i + 1}</span>
                <span className="text-base text-white flex-1">{r.name}</span>
                <span className="text-sm text-slate-400">{r.count} deals</span>
              </div>
            ))}
          </div>
        </MobileCard>
      )}

      {/* ── Recent Deals ── */}
      <MobileCard>
        <div className="flex items-center justify-between mb-3">
          <p className="text-base font-semibold text-white">Recent Deals</p>
          <button onClick={() => router.push('/dashboard/projects')} className="text-sm text-blue-400 active:text-blue-300">View all</button>
        </div>
        {recentDeals.length === 0 ? (
          <p className="text-base text-slate-500">No deals yet.</p>
        ) : (
          <div className="space-y-0">
            {recentDeals.map((p, i) => {
              const rep = reps.find((r) => r.id === p.repId);
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-2.5 text-left active:bg-slate-800/40 transition-colors ${i < recentDeals.length - 1 ? 'border-b border-slate-800/20' : ''}`}
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-base text-white truncate">{p.customerName}</p>
                    <p className="text-sm text-slate-500">{rep?.name ?? 'Unknown'} · {p.kWSize} kW</p>
                  </div>
                  <MobileBadge value={p.phase} />
                </button>
              );
            })}
          </div>
        )}
      </MobileCard>
    </div>
  );
}
