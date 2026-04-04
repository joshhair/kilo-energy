'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { fmt$ } from '../../../lib/utils';
import {
  ACTIVE_PHASES,
  getSolarTechBaseline,
  getProductCatalogBaseline,
  getInstallerRatesForDeal,
} from '../../../lib/data';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileStatCard from './shared/MobileStatCard';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileBadge from './shared/MobileBadge';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PIPELINE_BAR_COLORS: Record<string, string> = {
  'New':             'bg-sky-500',
  'Acceptance':      'bg-indigo-500',
  'Site Survey':     'bg-violet-500',
  'Design':          'bg-fuchsia-500',
  'Permitting':      'bg-amber-500',
  'Pending Install': 'bg-orange-500',
  'Installed':       'bg-teal-500',
  'PTO':             'bg-emerald-500',
  'Completed':       'bg-green-500',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileAdminDashboard() {
  const {
    projects,
    payrollEntries,
    reps,
    installerPricingVersions,
    productCatalogProducts,
  } = useApp();
  const router = useRouter();

  // ── Baseline helper (same logic as desktop AdminDashboard) ────────────────

  function getProjectBaselines(p: (typeof projects)[number]) {
    if (p.baselineOverride) return p.baselineOverride;
    if (p.installer === 'SolarTech' && p.solarTechProductId) {
      return getSolarTechBaseline(p.solarTechProductId, p.kWSize);
    }
    if (p.installerProductId) {
      return getProductCatalogBaseline(productCatalogProducts, p.installerProductId, p.kWSize);
    }
    return getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, installerPricingVersions);
  }

  // ── Stat computations ─────────────────────────────────────────────────────

  const { totalRevenue, totalProfit } = useMemo(
    () =>
      projects.reduce(
        (acc, p) => {
          if (p.phase === 'Cancelled' || p.phase === 'On Hold') return acc;
          const { closerPerW, kiloPerW } = getProjectBaselines(p);
          const watts = p.kWSize * 1000;
          acc.totalRevenue += (p.netPPW ?? 0) * watts;
          acc.totalProfit += (closerPerW - kiloPerW) * watts;
          return acc;
        },
        { totalRevenue: 0, totalProfit: 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, installerPricingVersions, productCatalogProducts],
  );

  const totalPaid = useMemo(
    () =>
      payrollEntries
        .filter((e) => e.status === 'Paid')
        .reduce((s, e) => s + e.amount, 0),
    [payrollEntries],
  );

  const activeCount = useMemo(
    () =>
      projects.filter((p) =>
        ACTIVE_PHASES.includes(p.phase),
      ).length,
    [projects],
  );

  // ── Pipeline phase distribution ───────────────────────────────────────────

  const phaseCounts = useMemo(
    () =>
      ACTIVE_PHASES.reduce(
        (acc, phase) => {
          acc[phase] = projects.filter((p) => p.phase === phase).length;
          return acc;
        },
        {} as Record<string, number>,
      ),
    [projects],
  );

  // ── Payroll summary ───────────────────────────────────────────────────────

  const { draftTotal, draftCount, pendingTotal, pendingCount } = useMemo(
    () => {
      let dT = 0, dC = 0, pT = 0, pC = 0;
      for (const e of payrollEntries) {
        if (e.status === 'Draft') { dT += e.amount; dC++; }
        else if (e.status === 'Pending') { pT += e.amount; pC++; }
      }
      return { draftTotal: dT, draftCount: dC, pendingTotal: pT, pendingCount: pC };
    },
    [payrollEntries],
  );

  // ── Recent deals (last 5 by soldDate) ─────────────────────────────────────

  const recentDeals = useMemo(
    () =>
      [...projects]
        .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
        .slice(0, 5),
    [projects],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 pt-3 pb-24 space-y-6">
      <MobilePageHeader title="Dashboard" />

      {/* 2x2 stat grid */}
      <div className="grid grid-cols-2 gap-3">
        <MobileStatCard label="Total Paid" value={fmt$(Math.round(totalPaid))} color="text-emerald-400" />
        <MobileStatCard label="Revenue" value={fmt$(Math.round(totalRevenue))} color="text-blue-400" />
        <MobileStatCard label="Profit" value={fmt$(Math.round(totalProfit))} color="text-amber-400" />
        <MobileStatCard label="Active Projects" value={activeCount} color="text-white" />
      </div>

      {/* Pipeline */}
      <MobileSection title="Pipeline">
        <MobileCard>
          <div className="space-y-2">
            {ACTIVE_PHASES.map((phase) => {
              const count = phaseCounts[phase] || 0;
              const pct =
                projects.length > 0
                  ? (count / projects.length) * 100
                  : 0;
              return (
                <div key={phase} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-28 shrink-0">
                    {phase}
                  </span>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${PIPELINE_BAR_COLORS[phase] ?? 'bg-blue-500/60'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums w-8 text-right">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </MobileCard>
      </MobileSection>

      {/* Payroll Status */}
      <MobileSection title="Payroll Status">
        <MobileCard onTap={() => router.push('/dashboard/payroll')}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Draft</span>
              <span className="text-sm text-white tabular-nums">
                {fmt$(Math.round(draftTotal))}{' '}
                <span className="text-slate-500 text-xs">({draftCount} entries)</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Pending</span>
              <span className="text-sm text-amber-300 tabular-nums">
                {fmt$(Math.round(pendingTotal))}{' '}
                <span className="text-slate-500 text-xs">({pendingCount} entries)</span>
              </span>
            </div>
          </div>
        </MobileCard>
      </MobileSection>

      {/* Recent Deals */}
      <MobileSection title="Recent Deals">
        <MobileCard className="divide-y divide-slate-800/60 !p-0 overflow-hidden">
          {recentDeals.length === 0 ? (
            <p className="text-sm text-slate-500 p-4">No deals yet.</p>
          ) : (
            recentDeals.map((p) => {
              const rep = reps.find((r) => r.id === p.repId);
              return (
                <MobileListItem
                  key={p.id}
                  title={p.customerName}
                  subtitle={rep?.name ?? 'Unknown rep'}
                  right={<MobileBadge value={p.phase} />}
                  onTap={() => router.push(`/dashboard/projects/${p.id}`)}
                />
              );
            })
          )}
        </MobileCard>
      </MobileSection>
    </div>
  );
}
