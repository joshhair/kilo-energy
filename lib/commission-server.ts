/**
 * commission-server.ts — server-side commission recompute.
 *
 * Mirrors the compute flow in app/dashboard/new-deal/page.tsx but runs on
 * the server so mutations via PATCH /api/projects/[id] can recompute
 * deterministically when math-inputs change.
 *
 * The client still computes commission at deal submission time (for the
 * live preview as the user types), but the server is now authoritative
 * at save-and-edit time: if any math-input changed on PATCH, the server
 * re-runs this function and writes the result, overriding whatever the
 * client sent.
 *
 * Scope (Batch 2b minimum): prevent the Timothy-class bug where editing
 * netPPW / kWSize / installer after submission left stale amounts on
 * the row. Does NOT touch the POST path (creation still trusts the
 * client's fresh compute).
 *
 * All pricing resolvers it calls (getInstallerRatesForDeal,
 * getProductCatalogBaselineVersioned, getSolarTechBaseline) are pure
 * — they just operate on arrays already loaded by the caller.
 */

import {
  splitCloserSetterPay,
  resolveTrainerRate,
  type TrainerResolverPayrollEntry,
} from './commission';
import {
  getInstallerRatesForDeal,
  getProductCatalogBaselineVersioned,
  getSolarTechBaseline,
  DEFAULT_INSTALL_PAY_PCT,
  INSTALLER_PAY_CONFIGS,
  type InstallerPricingVersion,
  type InstallerBaseline,
  type ProductCatalogProduct,
  type ProductCatalogPricingVersion,
  type SolarTechProduct,
  type InstallerPayConfig,
  type TrainerAssignment,
} from './data';

// Re-export the narrow payroll shape so callers don't need a second import.
export type { TrainerResolverPayrollEntry } from './commission';

/** Inputs the server has (after loading the Prisma row). All fields that
 *  affect commission are here; anything else (customerName, notes, etc.)
 *  is irrelevant to this compute. */
export interface CommissionInputs {
  soldDate: string;
  netPPW: number;
  kWSize: number;
  installer: string;          // installer NAME (matches how client resolves)
  productType: string;
  closerId: string | null;
  setterId: string | null;
  subDealerId?: string | null;
  solarTechProductId?: string | null;
  installerProductId?: string | null;       // Product-Catalog installers
  baselineOverride?: InstallerBaseline | null; // per-project admin override
  trainerId?: string | null;                // per-project trainer override
  trainerRate?: number | null;              // per-project rate override
  noChainTrainer?: boolean;                 // admin's "remove all trainers" flag — suppresses chain trainer commission
  /** Admin-entered co-party splits. Server treats these as given inputs
   *  and subtracts their sums from the primary's M1/M2/M3 so totals
   *  balance. */
  additionalClosers: ReadonlyArray<{ m1Amount: number; m2Amount: number; m3Amount: number | null }>;
  additionalSetters: ReadonlyArray<{ m1Amount: number; m2Amount: number; m3Amount: number | null }>;
}

/** Data arrays the caller must have already loaded from Prisma. */
export interface CommissionDeps {
  installerPricingVersions: InstallerPricingVersion[];
  solarTechProducts: SolarTechProduct[];
  productCatalogProducts: ProductCatalogProduct[];
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  trainerAssignments: TrainerAssignment[];
  payrollEntries: TrainerResolverPayrollEntry[];
  installerPayConfigs: Record<string, InstallerPayConfig>;
  /** The id of the project being recomputed, so resolveTrainerRate
   *  excludes it from its own "completed deals" count (otherwise a
   *  trainer's deal-count bumps mid-compute and rates shift). */
  currentProjectId?: string;
}

export interface CommissionOutputs {
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
  setterM1Amount: number;
  setterM2Amount: number;
  setterM3Amount: number | null;
  /** Resolved baselines + trainer rate used by the compute — exposed for
   *  diagnostic logging and the reconcile-drift script. */
  diagnostics: {
    closerPerW: number;
    setterBaselinePerW: number;
    kiloPerW: number;
    trainerRate: number;
    installPayPct: number;
    pricingSource: 'override' | 'solartech' | 'product-catalog' | 'installer-version' | 'fallback';
  };
}

