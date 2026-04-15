import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { getInternalUser } from '../../../lib/api-auth';
import { logger } from '../../../lib/logger';

// GET /api/data — Returns the data needed to hydrate the app context,
// SCOPED TO THE CURRENT USER'S ROLE. Non-admins only ever see their own
// projects, payroll, reimbursements, etc. This is the critical server-side
// authorization layer — client-side filters were previously cosmetic.
export async function GET() {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isAdmin = user.role === 'admin';
  const isPM = user.role === 'project_manager';
  const isRep = user.role === 'rep';
  const isSubDealer = user.role === 'sub-dealer';

  // ─── Project filter: who sees which projects? ───
  // Admin: all. PM: all. Rep: closer or setter. Sub-dealer: subDealerId match.
  const projectWhere: Record<string, unknown> = {};
  if (isRep) {
    projectWhere.OR = [{ closerId: user.id }, { setterId: user.id }];
  } else if (isSubDealer) {
    projectWhere.OR = [{ subDealerId: user.id }, { closerId: user.id }];
  }
  // Admin + PM: no filter (empty where)

  // ─── Payroll filter: rep/sub-dealer only see own. PM sees own (if any). ───
  const payrollWhere: Record<string, unknown> = {};
  if (!isAdmin) {
    payrollWhere.repId = user.id;
  }

  // ─── Reimbursements: rep/sub-dealer/PM only see own ───
  const reimbWhere: Record<string, unknown> = {};
  if (!isAdmin) {
    reimbWhere.repId = user.id;
  }

  // ─── Trainer assignments: rep sees where they're trainer or trainee. Admin sees all. ───
  const trainerWhere: Record<string, unknown> = {};
  if (!isAdmin) {
    trainerWhere.OR = [{ trainerId: user.id }, { traineeId: user.id }];
  }

  // ─── Incentives: rep/sub-dealer see incentives targeting them or company-wide ───
  const incentiveWhere: Record<string, unknown> = {};
  if (!isAdmin) {
    incentiveWhere.OR = [{ targetRepId: user.id }, { targetRepId: null }];
  }

  // Ensure the Cash financer always exists so reps can submit Cash deals on
  // fresh instances without hitting the admin-only POST /api/financers endpoint.
  await prisma.financer.upsert({
    where: { name: 'Cash' },
    update: {},
    create: { name: 'Cash' },
  });

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
    // Admins see all users (including deactivated) so historical contexts
    // can render greyed-out names. Non-admins only see active users.
    prisma.user.findMany({
      where: isAdmin ? {} : { active: true },
      orderBy: { lastName: 'asc' },
    }),
    prisma.installer.findMany({ orderBy: { name: 'asc' } }),
    prisma.financer.findMany({ orderBy: { name: 'asc' } }),
    prisma.project.findMany({
      where: projectWhere,
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
      where: payrollWhere,
      include: { rep: true, project: true },
      orderBy: { date: 'desc' },
    }),
    prisma.reimbursement.findMany({
      where: reimbWhere,
      include: { rep: true },
      orderBy: { date: 'desc' },
    }),
    prisma.trainerAssignment.findMany({
      where: trainerWhere,
      include: {
        trainer: true,
        trainee: true,
        tiers: { orderBy: { sortOrder: 'asc' } },
      },
    }),
    prisma.incentive.findMany({
      where: incentiveWhere,
      include: { milestones: true, targetRep: true },
      orderBy: { startDate: 'desc' },
    }),
    prisma.installerPricingVersion.findMany({
      include: { tiers: true },
      orderBy: { effectiveFrom: 'desc' },
    }),
    prisma.product.findMany({
      where: { active: true },
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

  // ─── Reps: strip PII (email, phone) for non-admin viewers ───
  // Reps still need the list (to pick a setter in new-deal form, to display
  // names on shared deals), but not contact info.
  const reps = users
    .filter((u) => u.role === 'rep')
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      email: isAdmin ? u.email : '',
      phone: isAdmin ? u.phone : '',
      role: 'rep' as const,
      repType: u.repType as 'closer' | 'setter' | 'both',
      active: u.active,
      ...(isAdmin ? { hasClerkAccount: !!u.clerkUserId } : {}),
      canRequestBlitz: u.canRequestBlitz ?? false,
      canCreateBlitz: u.canCreateBlitz ?? false,
    }));

  const subDealers = users
    .filter((u) => u.role === 'sub-dealer')
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      email: isAdmin ? u.email : '',
      phone: isAdmin ? u.phone : '',
      role: 'sub-dealer' as const,
      active: u.active,
      ...(isAdmin ? { hasClerkAccount: !!u.clerkUserId } : {}),
    }));

  const installerNames = installers.map((i) => ({ name: i.name, active: i.active }));
  const financerNames = financers.map((f) => ({ name: f.name, active: f.active }));

  // installPayPct needed by all users to compute correct M2/M3 split at deal submission
  const installerPayConfigs: Record<string, { installPayPct: number }> = {};
  for (const inst of installers) {
    installerPayConfigs[inst.name] = { installPayPct: inst.installPayPct };
  }

  const instIdToName: Record<string, string> = {};
  for (const inst of installers) instIdToName[inst.id] = inst.name;
  const finIdToName: Record<string, string> = {};
  for (const fin of financers) finIdToName[fin.id] = fin.name;

  // ─── Projects: strip financial fields for PMs ───
  // Admin: everything. PM: no m1/m2/m3 amounts or setter M2/M3. Rep/SD: full
  // (own deals only — already filtered by where clause above).
  const stripFinancials = isPM;
  const transformedProjects = projects.map((p) => ({
    id: p.id,
    customerId: p.id,
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
    netPPW: stripFinancials ? 0 : p.netPPW,
    phase: p.phase,
    m1Paid: stripFinancials ? false : p.m1Paid,
    m1Amount: stripFinancials ? 0 : p.m1Amount,
    m2Paid: stripFinancials ? false : p.m2Paid,
    m2Amount: stripFinancials ? 0 : p.m2Amount,
    m3Paid: stripFinancials ? false : (p.m3Paid ?? false),
    m3Amount: stripFinancials ? undefined : (p.m3Amount ?? undefined),
    setterM1Amount: stripFinancials ? undefined : (p.setterM1Amount ?? undefined),
    setterM2Amount: stripFinancials ? undefined : (p.setterM2Amount ?? undefined),
    setterM3Amount: stripFinancials ? undefined : (p.setterM3Amount ?? undefined),
    notes: p.notes,
    flagged: p.flagged,
    solarTechProductId: p.installer.name === 'SolarTech' ? (p.productId ?? undefined) : undefined,
    installerProductId: p.installer.name !== 'SolarTech' ? (p.productId ?? undefined) : undefined,
    pricingVersionId: p.installerPricingVersionId ?? undefined,
    pcPricingVersionId: p.productPricingVersionId ?? undefined,
    baselineOverride: stripFinancials ? undefined : (p.baselineOverrideJson ? (() => {
      const bo = JSON.parse(p.baselineOverrideJson);
      if (!isAdmin && bo) { delete bo.kiloPerW; }
      return bo;
    })() : undefined),
    prepaidSubType: p.prepaidSubType ?? undefined,
    leadSource: p.leadSource ?? undefined,
    blitzId: p.blitzId ?? undefined,
    subDealerId: p.subDealerId ?? undefined,
    subDealerName: p.subDealer ? `${p.subDealer.firstName} ${p.subDealer.lastName}` : undefined,
    cancellationReason: p.cancellationReason ?? undefined,
    cancellationNotes: p.cancellationNotes ?? undefined,
    updatedAt: p.updatedAt.toISOString(),
  }));

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

  const transformedTrainers = trainerAssignments.map((ta) => ({
    id: ta.id,
    trainerId: ta.trainerId,
    traineeId: ta.traineeId,
    tiers: ta.tiers.map((t) => ({
      upToDeal: t.upToDeal,
      ratePerW: t.ratePerW,
    })),
  }));

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

  // Installer pricing versions — non-sensitive reference data, all users need
  // these to render deal forms and commission calculations.
  const transformedIPV = installerPricingVersions.flatMap((v) => {
    const installerName = instIdToName[v.installerId] ?? v.installerId;
    const isTiered = v.rateType === 'tiered' || v.tiers.length > 1;
    if (!isTiered && v.tiers.length === 0) {
      logger.warn('flat_pricing_version_missing_tiers', {
        versionId: v.id, installer: installerName, label: v.label,
      });
      return [];
    }
    return [{
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
              ...(isAdmin || isSubDealer ? { kiloPerW: t.kiloPerW } : {}),
              subDealerPerW: t.subDealerPerW ?? undefined,
            })),
          }
        : {
            type: 'flat' as const,
            closerPerW: v.tiers[0].closerPerW,
            setterPerW: v.tiers[0].setterPerW ?? undefined,
            ...(isAdmin || isSubDealer ? { kiloPerW: v.tiers[0].kiloPerW } : {}),
            subDealerPerW: v.tiers[0].subDealerPerW ?? undefined,
          },
    }];
  });

  const solarTechInstaller = installers.find((i) => i.name === 'SolarTech');
  const solarTechProducts = products
    .filter((p) => p.installerId === solarTechInstaller?.id)
    .map((p) => {
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
          ...(isAdmin || isSubDealer ? { kiloPerW: t.kiloPerW } : {}),
          subDealerPerW: t.subDealerPerW ?? undefined,
        })),
      };
    });

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
          ...(isAdmin || isSubDealer ? { kiloPerW: t.kiloPerW } : {}),
          subDealerPerW: t.subDealerPerW ?? undefined,
        })),
      };
    });

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
      ...(isAdmin || isSubDealer ? { kiloPerW: t.kiloPerW } : {}),
      subDealerPerW: t.subDealerPerW ?? undefined,
    })),
  }));

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
    _idMaps: {
      installerNameToId: Object.fromEntries(installers.map((i) => [i.name, i.id])),
      financerNameToId: Object.fromEntries(financers.map((f) => [f.name, f.id])),
      repIdMap: Object.fromEntries(users.filter((u) => u.role === 'rep').map((u) => [u.id, { name: `${u.firstName} ${u.lastName}` }])),
    },
    // Current user role — so the client can mirror server enforcement in UI
    _currentUser: {
      id: user.id,
      role: user.role,
    },
  });
}
