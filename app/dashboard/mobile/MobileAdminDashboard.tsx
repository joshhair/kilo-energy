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
import MobileSection from './shared/MobileSection';
import MobileBadge from './shared/MobileBadge';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return fmt$(n);
}

function fmtKW(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

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

  const activeCount = useMemo(
    () => projects.filter((p) => ACTIVE_PHASES.includes(p.phase)).length,
    [projects],
  );

  const totalKW = useMemo(
    () =>
      projects
        .filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold')
        .reduce((s, p) => s + p.kWSize, 0),
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

  const { draftCount, pendingCount } = useMemo(
    () => {
      let dC = 0, pC = 0;
      for (const e of payrollEntries) {
        if (e.status === 'Draft') dC++;
        else if (e.status === 'Pending') pC++;
      }
      return { draftCount: dC, pendingCount: pC };
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
    <div className="px-5 pt-4 pb-28 space-y-8">
      <MobilePageHeader title="Dashboard" />

      {/* Hero — total revenue, no card wrapper */}
      <div>
        <p className="text-4xl font-black text-white tabular-nums">{fmtCompact(Math.round(totalRevenue))}</p>
        <p className="text-sm text-slate-500 mt-1">Revenue</p>
      </div>

      {/* Inline stats — 2x2 text grid, no cards */}
      <div className="grid grid-cols-2 gap-y-4 gap-x-8">
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{fmtCompact(Math.round(totalProfit))}</p>
          <p className="text-sm text-slate-500">Profit</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{activeCount}</p>
          <p className="text-sm text-slate-500">Active</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{reps.length}</p>
          <p className="text-sm text-slate-500">Reps</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{fmtKW(totalKW)}</p>
          <p className="text-sm text-slate-500">kW</p>
        </div>
      </div>

      {/* Pipeline */}
      <MobileSection title="Pipeline">
        <div className="space-y-1">
          {ACTIVE_PHASES.map((phase) => {
            const count = phaseCounts[phase] || 0;
            const pct =
              projects.length > 0
                ? (count / projects.length) * 100
                : 0;
            return (
              <div key={phase} className="flex items-center gap-3 py-2">
                <span className="text-sm text-slate-400 w-28 shrink-0">{phase}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full">
                  <div
                    className="h-full bg-blue-500/60 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-sm text-slate-500 w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </MobileSection>

      {/* Payroll */}
      <MobileSection title="Payroll">
        <div>
          {draftCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className="w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors border-b border-slate-800/30"
            >
              <span className="text-sm text-white">{draftCount} drafts need review</span>
              <span className="text-sm text-slate-500">→</span>
            </button>
          )}
          {pendingCount > 0 && (
            <button
              onClick={() => router.push('/dashboard/payroll')}
              className="w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors"
            >
              <span className="text-sm text-amber-400">{pendingCount} entries pending</span>
              <span className="text-sm text-slate-500">→</span>
            </button>
          )}
          {draftCount === 0 && pendingCount === 0 && (
            <p className="text-sm text-slate-500 py-3">All caught up.</p>
          )}
        </div>
      </MobileSection>

      {/* Recent Deals */}
      <MobileSection title="Recent Deals">
        {recentDeals.length === 0 ? (
          <p className="text-sm text-slate-500">No deals yet.</p>
        ) : (
          <div>
            {recentDeals.map((p, i) => {
              const rep = reps.find((r) => r.id === p.repId);
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                  className={`w-full flex items-center justify-between min-h-[48px] py-3 text-left active:bg-slate-800/40 transition-colors ${
                    i < recentDeals.length - 1 ? 'border-b border-slate-800/30' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{p.customerName}</p>
                    <p className="text-sm text-slate-500 truncate">{rep?.name ?? 'Unknown rep'}</p>
                  </div>
                  <div className="shrink-0 ml-2">
                    <MobileBadge value={p.phase} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
