/**
 * types.ts — public type surface for the Kilo domain.
 *
 * A single stable import site (`@/lib/types`) for every interface and
 * type the app uses. Source of truth currently lives in `lib/data.ts`
 * alongside the pricing/commission logic; this file re-exports them so
 * callers that only need types don't drag in the whole data.ts module
 * graph at type-level.
 *
 * Import policy for new code:
 *   - Types        → `import type { Project } from '@/lib/types'`
 *   - Values / fns → still from `@/lib/data` until follow-up Phase 7
 *     work splits out pricing.ts, commission.ts, seed/*.ts.
 *
 * Why not move the definitions here? lib/data.ts has 1600+ lines of
 * seed data and pricing functions that still reference these types
 * directly. A big-bang move is high-risk with little payoff today;
 * a re-export keeps the type-only import path without a churn-heavy
 * refactor.
 */

export type {
  Phase,
  InstallerPayConfig,
  Rep,
  SubDealer,
  TrainerOverrideTier,
  TrainerAssignment,
  Project,
  PayrollEntry,
  Reimbursement,
  BaselineRate,
  SolarTechTier,
  SolarTechProduct,
  InstallerBaseline,
  InstallerFlatRate,
  InstallerTieredKWBand,
  InstallerTieredRate,
  InstallerRates,
  InstallerPricingVersion,
  ProductCatalogTier,
  ProductCatalogProduct,
  ProductCatalogInstallerConfig,
  ProductCatalogPricingVersion,
  CommissionSplit,
  IncentiveMetric,
  IncentivePeriod,
  IncentiveType,
  IncentiveMilestone,
  Incentive,
} from './data';