/** Resolve the baseline trio (closerPerW, setterPerW, kiloPerW) via the
 *  correct code path for this installer. Mirrors the IIFE in
 *  new-deal/page.tsx:338-360 so client + server agree. */
function resolveBaselines(
  inputs: CommissionInputs,
  deps: CommissionDeps,
): { closerPerW: number; setterPerW: number; kiloPerW: number; source: CommissionOutputs['diagnostics']['pricingSource'] } {
  // 1. Per-project admin override wins if set.
  if (inputs.baselineOverride) {
    const o = inputs.baselineOverride;
    return {
      closerPerW: o.closerPerW,
      setterPerW: o.setterPerW ?? Math.round((o.closerPerW + 0.10) * 100) / 100,
      kiloPerW: o.kiloPerW,
      source: 'override',
    };
  }

  // 2. SolarTech uses an archived product-per-deal model.
  if (inputs.installer === 'SolarTech' && inputs.solarTechProductId && inputs.kWSize > 0) {
    try {
      const b = getSolarTechBaseline(inputs.solarTechProductId, inputs.kWSize, deps.solarTechProducts);
      return { ...b, source: 'solartech' };
    } catch (err) {
      console.warn(`[commission] SolarTech product lookup failed for productId=${inputs.solarTechProductId}: ${err instanceof Error ? err.message : String(err)}. Commission will be $0.`);
      return { closerPerW: 0, setterPerW: 0, kiloPerW: 0, source: 'fallback' };
    }
  }

  // 3. Product Catalog installers (BVI, etc.) — uses versioned pricing.
  if (inputs.installerProductId && inputs.kWSize > 0) {
    try {
      const b = getProductCatalogBaselineVersioned(
        deps.productCatalogProducts,
        inputs.installerProductId,
        inputs.kWSize,
        inputs.soldDate,
        deps.productCatalogPricingVersions,
      );
      return { closerPerW: b.closerPerW, setterPerW: b.setterPerW, kiloPerW: b.kiloPerW, source: 'product-catalog' };
    } catch {
      // Fall through.
    }
  }

  // 4. Standard non-SolarTech installer: versioned by sold date.
  if (inputs.installer && inputs.installer !== 'SolarTech' && inputs.kWSize > 0) {
    const r = getInstallerRatesForDeal(
      inputs.installer,
      inputs.soldDate,
      inputs.kWSize,
      deps.installerPricingVersions,
    );
    return { closerPerW: r.closerPerW, setterPerW: r.setterPerW, kiloPerW: r.kiloPerW, source: 'installer-version' };
  }

  // 5. Fallback: zeros. Caller's data is incomplete; commission will be 0.
  return { closerPerW: 0, setterPerW: 0, kiloPerW: 0, source: 'fallback' };
}

/** Resolve the trainer rate for this deal — per-project override wins,
 *  else consult the setter's trainer-assignment chain.
 *
 *  Note: `splitCloserSetterPay`'s `trainerRate` parameter represents
 *  the SETTER's trainer override (it shifts the setter's commission
 *  split point). Closer-side trainer payouts are handled separately
 *  and don't affect splitCloserSetterPay's inputs. So we pass the
 *  setter's id into `resolveTrainerRate` as the trainee lookup key. */
function resolveTrainerRateForDeal(
  inputs: CommissionInputs,
  deps: CommissionDeps,
): { rate: number } {
  // Per-project override wins when both trainerId + trainerRate are set.
  if (inputs.trainerId && inputs.trainerRate != null && inputs.trainerRate > 0) {
    return { rate: inputs.trainerRate };
  }

  // Admin explicitly removed all trainers from this deal — no chain commission.
  if (inputs.noChainTrainer) return { rate: 0 };

  if (!inputs.setterId) return { rate: 0 };

  const resolution = resolveTrainerRate(
    {
      id: deps.currentProjectId ?? '',
      trainerId: inputs.trainerId ?? null,
      trainerRate: inputs.trainerRate ?? null,
    },
    inputs.setterId,
    deps.trainerAssignments,
    deps.payrollEntries,
  );
  return { rate: resolution.rate };
}

