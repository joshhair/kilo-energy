/**
 * commission-deps.ts — loads + shapes everything computeProjectCommission needs
 * from Prisma, so POST and PATCH /api/projects build IDENTICAL deps (the point
 * of making POST authoritative: a created deal computes the same way an edited
 * one does). Extracted verbatim from the PATCH recompute path — behavior-
 * preserving, proven by the commission-server reconciliation tests + the audit.
 *
 * Pricing is resolved by SOLD DATE (the version effective when the deal sold),
 * NOT current pricing — historical accuracy for the commission math (this is why
 * it can't reuse buildKiloPricingArrays, which resolves at `now`). Includes the
 * projectParties map (projectId → closer/setter) that scopes a trainee's
 * trainer-tier count to their own deals (the multi-trainee under-pay fix).
 */
import { prisma } from './db';
import type { CommissionDeps } from './commission-server';

type InstallerRow = { id: string; name: string; installPayPct: number; usesProductCatalog: boolean };

export interface LoadedCommissionDeps extends Omit<CommissionDeps, 'currentProjectId'> {
  /** Raw installer rows — callers resolve installerName from the deal's installerId. */
  installers: InstallerRow[];
}

/** Load + shape the commission deps for a deal sold at `soldDate`. */
export async function loadCommissionDeps(soldDate: string): Promise<LoadedCommissionDeps> {
  const [
    installerPricingVersionsRaw,
    productCatalogProductsRaw,
    productCatalogPricingVersionsRaw,
    trainerAssignmentsRaw,
    payrollEntriesRaw,
    installers,
    allProjectPartiesRaw,
  ] = await Promise.all([
    prisma.installerPricingVersion.findMany({ include: { tiers: true } }),
    prisma.product.findMany({ where: { active: true }, include: { pricingVersions: { include: { tiers: true } } } }),
    prisma.productPricingVersion.findMany({ include: { tiers: true } }),
    prisma.trainerAssignment.findMany({ include: { tiers: { orderBy: { sortOrder: 'asc' } } } }),
    prisma.payrollEntry.findMany({ where: { paymentStage: 'Trainer' } }),
    prisma.installer.findMany({ select: { id: true, name: true, installPayPct: true, usesProductCatalog: true } }),
    prisma.project.findMany({ select: { id: true, closerId: true, setterId: true } }),
  ]);
  const projectParties = new Map(allProjectPartiesRaw.map((p) => [p.id, { closerId: p.closerId, setterId: p.setterId }]));

  const installerPricingVersions = installerPricingVersionsRaw.map((v) => ({
    id: v.id,
    installer: installers.find((i) => i.id === v.installerId)?.name ?? '',
    label: v.label ?? '',
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    rates: v.rateType === 'tiered'
      ? { type: 'tiered' as const, bands: v.tiers.map((t) => ({ minKW: t.minKW, maxKW: t.maxKW, closerPerW: t.closerPerW, kiloPerW: t.kiloPerW, setterPerW: t.setterPerW ?? undefined, subDealerPerW: t.subDealerPerW ?? undefined })) }
      : { type: 'flat' as const, closerPerW: v.tiers[0]?.closerPerW ?? 0, kiloPerW: v.tiers[0]?.kiloPerW ?? 0, setterPerW: v.tiers[0]?.setterPerW ?? undefined, subDealerPerW: v.tiers[0]?.subDealerPerW ?? undefined },
  }));

  const solarTechInstaller = installers.find((i) => i.name === 'SolarTech');
  const effectiveSoldDate = new Date(soldDate);
  const solarTechProducts = productCatalogProductsRaw
    .filter((p) => p.installerId === solarTechInstaller?.id)
    .map((p) => {
      const versionCandidates = p.pricingVersions.filter((v) =>
        new Date(v.effectiveFrom) <= effectiveSoldDate &&
        (v.effectiveTo === null || new Date(v.effectiveTo) >= effectiveSoldDate)
      );
      const activeVersion = versionCandidates.length > 0
        ? versionCandidates.reduce((a, b) => (a.effectiveFrom >= b.effectiveFrom ? a : b))
        : p.pricingVersions[0];
      const familyFinancerMap: Record<string, string> = {
        'Goodleap': 'Goodleap',
        'Enfin': 'Enfin',
        'Lightreach': 'LightReach',
        'Cash/HDM/PE': 'Cash',
      };
      return {
        id: p.id,
        family: p.family,
        financer: familyFinancerMap[p.family] ?? p.family,
        name: p.name,
        tiers: (activeVersion?.tiers ?? []).map((t) => ({
          minKW: t.minKW,
          maxKW: t.maxKW ?? null,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW,
          kiloPerW: t.kiloPerW,
          subDealerPerW: t.subDealerPerW ?? undefined,
        })),
      };
    });

  const productCatalogProducts = productCatalogProductsRaw
    .filter((p) => p.installerId !== solarTechInstaller?.id)
    .map((p) => ({
      id: p.id,
      installer: installers.find((i) => i.id === p.installerId)?.name ?? '',
      family: p.family,
      name: p.name,
      tiers: (p.pricingVersions.find((pv) => pv.effectiveTo === null)?.tiers ?? []).map((t) => ({
        minKW: t.minKW,
        maxKW: t.maxKW,
        closerPerW: t.closerPerW,
        setterPerW: t.setterPerW,
        kiloPerW: t.kiloPerW,
        subDealerPerW: t.subDealerPerW ?? undefined,
      })),
    }));

  const productCatalogPricingVersions = productCatalogPricingVersionsRaw.map((v) => ({
    id: v.id,
    productId: v.productId,
    label: v.label,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    tiers: v.tiers.map((t) => ({
      minKW: t.minKW,
      maxKW: t.maxKW,
      closerPerW: t.closerPerW,
      setterPerW: t.setterPerW,
      kiloPerW: t.kiloPerW,
      subDealerPerW: t.subDealerPerW ?? undefined,
    })),
  }));

  const trainerAssignments = trainerAssignmentsRaw.map((a) => ({
    id: a.id,
    trainerId: a.trainerId,
    traineeId: a.traineeId,
    isActiveTraining: a.isActiveTraining,
    tiers: a.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
  }));

  const payrollEntries = payrollEntriesRaw.map((e) => ({
    repId: e.repId,
    projectId: e.projectId,
    paymentStage: e.paymentStage,
    amount: e.amountCents / 100,
    status: e.status,
  }));

  const installerPayConfigs: Record<string, { installPayPct: number; usesProductCatalog: boolean }> = {};
  for (const i of installers) installerPayConfigs[i.name] = { installPayPct: i.installPayPct, usesProductCatalog: i.usesProductCatalog };

  return {
    installerPricingVersions,
    solarTechProducts,
    productCatalogProducts,
    productCatalogPricingVersions,
    trainerAssignments,
    payrollEntries,
    installerPayConfigs,
    projectParties,
    installers,
  } as LoadedCommissionDeps;
}
