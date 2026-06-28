/**
 * dashboard-profit.ts — the admin dashboard "Profit" total, computed server-side
 * so the native iOS dashboard can render it without kiloPerW on-device (the leak
 * we keep off the device).
 *
 * This is the BASELINE-SPREAD profit the admin dashboard shows:
 *   profit = Σ (closerPerW − kiloPerW) × kWSize × 1000
 * over the period's non-Cancelled / non-On-Hold projects. NOTE it differs from
 * the per-deal `kiloMargin` on the /api/data rollup — it uses closerPerW (NOT
 * netPPW) and does NOT subtract rep commission, so it's a different number.
 *
 * Single source of truth for BOTH MobileAdminDashboard.totalProfit and
 * /api/data's dashboardProfitCents, so web + iOS stay byte-identical.
 */
import { getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal, type InstallerBaseline } from './data';
import { isInPeriod, type Period } from './period';
import type { ViewBaselineData } from './baseline-resolve';

/** The fields the baseline ladder reads (no phase — that's only the profit filter). */
export interface BaselineInput {
  installer: string;
  solarTechProductId?: string | null;
  installerProductId?: string | null;
  kWSize: number;
  soldDate: string;
  baselineOverride?: InstallerBaseline | null;
}

/** A project for the profit sum: a baseline input plus its phase (skip filter). */
export interface DashboardProfitProject extends BaselineInput {
  phase: string;
}

/**
 * The admin-dashboard baseline ladder: override → SolarTech → product-catalog →
 * installer, each branch falling back to {0,0} on a deactivated product / bad
 * tier (NEVER throws). Mirrors the inline getBaselines in MobileAdminDashboard
 * exactly (per-branch catch, no fall-through) so the profit reconciles to the cent.
 */
export function resolveDashboardBaseline(
  p: BaselineInput,
  data: ViewBaselineData,
): { closerPerW: number; kiloPerW: number } {
  if (p.baselineOverride) return { closerPerW: p.baselineOverride.closerPerW, kiloPerW: p.baselineOverride.kiloPerW };
  if (p.installer === 'SolarTech' && p.solarTechProductId) {
    try { const b = getSolarTechBaseline(p.solarTechProductId, p.kWSize, data.solarTechProducts); return { closerPerW: b.closerPerW, kiloPerW: b.kiloPerW }; }
    catch { return { closerPerW: 0, kiloPerW: 0 }; }
  }
  if (p.installerProductId) {
    try { const b = getProductCatalogBaselineVersioned(data.productCatalogProducts, p.installerProductId, p.kWSize, p.soldDate, data.productCatalogPricingVersions); return { closerPerW: b.closerPerW, kiloPerW: b.kiloPerW }; }
    catch { return { closerPerW: 0, kiloPerW: 0 }; }
  }
  try { const b = getInstallerRatesForDeal(p.installer, p.soldDate, p.kWSize, data.installerPricingVersions); return { closerPerW: b.closerPerW, kiloPerW: b.kiloPerW }; }
  catch { return { closerPerW: 0, kiloPerW: 0 }; }
}

export interface DashboardProfitCents {
  allTime: number;
  thisMonth: number;
  thisQuarter: number;
  thisYear: number;
  lastMonth: number;
  lastYear: number;
}

const PERIOD_BY_KEY: Record<keyof DashboardProfitCents, Period> = {
  allTime: 'all',
  thisMonth: 'this-month',
  thisQuarter: 'this-quarter',
  thisYear: 'this-year',
  lastMonth: 'last-month',
  lastYear: 'last-year',
};

/** Map raw /api/data project rows → DashboardProfitProject: resolve the installer
 *  name, split productId by SolarTech, and parse baselineOverrideJson safely. */
export function toDashboardProfitProjects(
  rows: ReadonlyArray<{ phase: string; soldDate: string; kWSize: number; installerId: string; installer?: { name: string } | null; productId?: string | null; baselineOverrideJson?: string | null }>,
  instIdToName: Record<string, string>,
): DashboardProfitProject[] {
  return rows.map((p) => {
    const installer = p.installer?.name ?? instIdToName[p.installerId] ?? '';
    let baselineOverride: InstallerBaseline | null = null;
    if (p.baselineOverrideJson) { try { baselineOverride = JSON.parse(p.baselineOverrideJson) as InstallerBaseline; } catch { baselineOverride = null; } }
    return {
      phase: p.phase, soldDate: p.soldDate, kWSize: p.kWSize, installer,
      solarTechProductId: installer === 'SolarTech' ? (p.productId ?? null) : null,
      installerProductId: installer !== 'SolarTech' ? (p.productId ?? null) : null,
      baselineOverride,
    };
  });
}

/**
 * Total baseline-spread profit per period, INTEGER CENTS. Accumulates dollars
 * then rounds once per period (matching the web's dollar accumulation + currency
 * render). Caller gates this to admin / internal-PM only.
 */
export function computeDashboardProfitCents(
  projects: readonly DashboardProfitProject[],
  data: ViewBaselineData,
  now: Date,
): DashboardProfitCents {
  const d: DashboardProfitCents = { allTime: 0, thisMonth: 0, thisQuarter: 0, thisYear: 0, lastMonth: 0, lastYear: 0 };
  const keys = Object.keys(PERIOD_BY_KEY) as (keyof DashboardProfitCents)[];
  for (const p of projects) {
    if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
    const { closerPerW, kiloPerW } = resolveDashboardBaseline(p, data);
    const profit = (closerPerW - kiloPerW) * p.kWSize * 1000;
    for (const key of keys) {
      if (isInPeriod(p.soldDate, PERIOD_BY_KEY[key], now)) d[key] += profit;
    }
  }
  return {
    allTime: Math.round(d.allTime * 100),
    thisMonth: Math.round(d.thisMonth * 100),
    thisQuarter: Math.round(d.thisQuarter * 100),
    thisYear: Math.round(d.thisYear * 100),
    lastMonth: Math.round(d.lastMonth * 100),
    lastYear: Math.round(d.lastYear * 100),
  };
}