/** The main entry point. Given inputs + loaded data, compute the
 *  authoritative commission amounts. Pure function; no side effects. */
export function computeProjectCommission(
  inputs: CommissionInputs,
  deps: CommissionDeps,
): CommissionOutputs {
  // Sub-dealer deals have their own commission formula handled elsewhere
  // (not currently server-recomputed). For safety, return zeros so we
  // don't mis-apply the regular rep formula.
  if (inputs.subDealerId) {
    return {
      m1Amount: 0,
      m2Amount: 0,
      m3Amount: 0,
      setterM1Amount: 0,
      setterM2Amount: 0,
      setterM3Amount: 0,
      diagnostics: {
        closerPerW: 0,
        setterBaselinePerW: 0,
        kiloPerW: 0,
        trainerRate: 0,
        installPayPct: 100,
        pricingSource: 'fallback',
      },
    };
  }

  const { closerPerW, setterPerW, kiloPerW, source } = resolveBaselines(inputs, deps);
  const trainerInfo = resolveTrainerRateForDeal(inputs, deps);
  const installPayPct =
    deps.installerPayConfigs[inputs.installer]?.installPayPct
    ?? INSTALLER_PAY_CONFIGS[inputs.installer]?.installPayPct
    ?? DEFAULT_INSTALL_PAY_PCT;

  const split = splitCloserSetterPay(
    inputs.netPPW,
    closerPerW,
    inputs.setterId ? setterPerW : 0, // self-gen → no setter baseline
    trainerInfo.rate,
    inputs.kWSize,
    installPayPct,
  );

  // Co-party amounts come in as inputs; primary = split − sum(co-parties).
  const coCloserM1Sum = inputs.additionalClosers.reduce((a, b) => a + b.m1Amount, 0);
  const coCloserM2Sum = inputs.additionalClosers.reduce((a, b) => a + b.m2Amount, 0);
  const coCloserM3Sum = inputs.additionalClosers.reduce((a, b) => a + (b.m3Amount ?? 0), 0);
  const coSetterM1Sum = inputs.additionalSetters.reduce((a, b) => a + b.m1Amount, 0);
  const coSetterM2Sum = inputs.additionalSetters.reduce((a, b) => a + b.m2Amount, 0);
  const coSetterM3Sum = inputs.additionalSetters.reduce((a, b) => a + (b.m3Amount ?? 0), 0);

  const hasM3 = installPayPct < 100;

  return {
    m1Amount: Math.max(0, split.closerM1 - coCloserM1Sum),
    m2Amount: Math.max(0, split.closerM2 - coCloserM2Sum),
    m3Amount: hasM3 ? Math.max(0, split.closerM3 - coCloserM3Sum) : null,
    setterM1Amount: Math.max(0, split.setterM1 - coSetterM1Sum),
    setterM2Amount: Math.max(0, split.setterM2 - coSetterM2Sum),
    setterM3Amount: hasM3 ? Math.max(0, split.setterM3 - coSetterM3Sum) : null,
    diagnostics: {
      closerPerW,
      setterBaselinePerW: setterPerW,
      kiloPerW,
      trainerRate: trainerInfo.rate,
      installPayPct,
      pricingSource: source,
    },
  };
}

/** Keys whose change on PATCH necessitates a recompute. If ONLY notes
 *  or flagged changed, skip the compute. */
export const COMMISSION_INPUT_KEYS = [
  'netPPW',
  'kWSize',
  'installer',
  'productType',
  'closerId',
  'setterId',
  'soldDate',
  'solarTechProductId',
  'installerProductId',
  'trainerId',
  'trainerRate',
  'noChainTrainer',
  'baselineOverrideJson',
  'additionalClosers',
  'additionalSetters',
] as const;
