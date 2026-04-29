import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { getInternalUser, relationshipToProject, loadChainTrainees, isVendorPM, isInternalPM } from '../../../lib/api-auth';
import { logger } from '../../../lib/logger';
import { toDollars, fromCents } from '../../../lib/money';
import { scrubProjectForViewer } from '../../../lib/serialize';
import {
  canViewKiloOnBaselineTier,
  canViewKiloOnProjectOverride,
} from '../../../lib/baseline-visibility';

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
  // Routed through lib/baseline-visibility helpers so the privacy
  // contract has one source of truth (tested in
  // tests/unit/baseline-visibility.test.ts). DO NOT inline new
  // role-based pricing-visibility checks — extend the helpers instead.
  const showKiloOnTier = canViewKiloOnBaselineTier({ role: user.role });
  const showKiloOnProjectOverride = canViewKiloOnProjectOverride({ role: user.role });
  // Vendor PM (role=project_manager AND scopedInstallerId set): sees only
  // projects whose installerId matches their scope. No payroll, no
  // reimbursements, no trainer assignments, no incentives, no rep
  // directory. The field-visibility matrix additionally scrubs commission
  // + margin fields from every project they do see.
  const isVendor = isVendorPM(user);
  // Misconfigured PM: project_manager with no scopedInstallerId AND
  // not on the INTERNAL_PM_EMAILS allowlist. Default-deny rather than
  // silently granting org-wide access (the previous behavior — a
  // vendor PM created without a scope ended up seeing everything).
  const isMisconfiguredPM = isPM && !user.scopedInstallerId && !isInternalPM(user);
  if (isMisconfiguredPM) {
    logger.warn('misconfigured_pm_blocked', {
      userId: user.id,
      email: user.email,
      message: 'project_manager without scopedInstallerId and not on INTERNAL_PM_EMAILS allowlist — denying access',
    });
  }

  // ─── Trainer-chain lookup ──────────────────────────────────────────────
  // A rep who's assigned as trainer to other reps needs to see those reps'
  // projects (to verify own override, not for coaching UI — the Training
  // tab handles that). Loaded once per request; empty Set for non-reps.
  // The field-visibility matrix scrubs trainer views down to their own
  // override; closer/setter commission + kiloMargin stay hidden.
  const chainTrainees = isRep ? await loadChainTrainees(user.id) : new Set<string>();
  const chainTraineeIds = Array.from(chainTrainees);

  // ─── Project filter: who sees which projects? ───
  // Defense-in-depth: positive allowlist + default-DENY at the end. The
  // previous shape ("empty where = full access") leaked when a user's
  // role didn't match any branch — every misconfigured row, every typo,
  // every future role got admin-level visibility by accident. The
  // Joe-Dale-BVI leak (2026-04-26) was traced to exactly this fall-
  // through. Any unknown user shape now returns zero rows + logs loud.
  const isInternal = isInternalPM(user);
  const isAllowlisted = isAdmin || isInternal;
  let projectWhere: Record<string, unknown>;
  if (isAllowlisted) {
    projectWhere = {};
  } else if (isMisconfiguredPM) {
    projectWhere = { id: '__deny_misconfigured_pm__' };
  } else if (isVendor) {
    projectWhere = { installerId: user.scopedInstallerId! };
  } else if (isRep) {
    projectWhere = {
      OR: [
        { closerId: user.id },
        { setterId: user.id },
        { additionalClosers: { some: { userId: user.id } } },
        { additionalSetters: { some: { userId: user.id } } },
        { trainerId: user.id },
        ...(chainTraineeIds.length > 0 ? [{ closerId: { in: chainTraineeIds } }] : []),
      ],
    };
  } else if (isSubDealer) {
    projectWhere = { OR: [{ subDealerId: user.id }, { closerId: user.id }] };
  } else {
    // Default DENY. Unknown / null / unexpected role shape — block
    // and log. Reaching this branch is a configuration bug.
    logger.warn('default_deny_project_access', {
      userId: user.id,
      email: user.email,
      role: user.role,
      reason: 'role does not match any allowed branch',
    });
    projectWhere = { id: '__deny_unknown_role__' };
  }

  // ─── Payroll filter: positive allowlist + default-deny. ───
  let payrollWhere: Record<string, unknown>;
  if (isAdmin) {
    payrollWhere = {};
  } else if (isVendor || isMisconfiguredPM) {
    payrollWhere = { repId: '__deny_vendor_pm_no_payroll__' };
  } else if (isInternal || isRep || isSubDealer) {
    // PM (internal), rep, sub-dealer all see only their OWN payroll.
    payrollWhere = { repId: user.id };
  } else {
    payrollWhere = { repId: '__deny_unknown_role__' };
  }

  // ─── Reimbursements: same shape. ───
  let reimbWhere: Record<string, unknown>;
  if (isAdmin) {
    reimbWhere = {};
  } else if (isVendor || isMisconfiguredPM) {
    reimbWhere = { repId: '__deny_vendor_pm_no_reimb__' };
  } else if (isInternal || isRep || isSubDealer) {
    reimbWhere = { repId: user.id };
  } else {
    reimbWhere = { repId: '__deny_unknown_role__' };
  }

  // ─── Trainer assignments: rep sees self-as-trainer or trainee. ───
  let trainerWhere: Record<string, unknown>;
  if (isAdmin || isInternal) {
    trainerWhere = {};
  } else if (isVendor || isMisconfiguredPM) {
    trainerWhere = { id: '__deny_vendor_pm_no_training__' };
  } else if (isRep || isSubDealer) {
    trainerWhere = { OR: [{ trainerId: user.id }, { traineeId: user.id }] };
  } else {
    trainerWhere = { id: '__deny_unknown_role__' };
  }

  // ─── Incentives: rep/SD see targeted-at-them OR company-wide. ───
  let incentiveWhere: Record<string, unknown>;
  if (isAdmin || isInternal) {
    incentiveWhere = {};
  } else if (isVendor || isMisconfiguredPM) {
    incentiveWhere = { id: '__deny_vendor_pm_no_incentives__' };
  } else if (isRep || isSubDealer) {
    incentiveWhere = { OR: [{ targetRepId: user.id }, { targetRepId: null }] };
  } else {
    incentiveWhere = { id: '__deny_unknown_role__' };
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
    // Vendor PMs see NO user directory — the projects they get (below)
    // already embed the closer/setter names inline via `include: closer`,
    // so they can still render "Closer: Joe Smith" without the full
    // contact directory. We scrub the returned list to empty to block
    // any accidental exposure elsewhere in the client.
    prisma.user.findMany({
      where: (() => {
        if (isAdmin) return {}; // includes deactivated for historical contexts
        if (isVendor || isMisconfiguredPM) return { id: '__deny_vendor_pm_no_users__' };
        if (isInternal || isRep || isSubDealer) return { active: true };
        return { id: '__deny_unknown_role__' };
      })(),
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
        // Per-project trainer override — expose name inline for the UI.
        trainer: true,
        installer: true,
        financer: true,
        // Tag-team co-parties — join the user row so the wire format
        // can expose a friendly `userName` without a second round-trip.
        additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
        additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
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
    // Active products only by default. Archived products (active=false)
    // are surfaced via the dedicated /api/products?archived=1 admin
    // endpoint or by the Archived-tab toggle in the Baselines UI, which
    // calls the existing list endpoints. Keeping the main hydration
    // payload free of archived rows means rep / sub-dealer / vendor PM
    // contexts never see soft-deleted products.
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
  // Includes (a) every user with role='rep', and (b) admins who have opted
  // in to selling by setting a repType. Admins without a repType stay out
  // of the list — they're pure-admin and shouldn't appear in closer/setter
  // dropdowns. The `role` field is preserved as-is so the client can
  // distinguish selling admins from regular reps if it needs to.
  const reps = users
    .filter((u) => u.role === 'rep' || (u.role === 'admin' && !!u.repType))
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      email: isAdmin ? u.email : '',
      phone: isAdmin ? u.phone : '',
      role: u.role as 'rep' | 'admin',
      repType: u.repType as 'closer' | 'setter' | 'both',
      active: u.active,
      ...(isAdmin ? { hasClerkAccount: !!u.clerkUserId } : {}),
      canRequestBlitz: u.canRequestBlitz ?? false,
      canCreateBlitz: u.canCreateBlitz ?? false,
    }));

  // ─── View-As candidates: admins + project managers (admin only) ───
  // Admins use this to impersonate PMs and admin colleagues from the View
  // As picker. Reps + sub-dealers + PMs get an empty list — view-as is an
  // admin-only privilege. PII (email/phone) is omitted; only id+name+role
  // are needed for the picker.
  const viewAsCandidates = isAdmin
    ? users
        .filter((u) => u.active && (u.role === 'admin' || u.role === 'project_manager'))
        .map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`,
          role: u.role as 'admin' | 'project_manager',
          scopedInstallerId: u.scopedInstallerId ?? null,
        }))
    : [];

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

  // ─── Projects: viewer-aware scrubbing ───
  // PM: financial columns zeroed via the legacy `stripFinancials` branch
  //   inside the transform below. Kept because PM-specific UI depends on
  //   zero values, not `undefined`.
  // Rep / sub-dealer: wrapped in scrubProjectForViewer after the transform
  //   to apply the per-relationship policy (closer sees setter total, setter
  //   sees own only, etc.). See lib/serialize.ts.
  // Admin: passthrough — scrubber short-circuits for admin relationship.
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
    m1Amount: stripFinancials ? 0 : toDollars(fromCents(p.m1AmountCents)),
    m2Paid: stripFinancials ? false : p.m2Paid,
    m2Amount: stripFinancials ? 0 : toDollars(fromCents(p.m2AmountCents)),
    m3Paid: stripFinancials ? false : (p.m3Paid ?? false),
    m3Amount: stripFinancials ? undefined : (p.m3AmountCents == null ? undefined : toDollars(fromCents(p.m3AmountCents))),
    setterM1Amount: stripFinancials ? undefined : toDollars(fromCents(p.setterM1AmountCents)),
    setterM2Amount: stripFinancials ? undefined : toDollars(fromCents(p.setterM2AmountCents)),
    setterM3Amount: stripFinancials ? undefined : (p.setterM3AmountCents == null ? undefined : toDollars(fromCents(p.setterM3AmountCents))),
    notes: p.notes,
    // adminNotes is included unconditionally in the raw DTO; the
    // scrubProjectForViewer pass below strips it for every viewer
    // relationship except admin + pm via the fieldVisibility matrix.
    adminNotes: p.adminNotes,
    flagged: p.flagged,
    solarTechProductId: p.installer.name === 'SolarTech' ? (p.productId ?? undefined) : undefined,
    installerProductId: p.installer.name !== 'SolarTech' ? (p.productId ?? undefined) : undefined,
    pricingVersionId: p.installerPricingVersionId ?? undefined,
    pcPricingVersionId: p.productPricingVersionId ?? undefined,
    baselineOverride: stripFinancials ? undefined : (p.baselineOverrideJson ? (() => {
      let bo: Record<string, unknown> | undefined;
      try { bo = JSON.parse(p.baselineOverrideJson); } catch { bo = undefined; }
      if (!showKiloOnProjectOverride && bo) { delete bo.kiloPerW; }
      return bo;
    })() : undefined),
    prepaidSubType: p.prepaidSubType ?? undefined,
    leadSource: p.leadSource ?? undefined,
    blitzId: p.blitzId ?? undefined,
    subDealerId: p.subDealerId ?? undefined,
    subDealerName: p.subDealer ? `${p.subDealer.firstName} ${p.subDealer.lastName}` : undefined,
    // Per-project trainer override — only expose to admins (the rate + name
    // are pay config; reps shouldn't see them). PMs already blocked via
    // stripFinancials above; non-admin UIs don't render these anyway.
    trainerId:   isAdmin ? (p.trainerId ?? undefined) : undefined,
    trainerName: isAdmin && p.trainer ? `${p.trainer.firstName} ${p.trainer.lastName}` : undefined,
    trainerRate: isAdmin ? (p.trainerRate ?? undefined) : undefined,
    cancellationReason: p.cancellationReason ?? undefined,
    cancellationNotes: p.cancellationNotes ?? undefined,
    phaseChangedAt: p.phaseChangedAt?.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    importedFromGlide: p.importedFromGlide,
    // Tag-team co-parties. PMs see structure but no amounts (stripFinancials).
    additionalClosers: stripFinancials ? [] : p.additionalClosers.map((c) => ({
      userId: c.userId,
      userName: `${c.user.firstName} ${c.user.lastName}`,
      m1Amount: toDollars(fromCents(c.m1AmountCents)),
      m2Amount: toDollars(fromCents(c.m2AmountCents)),
      m3Amount: c.m3AmountCents == null ? null : toDollars(fromCents(c.m3AmountCents)),
      position: c.position,
    })),
    additionalSetters: stripFinancials ? [] : p.additionalSetters.map((s) => ({
      userId: s.userId,
      userName: `${s.user.firstName} ${s.user.lastName}`,
      m1Amount: toDollars(fromCents(s.m1AmountCents)),
      m2Amount: toDollars(fromCents(s.m2AmountCents)),
      m3Amount: s.m3AmountCents == null ? null : toDollars(fromCents(s.m3AmountCents)),
      position: s.position,
    })),
  }));

  // Apply viewer-aware scrubbing (no-op for admin; PM already stripped via
  // stripFinancials; reps get per-relationship policy applied).
  const scrubbedProjects = transformedProjects.map((dto, idx) => {
    const raw = projects[idx];
    const rel = relationshipToProject(user, {
      closerId: raw.closerId,
      setterId: raw.setterId,
      subDealerId: raw.subDealerId,
      trainerId: raw.trainerId,
      // Required for the vendor_pm branch in relationshipToProject —
      // without this, vendor PMs silently degrade to 'none'. The
      // field-visibility actions for 'vendor_pm' and 'none' happen to be
      // identical today, so this was a latent bug rather than an active
      // leak. Wiring it up removes the silent-fail and makes intent
      // explicit if the matrix ever diverges.
      installerId: raw.installerId,
      additionalClosers: raw.additionalClosers.map((c) => ({ userId: c.userId })),
      additionalSetters: raw.additionalSetters.map((s) => ({ userId: s.userId })),
    }, chainTrainees);
    return scrubProjectForViewer(dto, rel);
  });

  const transformedPayroll = payrollEntries.map((pe) => ({
    id: pe.id,
    repId: pe.repId,
    repName: `${pe.rep.firstName} ${pe.rep.lastName}`,
    projectId: pe.projectId,
    customerName: pe.project?.customerName ?? '',
    amount: toDollars(fromCents(pe.amountCents)),
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
    amount: toDollars(fromCents(r.amountCents)),
    description: r.description,
    date: r.date,
    status: r.status,
    receiptName: r.receiptName ?? undefined,
    receiptUrl: r.receiptUrl ?? undefined,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : undefined,
  }));

  const transformedTrainers = trainerAssignments.map((ta) => ({
    id: ta.id,
    trainerId: ta.trainerId,
    traineeId: ta.traineeId,
    // isActiveTraining defaults to true at the DB layer; surface it so the
    // client can distinguish Active Trainees from Residuals. Old consumers
    // that ignore the field keep working — it's optional on the wire type.
    isActiveTraining: ta.isActiveTraining,
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
              ...(showKiloOnTier ? { kiloPerW: t.kiloPerW } : {}),
              subDealerPerW: t.subDealerPerW ?? undefined,
            })),
          }
        : {
            type: 'flat' as const,
            closerPerW: v.tiers[0].closerPerW,
            setterPerW: v.tiers[0].setterPerW ?? undefined,
            ...(showKiloOnTier ? { kiloPerW: v.tiers[0].kiloPerW } : {}),
            subDealerPerW: v.tiers[0].subDealerPerW ?? undefined,
          },
    }];
  });

  const solarTechInstaller = installers.find((i) => i.name === 'SolarTech');
  const solarTechProducts = products
    .filter((p) => p.installerId === solarTechInstaller?.id)
    .map((p) => {
      const now = new Date();
      const activeVersion = p.pricingVersions.find((v) => v.effectiveTo === null && new Date(v.effectiveFrom) <= now)
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
          ...(showKiloOnTier ? { kiloPerW: t.kiloPerW } : {}),
          subDealerPerW: t.subDealerPerW ?? undefined,
        })),
      };
    });

  const productCatalogProducts = products
    .filter((p) => p.installerId !== solarTechInstaller?.id)
    .map((p) => {
      const now = new Date();
      const activeVersion = p.pricingVersions.find((v) => v.effectiveTo === null && new Date(v.effectiveFrom) <= now)
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
          ...(showKiloOnTier ? { kiloPerW: t.kiloPerW } : {}),
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
      ...(showKiloOnTier ? { kiloPerW: t.kiloPerW } : {}),
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
    viewAsCandidates,
    installers: installerNames,
    financers: financerNames,
    installerPayConfigs,
    projects: scrubbedProjects,
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
