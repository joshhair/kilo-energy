/* eslint-disable @typescript-eslint/no-explicit-any --
 * Shared blitz computations consumed by both the desktop blitz detail
 * page and the mobile MobileBlitzDetail/Profitability surfaces. The
 * `/api/blitzes/[id]` payload has ~60 fields across blitz core,
 * participants, costs, and projects with deep nested co-closer/setter
 * arrays. Typing it properly would require a codegen'd DTO; using any
 * here keeps the helper consumable from multiple callsites without
 * forcing each one to rehand-roll the types.
 */

import { getSolarTechBaseline, getProductCatalogBaseline, getInstallerRatesForDeal } from './data';

// ────────────────────────────────────────────────────────────────────
// Leaderboard
// ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  userId: string;
  user: { id: string; firstName: string; lastName: string };
  name: string;
  initials: string;
  deals: number;
  kW: number;
  payout: number;
}

/**
 * Walks every project once and attributes deals/kW/payout to each
 * approved participant per the blitz-payout split rules. Returns an
 * entries array sorted by deals desc, then kW desc.
 *
 * Payout formula (verbatim copy from the original inline computation):
 *   self-gen (closer === setter): all 6 milestone amounts
 *   closer only:   m1 + m2 + m3
 *   setter only:   setterM1 + setterM2 + setterM3
 *   co-closer:     cc.m1 + cc.m2 + cc.m3
 *   co-setter:     cs.m1 + cs.m2 + cs.m3
 * kW is credited to the primary closer; if not a participant, the
 * first participating co-closer picks it up.
 */
export function computeBlitzLeaderboard(blitz: any): LeaderboardEntry[] {
  const participants = (blitz?.participants ?? []).filter((p: any) => p.joinStatus === 'approved');
  if (participants.length === 0) return [];

  const participantIds = new Set<string>(participants.map((p: any) => p.user.id));
  const statsByUserId = new Map<string, { deals: number; kW: number; payout: number }>();
  const bump = (userId: string, dKw: number, dPayout: number) => {
    const s = statsByUserId.get(userId) ?? { deals: 0, kW: 0, payout: 0 };
    s.deals += 1;
    s.kW += dKw;
    s.payout += dPayout;
    statsByUserId.set(userId, s);
  };

  for (const proj of blitz?.projects ?? []) {
    if (proj.phase === 'Cancelled' || proj.phase === 'On Hold') continue;
    const closerId = proj.closer?.id;
    const setterId = proj.setter?.id;
    const m1 = proj.m1Amount ?? 0;
    const m2 = proj.m2Amount ?? 0;
    const m3 = proj.m3Amount ?? 0;
    const sM1 = proj.setterM1Amount ?? 0;
    const sM2 = proj.setterM2Amount ?? 0;
    const sM3 = proj.setterM3Amount ?? 0;
    const kW = proj.kWSize;

    if (closerId && setterId && closerId === setterId) {
      if (participantIds.has(closerId)) bump(closerId, kW, m1 + m2 + m3 + sM1 + sM2 + sM3);
    } else {
      if (closerId && participantIds.has(closerId)) bump(closerId, kW, m1 + m2 + m3);
      if (setterId && setterId !== closerId && participantIds.has(setterId)) bump(setterId, 0, sM1 + sM2 + sM3);
    }
    const primaryCloserCredited = !!(closerId && participantIds.has(closerId));
    let coCloserKwCredited = false;
    for (const cc of proj.additionalClosers ?? []) {
      if (cc.userId && participantIds.has(cc.userId)) {
        const ccKw = (!primaryCloserCredited && !coCloserKwCredited) ? kW : 0;
        if (ccKw > 0) coCloserKwCredited = true;
        bump(cc.userId, ccKw, (cc.m1Amount ?? 0) + (cc.m2Amount ?? 0) + (cc.m3Amount ?? 0));
      }
    }
    for (const cs of proj.additionalSetters ?? []) {
      if (cs.userId && participantIds.has(cs.userId)) {
        bump(cs.userId, 0, (cs.m1Amount ?? 0) + (cs.m2Amount ?? 0) + (cs.m3Amount ?? 0));
      }
    }
  }

  const entries: LeaderboardEntry[] = participants.map((p: any) => {
    const stats = statsByUserId.get(p.user.id) ?? { deals: 0, kW: 0, payout: 0 };
    return {
      userId: p.user.id,
      user: p.user,
      name: `${p.user.firstName ?? ''} ${p.user.lastName ?? ''}`.trim(),
      initials: `${(p.user.firstName?.[0] ?? '').toUpperCase()}${(p.user.lastName?.[0] ?? '').toUpperCase()}`,
      deals: stats.deals,
      kW: stats.kW,
      payout: stats.payout,
    };
  });
  entries.sort((a, b) => b.deals - a.deals || b.kW - a.kW);
  return entries;
}

