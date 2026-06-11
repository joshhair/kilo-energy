/**
 * deriveProjectCommissionView — the project-detail page's derived
 * commission view-model, moved VERBATIM from projects/[id]/page.tsx
 * (T4.1 split, 2026-06-11). Payroll-entry partitions, baseline-rate
 * resolution ladder, expected totals, projected trainer legs, and the
 * admin Total/Rep/Margin rollups.
 *
 * Pure function of its inputs — no state, no context. Computed in ONE
 * call because otherEntries excludes by array-identity .includes()
 * against closerEntries/setterEntries/trainerEntries: the partitions
 * must come from the same closure or the exclusion silently breaks.
 */

import {
  getSolarTechBaseline, getProductCatalogBaselineVersioned, getInstallerRatesForDeal,
} from '@/lib/data';
import { computeProjectedTrainerLegs } from '@/lib/trainer-projection';
import type {
  Project, PayrollEntry, TrainerAssignment, SolarTechProduct,
  ProductCatalogProduct, ProductCatalogPricingVersion, InstallerPricingVersion,
} from '@/lib/data';
import type { Role } from '@/lib/notifications/types';

export interface ProjectCommissionViewArgs {
  project: Project;
  payrollEntries: PayrollEntry[];
  effectiveRole: Role | null;
  effectiveRepId: string | null;
  trainerAssignments: TrainerAssignment[];
  solarTechProducts: SolarTechProduct[];
  productCatalogProducts: ProductCatalogProduct[];
  productCatalogPricingVersions: ProductCatalogPricingVersion[];
  installerPricingVersions: InstallerPricingVersion[];
}

