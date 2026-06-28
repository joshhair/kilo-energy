/**
 * kilo-pricing-arrays.ts — build the kiloPerW-INCLUDED baseline arrays
 * (solarTech / product-catalog / installer pricing) from raw prisma rows, for
 * SERVER-SIDE margin computation only.
 *
 * The client-facing /api/data + /api/blitzes responses scrub kiloPerW per the
 * viewer's tier visibility; this builder deliberately keeps kiloPerW so the
 * server can resolve baselines and emit ONLY cents. Used by lib/data-rollup.ts
 * (project margin rollup) and the blitz profitability endpoints
 * (getBlitzProjectBaselines) so there is exactly ONE copy of the transform.
 *
 * Server-only by convention — never import from a 'use client' module (it
 * carries kiloPerW). Allowlisted in scripts/check-sensitivity-coverage.mjs.
 */
import { pickEffectiveVersion } from './pricing/active-version';

// Structural subsets of the prisma rows the callers already load.
export interface RawTier { minKW: number; maxKW: number | null; closerPerW: number; setterPerW: number | null; kiloPerW: number; }
export interface RawInstallerPV { id: string; installerId: string; label: string; effectiveFrom: string; effectiveTo: string | null; rateType: string; tiers: RawTier[]; }
export interface RawVersion { tiers: RawTier[]; effectiveFrom: string; effectiveTo: string | null; }
export interface RawProduct { id: string; installerId: string; family: string; name: string; pricingVersions: RawVersion[]; }
export interface RawProductPV { id: string; productId: string; label: string; effectiveFrom: string; effectiveTo: string | null; tiers: RawTier[]; }

export interface KiloPricingArraysArgs {
  installerPricingVersions: RawInstallerPV[];
  products: RawProduct[];
  productPricingVersions: RawProductPV[];
  instIdToName: Record<string, string>;
  solarTechInstallerId: string | undefined;
  /** Current time for active-pricing-version selection (caller passes one `new Date()`). */
  now: Date;
}

/** Map a pricing version's active tiers to the kiloPerW-included shape. maxKW
 *  kept as null (not undefined) for unbounded top bands — only `=== null` is
 *  treated as open-ended by the resolvers. */
const tierMap = (av: RawVersion | undefined) =>
  (av?.tiers ?? []).map((t) => ({ minKW: t.minKW, maxKW: t.maxKW ?? null, closerPerW: t.closerPerW, setterPerW: t.setterPerW, kiloPerW: t.kiloPerW }));

export function buildKiloPricingArrays(args: KiloPricingArraysArgs) {
  const { installerPricingVersions, products, productPricingVersions, instIdToName, solarTechInstallerId, now } = args;

  const installerPricingVersionsOut = installerPricingVersions.flatMap((v) => {
    const installerName = instIdToName[v.installerId] ?? v.installerId;
    const isTiered = v.rateType === 'tiered' || v.tiers.length > 1;
    if (!isTiered && v.tiers.length === 0) return [];
    return [{
      id: v.id, installer: installerName, label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo,
      rates: isTiered
        ? { type: 'tiered' as const, bands: v.tiers.map((t) => ({ minKW: t.minKW, maxKW: t.maxKW ?? null, closerPerW: t.closerPerW, setterPerW: t.setterPerW ?? undefined, kiloPerW: t.kiloPerW })) }
        : { type: 'flat' as const, closerPerW: v.tiers[0].closerPerW, setterPerW: v.tiers[0].setterPerW ?? undefined, kiloPerW: v.tiers[0].kiloPerW },
    }];
  });
  const solarTechProducts = products.filter((p) => p.installerId === solarTechInstallerId)
    .map((p) => ({ id: p.id, family: p.family, financer: p.family, name: p.name, tiers: tierMap(pickEffectiveVersion(p.pricingVersions, now)) }));
  const productCatalogProducts = products.filter((p) => p.installerId !== solarTechInstallerId)
    .map((p) => ({ id: p.id, installer: instIdToName[p.installerId] ?? '', family: p.family, name: p.name, tiers: tierMap(pickEffectiveVersion(p.pricingVersions, now)) }));
  const productCatalogPricingVersions = productPricingVersions.map((v) => ({ id: v.id, productId: v.productId, label: v.label, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, tiers: tierMap(v) }));

  return { solarTechProducts, productCatalogProducts, productCatalogPricingVersions, installerPricingVersions: installerPricingVersionsOut };
}
