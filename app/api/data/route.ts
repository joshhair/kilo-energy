import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../lib/db';

// GET /api/data — Returns all data needed to hydrate the app context.
// This replaces the hardcoded constants from lib/data.ts.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [
    users,
    installers,
    financers,
    projects,
    payrollEntries,
    reimbursements,
    trainerAssignments,
    incentives,
    installerPricingVersions,
    products,
    productPricingVersions,
    productCatalogConfigs,
    prepaidOptions,
  ] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { lastName: 'asc' } }),
    prisma.installer.findMany({ orderBy: { name: 'asc' } }),
    prisma.financer.findMany({ orderBy: { name: 'asc' } }),
    prisma.project.findMany({
      include: {
        closer: true,
        setter: true,
        subDealer: true,
        installer: true,
        financer: true,
      },
      orderBy: { soldDate: 'desc' },
    }),
    prisma.payrollEntry.findMany({
      include: { rep: true, project: true },
      orderBy: { date: 'desc' },
    }),
    prisma.reimbursement.findMany({
      include: { rep: true },
      orderBy: { date: 'desc' },
    }),
    prisma.trainerAssignment.findMany({
      include: {
        trainer: true,
        trainee: true,
        tiers: { orderBy: { sortOrder: 'asc' } },
      },
    }),
    prisma.incentive.findMany({
      include: { milestones: true, targetRep: true },
      orderBy: { startDate: 'desc' },
    }),
    prisma.installerPricingVersion.findMany({
      include: { tiers: true },
      orderBy: { effectiveFrom: 'desc' },
    }),
    prisma.product.findMany({
      include: {
        pricingVersions: {
          include: { tiers: true },
          orderBy: { effectiveFrom: 'desc' },
        },
      },
      orderBy: [{ family: 'asc' }, { name: 'asc' }],
    }),
    prisma.productPricingVersion.findMany({
      include: { tiers: true },
      orderBy: { effectiveFrom: 'desc' },
    }),
    prisma.productCatalogConfig.findMany(),
    prisma.installerPrepaidOption.findMany(),
  ]);

  // Transform to match the shapes the existing context expects

  // Reps: filter to role='rep' and add computed `name` field
  const reps = users
    .filter((u) => u.role === 'rep')
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      phone: u.phone,
      role: 'rep' as const,
      repType: u.repType as 'closer' | 'setter' | 'both',
      canRequestBlitz: u.canRequestBlitz ?? false,
      canCreateBlitz: u.canCreateBlitz ?? false,
    }));

  // Sub-dealers: filter to role='sub-dealer'
  const subDealers = users
    .filter((u) => u.role === 'sub-dealer')
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      phone: u.phone,
      role: 'sub-dealer' as const,
    }));

  // Installers: just the name list (for backward compat)
  const installerNames = installers.map((i) => ({ name: i.name, active: i.active }));
  const financerNames = financers.map((f) => ({ name: f.name, active: f.active }));

  // Installer pay configs
  const installerPayConfigs: Record<string, { installPayPct: number }> = {};
  for (const inst of installers) {
    installerPayConfigs[inst.name] = { installPayPct: inst.installPayPct };
  }

  // Map installer IDs to names for FK resolution
  const instIdToName: Record<string, string> = {};
  for (const inst of installers) instIdToName[inst.id] = inst.name;
  const finIdToName: Record<string, string> = {};
  for (const fin of financers) finIdToName[fin.id] = fin.name;

  // Projects: transform FKs back to name strings for backward compat
  const transformedProjects = projects.map((p) => ({
    id: p.id,
    customerId: p.id, // no separate customer entity yet
    customerName: p.customerName,
    repId: p.closerId,
    repName: `${p.closer.firstName} ${p.closer.lastName}`,
    setterId: p.setterId ?? undefined,
    setterName: p.setter ? `${p.setter.firstName} ${p.setter.lastName}` : undefined,
    soldDate: p.soldDate,
    installer: p.installer.name,
    financer: p.financer.name,
    productType: p.productType,
    kWSize: p.kWSize,
    netPPW: p.netPPW,
    phase: p.phase,
    m1Paid: p.m1Paid,
    m1Amount: p.m1Amount,
    m2Paid: p.m2Paid,
    m2Amount: p.m2Amount,
    m3Paid: p.m3Paid ?? false,
    m3Amount: p.m3Amount ?? undefined,
    notes: p.notes,
    flagged: p.flagged,
    solarTechProductId: p.productId ?? undefined,
    installerProductId: p.productId ?? undefined,
    pricingVersionId: p.installerPricingVersionId ?? undefined,
    pcPricingVersionId: p.productPricingVersionId ?? undefined,
    baselineOverride: p.baselineOverrideJson ? JSON.parse(p.baselineOverrideJson) : undefined,
    prepaidSubType: p.prepaidSubType ?? undefined,
    leadSource: p.leadSource ?? undefined,
    blitzId: p.blitzId ?? undefined,
    subDealerId: p.subDealerId ?? undefined,
    subDealerName: p.subDealer ? `${p.subDealer.firstName} ${p.subDealer.lastName}` : undefined,
  }));

  // Payroll entries: transform FKs to name strings
  const transformedPayroll = payrollEntries.map((pe) => ({
    id: pe.id,
    repId: pe.repId,
    repName: `${pe.rep.firstName} ${pe.rep.lastName}`,
    projectId: pe.projectId,
    customerName: pe.project?.customerName ?? '',
    amount: pe.amount,
    type: pe.type,
    paymentStage: pe.paymentStage,
    status: pe.status,
    date: pe.date,
    notes: pe.notes,
  }));

  // Reimbursements
  const transformedReimbursements = reimbursements.map((r) => ({
    id: r.id,
    repId: r.repId,
    repName: `${r.rep.firstName} ${r.rep.lastName}`,
    amount: r.amount,
    description: r.description,
    date: r.date,
    status: r.status,
    receiptName: r.receiptName ?? undefined,
  }));

  // Trainer assignments
  const transformedTrainers = trainerAssignments.map((ta) => ({
    id: ta.id,
    trainerId: ta.trainerId,
    traineeId: ta.traineeId,
    tiers: ta.tiers.map((t) => ({
      upToDeal: t.upToDeal,
      ratePerW: t.ratePerW,
    })),
  }));

  // Incentives
  const transformedIncentives = incentives.map((inc) => ({
    id: inc.id,
    title: inc.title,
    description: inc.description,
    type: inc.type,
    metric: inc.metric,
    period: inc.period,
    startDate: inc.startDate,
    endDate: inc.endDate ?? null,
    targetRepId: inc.targetRepId ?? null,
    milestones: inc.milestones.map((m) => ({
      id: m.id,
      threshold: m.threshold,
      reward: m.reward,
      achieved: m.achieved,
    })),
    active: inc.active,
    blitzId: inc.blitzId ?? null,
  }));

  // Installer pricing versions: transform to match existing InstallerPricingVersion type
  const transformedIPV = installerPricingVersions.map((v) => {
    const installerName = instIdToName[v.installerId] ?? v.installerId;
    const isTiered = v.rateType === 'tiered' || v.tiers.length > 1;
    return {
      id: v.id,
      installer: installerName,
      label: v.label,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo ?? null,
      rates: isTiered
        ? {
            type: 'tiered' as const,
            bands: v.tiers.map((t) => ({
              minKW: t.minKW,
              maxKW: t.maxKW ?? undefined,
              closerPerW: t.closerPerW,
              setterPerW: t.setterPerW ?? undefined,
              kiloPerW: t.kiloPerW,
              subDealerPerW: t.subDealerPerW ?? undefined,
            })),
          }
        : {
            type: 'flat' as const,
            closerPerW: v.tiers[0]?.closerPerW ?? 2.90,
            setterPerW: v.tiers[0]?.setterPerW ?? undefined,
            kiloPerW: v.tiers[0]?.kiloPerW ?? 2.35,
            subDealerPerW: v.tiers[0]?.subDealerPerW ?? undefined,
          },
    };
  });

  // SolarTech products: transform to match SolarTechProduct type
  const solarTechInstaller = installers.find((i) => i.name === 'SolarTech');
  const solarTechProducts = products
    .filter((p) => p.installerId === solarTechInstaller?.id)
    .map((p) => {
      // Use the active pricing version tiers, or fall back to first version
      const activeVersion = p.pricingVersions.find((v) => v.effectiveTo === null)
        ?? p.pricingVersions[0];
      return {
        id: p.id,
        family: p.family,
        financer: (() => {
          const familyFinancerMap: Record<string, string> = {
            'Goodleap': 'Goodleap',
            'Enfin': 'Enfin',
            'Lightreach': 'LightReach',
            'Cash/HDM/PE': 'Cash',
          };
          return familyFinancerMap[p.family] ?? p.family;
        })(),
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

  // Product catalog products (non-SolarTech products)
  const productCatalogProducts = products
    .filter((p) => p.installerId !== solarTechInstaller?.id)
    .map((p) => {
      const activeVersion = p.pricingVersions.find((v) => v.effectiveTo === null)
        ?? p.pricingVersions[0];
      return {
        id: p.id,
        installer: instIdToName[p.installerId] ?? '',
        family: p.family,
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

  // Product catalog installer configs
  const pcInstallerConfigs: Record<string, {
    families: string[];
    familyFinancerMap?: Record<string, string>;
    prepaidFamily?: string;
  }> = {};
  for (const cfg of productCatalogConfigs) {
    const installerName = instIdToName[cfg.installerId] ?? cfg.installerId;
    pcInstallerConfigs[installerName] = {
      families: cfg.families ? cfg.families.split(',') : [],
      familyFinancerMap: cfg.familyFinancerMap ? JSON.parse(cfg.familyFinancerMap) : undefined,
      prepaidFamily: cfg.prepaidFamily ?? undefined,
    };
  }

  // Product catalog pricing versions
  const transformedPCPV = productPricingVersions.map((v) => ({
    id: v.id,
    productId: v.productId,
    label: v.label,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo ?? null,
    tiers: v.tiers.map((t) => ({
      minKW: t.minKW,
      maxKW: t.maxKW ?? null,
      closerPerW: t.closerPerW,
      setterPerW: t.setterPerW,
      kiloPerW: t.kiloPerW,
      subDealerPerW: t.subDealerPerW ?? undefined,
    })),
  }));

  // Prepaid options grouped by installer
  const installerPrepaidOptions: Record<string, string[]> = {};
  for (const opt of prepaidOptions) {
    const installerName = instIdToName[opt.installerId] ?? opt.installerId;
    if (!installerPrepaidOptions[installerName]) {
      installerPrepaidOptions[installerName] = [];
    }
    installerPrepaidOptions[installerName].push(opt.name);
  }

  return NextResponse.json({
    reps,
    subDealers,
    installers: installerNames,
    financers: financerNames,
    installerPayConfigs,
    projects: transformedProjects,
    payrollEntries: transformedPayroll,
    reimbursements: transformedReimbursements,
    trainerAssignments: transformedTrainers,
    incentives: transformedIncentives,
    installerPricingVersions: transformedIPV,
    solarTechProducts,
    productCatalogProducts,
    productCatalogInstallerConfigs: pcInstallerConfigs,
    productCatalogPricingVersions: transformedPCPV,
    installerPrepaidOptions,
    // Also return ID maps so the client can resolve FKs for mutations
    _idMaps: {
      installerNameToId: Object.fromEntries(installers.map((i) => [i.name, i.id])),
      financerNameToId: Object.fromEntries(financers.map((f) => [f.name, f.id])),
      repIdMap: Object.fromEntries(users.filter((u) => u.role === 'rep').map((u) => [u.id, { name: `${u.firstName} ${u.lastName}` }])),
    },
  });
}