export function deriveProjectCommissionView({
  project, payrollEntries, effectiveRole, effectiveRepId, trainerAssignments,
  solarTechProducts, productCatalogProducts, productCatalogPricingVersions, installerPricingVersions,
}: ProjectCommissionViewArgs) {
  // Commission entries for this project (rep view)
  const myEntries = effectiveRole === 'rep'
    ? payrollEntries.filter((e) => e.projectId === project.id && e.repId === effectiveRepId)
    : [];

  // All payroll entries for this project (admin view)
  const projectEntries = payrollEntries.filter((e) => e.projectId === project.id);
  const closerEntries = projectEntries.filter((e) => e.repId === project.repId && e.paymentStage !== 'Trainer');
  const setterEntries = project.setterId ? projectEntries.filter((e) => e.repId === project.setterId && e.paymentStage !== 'Trainer') : [];
  const coCloserIds = new Set((project.additionalClosers ?? []).map((c) => c.userId));
  const coSetterIds = new Set((project.additionalSetters ?? []).map((c) => c.userId));
  // Trainer payouts belong in their own card so the admin view shows a
  // dedicated slot matching closer/setter. Identified by paymentStage
  // (some trainers are admins/reps too, so repId alone isn't reliable).
  const trainerEntries = projectEntries.filter((e) => e.paymentStage === 'Trainer');
  const otherEntries  = projectEntries.filter((e) => !closerEntries.includes(e) && !setterEntries.includes(e) && !coCloserIds.has(e.repId) && !coSetterIds.has(e.repId) && !trainerEntries.includes(e) && !e.isChargeback);

  // Resolved baseline rates for this project
  const projectBaselines = (() => {
    if (project.baselineOverride) return project.baselineOverride;
    if (project.installer === 'SolarTech' && project.solarTechProductId) {
      try {
        return getSolarTechBaseline(project.solarTechProductId, project.kWSize, solarTechProducts);
      } catch {
        // Product deactivated — fall through to generic installer rates
      }
    }
    if (project.installerProductId) {
      return getProductCatalogBaselineVersioned(productCatalogProducts, project.installerProductId, project.kWSize, project.soldDate, productCatalogPricingVersions);
    }
    return getInstallerRatesForDeal(project.installer, project.soldDate, project.kWSize, installerPricingVersions);
  })();

  const closerExpectedM2 = project.m2Amount ?? 0;
  const setterPerW = 'setterPerW' in projectBaselines && projectBaselines.setterPerW != null
    ? projectBaselines.setterPerW
    : Math.round((projectBaselines.closerPerW + 0.10) * 100) / 100;
  const _m1Flat = project.kWSize >= 5 ? 1000 : 500;

  // Per-person total expected commission (sum of all milestones). Displayed
  // under each rep's name on the admin commission breakdown so admin can
  // eyeball each rep's full expected payout at a glance. Milestone
  // breakdown stays visible on the right.
  const closerTotalExpected =
    (project.m1Amount ?? 0) + (project.m2Amount ?? 0) + (project.m3Amount ?? 0);
  const setterTotalExpected = project.setterId
    ? (project.setterM1Amount ?? 0) + (project.setterM2Amount ?? 0) + (project.setterM3Amount ?? 0)
    : 0;
  // Compute every projected trainer leg (closer-trainer + setter-trainer
  // for every primary + co-party). Multi-party path activated when any
  // additionalClosers/Setters exist or when explicit m2 amounts are
  // passed — see lib/trainer-projection.ts. For Bryce/Patrick/Tyson:
  // Hunter (via Patrick, share 0.5) + Paul (via Tyson, share 0.5) both
  // surface as separate legs.
  const projectedTrainerLegs = computeProjectedTrainerLegs(
    {
      id: project.id,
      trainerId: project.trainerId ?? null,
      trainerRate: project.trainerRate ?? null,
      repId: project.repId,
      setterId: project.setterId ?? null,
      kWSize: project.kWSize ?? 0,
      m2Amount: project.m2Amount,
      setterM2Amount: project.setterM2Amount,
      additionalClosers: (project.additionalClosers ?? []).map((c) => ({
        userId: c.userId,
        userName: c.userName ?? '',
        m2Amount: c.m2Amount ?? 0,
      })),
      additionalSetters: (project.additionalSetters ?? []).map((s) => ({
        userId: s.userId,
        userName: s.userName ?? '',
        m2Amount: s.m2Amount ?? 0,
      })),
    },
    trainerAssignments,
    payrollEntries,
  );
  const primaryTrainerLeg = projectedTrainerLegs[0] ?? null;
  const effectiveTrainerRate = primaryTrainerLeg?.rate ?? 0;
  const effTrainerId = primaryTrainerLeg?.trainerId ?? null;
  const trainerTotalExpected = projectedTrainerLegs.reduce((s, l) => s + l.amount, 0);
  const isMultiTrainer = projectedTrainerLegs.length > 1;

  const coCloserTotal = (project.additionalClosers ?? []).reduce(
    (s, c) => s + (c.m1Amount ?? 0) + (c.m2Amount ?? 0) + (c.m3Amount ?? 0), 0,
  );
  const coSetterTotal = (project.additionalSetters ?? []).reduce(
    (s, c) => s + (c.m1Amount ?? 0) + (c.m2Amount ?? 0) + (c.m3Amount ?? 0), 0,
  );
  // Three admin-only rollups related by: Rep Commission + Kilo Margin =
  // Total Commission. Total = the gross pool Kilo receives from the installer
  // ((sold − Kilo cost) × W); Rep = everything paid out to reps (closer +
  // setter + co-parties + trainers); Margin = what Kilo keeps. Margin is
  // derived by subtraction so the three always reconcile to the cent.
  const repCommissionTotal = Math.round((closerTotalExpected + setterTotalExpected + coCloserTotal + coSetterTotal + trainerTotalExpected) * 100) / 100;
  const totalCommissionGross = Math.round((project.netPPW - projectBaselines.kiloPerW) * project.kWSize * 1000 * 100) / 100;
  const kiloMarginAmount = Math.round((totalCommissionGross - repCommissionTotal) * 100) / 100;

  return {
    myEntries, projectEntries, closerEntries, setterEntries, coCloserIds, coSetterIds,
    trainerEntries, otherEntries, projectBaselines, closerExpectedM2, setterPerW, _m1Flat,
    closerTotalExpected, setterTotalExpected, projectedTrainerLegs, primaryTrainerLeg,
    effectiveTrainerRate, effTrainerId, trainerTotalExpected, isMultiTrainer,
    coCloserTotal, coSetterTotal, repCommissionTotal, totalCommissionGross, kiloMarginAmount,
  };
}

export type ProjectCommissionView = ReturnType<typeof deriveProjectCommissionView>;