// ────────────────────────────────────────────────────────────────────
// Profitability
// ────────────────────────────────────────────────────────────────────

/**
 * Resolves the closer-baseline and kilo-baseline $/W for a project.
 * Respects per-project baselineOverrideJson, SolarTech, Product
 * Catalog, and flat-installer paths in that order.
 */
export function getBlitzProjectBaselines(
  p: any,
  deps: {
    solarTechProducts: any[];
    productCatalogProducts: any[];
    installerPricingVersions: any[];
  },
): { closerPerW: number; kiloPerW: number } {
  if (p.baselineOverrideJson) {
    try { return JSON.parse(p.baselineOverrideJson); } catch { /* fall through */ }
  }
  if (p.installer?.name === 'SolarTech' && p.productId) {
    return getSolarTechBaseline(p.productId, p.kWSize, deps.solarTechProducts);
  }
  if (p.productId) {
    return getProductCatalogBaseline(deps.productCatalogProducts, p.productId, p.kWSize);
  }
  const installerName = typeof p.installer === 'string' ? p.installer : p.installer?.name ?? '';
  return getInstallerRatesForDeal(installerName, p.soldDate ?? '', p.kWSize, deps.installerPricingVersions);
}

/**
 * Computes aggregate kilo margin across approved participant deals.
 * Margin per deal = (closerPerW - kiloPerW) × kW × 1000, minus $0.10/W
 * setter carve-out when closer !== setter. Deals not owned by any
 * approved participant (as closer or additional closer) are skipped.
 */
export function computeBlitzKiloMargin(
  approvedVisibleProjects: any[],
  approvedParticipantIds: Set<string>,
  deps: {
    solarTechProducts: any[];
    productCatalogProducts: any[];
    installerPricingVersions: any[];
  },
): number {
  return approvedVisibleProjects.reduce((s: number, p: any) => {
    const isSelfGen = p.closer?.id && p.closer?.id === p.setter?.id;
    const closerApproved = p.closer?.id && approvedParticipantIds.has(p.closer.id);
    const anyAdditionalCloserApproved = (p.additionalClosers ?? []).some((cc: any) => approvedParticipantIds.has(cc.userId));
    if (!isSelfGen && !closerApproved && !anyAdditionalCloserApproved) return s;
    const { closerPerW, kiloPerW } = getBlitzProjectBaselines(p, deps);
    const setterCost = (p.setter?.id && p.setter?.id !== p.closer?.id) ? 0.10 * p.kWSize * 1000 : 0;
    return s + (closerPerW - kiloPerW) * p.kWSize * 1000 - setterCost;
  }, 0);
}

/**
 * Sums costs grouped by category. Returned record is unordered;
 * callers sort for display.
 */
export function computeCostsByCategory(blitz: any): Record<string, number> {
  if (!blitz?.costs) return {};
  const result: Record<string, number> = {};
  for (const c of blitz.costs) {
    result[c.category] = (result[c.category] ?? 0) + c.amount;
  }
  return result;
}
