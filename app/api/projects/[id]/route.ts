import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser, userCanAccessProject, relationshipToProject, loadChainTrainees } from '../../../../lib/api-auth';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchProjectSchema, type PatchProjectInput } from '../../../../lib/schemas/project';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { serializeProject, serializeProjectParty, dollarsToCents, dollarsToNullableCents, scrubProjectForViewer } from '../../../../lib/serialize';
import { computeProjectCommission, COMMISSION_INPUT_KEYS } from '../../../../lib/commission-server';
import { fromDollars } from '../../../../lib/money';
import type { InstallerBaseline } from '../../../../lib/data';
import { logger } from '../../../../lib/logger';

// Financial fields project managers must NOT be able to modify
const PM_BLOCKED_FIELDS: Array<keyof PatchProjectInput> = [
  'm1Paid', 'm1Amount', 'm2Paid', 'm2Amount', 'm3Amount', 'm3Paid',
  'setterM1Amount', 'setterM2Amount', 'setterM3Amount', 'netPPW', 'baselineOverrideJson',
  // Tag-team splits are money — admin-only same as the primary amounts.
  'additionalClosers', 'additionalSetters',
  // Per-project trainer override is pay config — admin-only.
  'trainerId', 'trainerRate',
];

// Fields reps/sub-dealers are NEVER allowed to modify on their own deals —
// they can change notes, flag, and customer-facing info but not money,
// phase (admin/PM only), or ownership.
const REP_BLOCKED_FIELDS: Array<keyof PatchProjectInput> = [
  ...PM_BLOCKED_FIELDS,
  'phase', 'closerId', 'setterId',
];

// PATCH /api/projects/[id] — Update a project (phase change, notes, flag, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  // Higher ceiling on project patches — admins routinely click through many
  // phase changes in a short window. 120/min covers that; legit Kanban
  // drag-drops won't hit it.
  const limited = await enforceRateLimit(`PATCH /api/projects/[id]:${user.id}`, 120, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchProjectSchema);
  if (!parsed.ok) return parsed.response;
  const body: PatchProjectInput = { ...parsed.data };

  // ─── Project ownership check ───
  // Reps + sub-dealers can only modify deals they're on.
  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) {
    return NextResponse.json({ error: 'Forbidden — no access to this project' }, { status: 403 });
  }

  // ─── Field-level authorization ───
  if (user.role === 'project_manager') {
    for (const field of PM_BLOCKED_FIELDS) delete body[field];
  } else if (user.role === 'rep' || user.role === 'sub-dealer') {
    for (const field of REP_BLOCKED_FIELDS) delete body[field];
  }

  // Validate blitz participation and window before writing (mirrors POST /api/projects validation)
  // Also runs when only setterId/closerId/soldDate changes — the project may already have a blitzId.
  if (body.blitzId || body.setterId !== undefined || body.closerId !== undefined || body.soldDate !== undefined) {
    const existing = await prisma.project.findUnique({ where: { id }, select: { closerId: true, setterId: true, blitzId: true, soldDate: true } });
    const effectiveBlitzId = body.blitzId !== undefined ? body.blitzId : existing?.blitzId;
    if (effectiveBlitzId) {
      const blitz = await prisma.blitz.findUnique({
        where: { id: effectiveBlitzId },
        select: { startDate: true, endDate: true, status: true },
      });
      if (blitz) {
        if (blitz.status === 'cancelled') {
          return NextResponse.json({ error: 'Cannot link a project to a cancelled blitz' }, { status: 400 });
        }
        const effectiveSoldDate = body.soldDate ?? existing?.soldDate;
        if (effectiveSoldDate) {
          const sold = new Date(effectiveSoldDate);
          if (sold < new Date(blitz.startDate) || sold > new Date(blitz.endDate)) {
            return NextResponse.json({ error: 'soldDate is outside the blitz window' }, { status: 400 });
          }
        }
      }
      const closerId = body.closerId !== undefined ? body.closerId : (existing?.closerId ?? null);
      if (closerId) {
        const participation = await prisma.blitzParticipant.findFirst({
          where: { blitzId: effectiveBlitzId, userId: closerId, joinStatus: 'approved' },
        });
        if (!participation) {
          return NextResponse.json({ error: 'Closer is not an approved participant of this blitz' }, { status: 403 });
        }
      }
      const setterId = body.setterId !== undefined ? body.setterId : (existing?.setterId ?? null);
      if (setterId) {
        const setterParticipation = await prisma.blitzParticipant.findFirst({
          where: { blitzId: effectiveBlitzId, userId: setterId, joinStatus: 'approved' },
        });
        if (!setterParticipation) {
          return NextResponse.json({ error: 'Setter is not an approved participant of this blitz' }, { status: 403 });
        }
      }
    }
  }

  // Build update data, only including fields that were sent.
  // Zod has already validated types + bounds at the boundary.
  const data: Record<string, unknown> = {};
  // When phase changes, stamp phaseChangedAt so staleness calc uses the true phase-entry time.
  if (body.phase !== undefined) {
    const current = await prisma.project.findUnique({ where: { id }, select: { phase: true } });
    if (current && current.phase !== body.phase) {
      data.phaseChangedAt = new Date();
    }
  }

  const passthrough: Array<keyof PatchProjectInput> = [
    'phase', 'notes', 'flagged',
    'm1Paid', 'm2Paid', 'm3Paid',
    'cancellationReason', 'cancellationNotes', 'baselineOverrideJson',
    'leadSource', 'blitzId', 'productType', 'kWSize', 'netPPW', 'soldDate',
  ];
  for (const key of passthrough) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  // adminNotes — gated on admin/PM role. A rep cannot set this field even
  // if they include it in the request body; we 403 rather than silently
  // drop so a buggy client fails loudly rather than sending a no-op.
  if (body.adminNotes !== undefined) {
    if (user.role !== 'admin' && user.role !== 'project_manager') {
      return NextResponse.json({ error: 'Forbidden — adminNotes is admin/PM only' }, { status: 403 });
    }
    data.adminNotes = body.adminNotes;
  }

  // Money fields: wire dollars → Int cents at the DB seam.
  if (body.m1Amount !== undefined) data.m1AmountCents = dollarsToCents(body.m1Amount);
  if (body.m2Amount !== undefined) data.m2AmountCents = dollarsToCents(body.m2Amount);
  if (body.m3Amount !== undefined) data.m3AmountCents = dollarsToNullableCents(body.m3Amount);
  if (body.setterM1Amount !== undefined) data.setterM1AmountCents = dollarsToCents(body.setterM1Amount);
  if (body.setterM2Amount !== undefined) data.setterM2AmountCents = dollarsToCents(body.setterM2Amount);
  if (body.setterM3Amount !== undefined) data.setterM3AmountCents = dollarsToNullableCents(body.setterM3Amount);
  // Nullable FK fields: empty string → null
  if (body.closerId !== undefined) data.closerId = body.closerId || null;
  if (body.setterId !== undefined) data.setterId = body.setterId || null;
  // Per-project trainer override — nullable FK + nullable rate.
  if (body.trainerId !== undefined) data.trainerId = body.trainerId || null;
  if (body.trainerRate !== undefined) data.trainerRate = body.trainerRate ?? null;

  // FK resolution: installer/financer name → ID
  if (body.installer !== undefined) {
    const inst = await prisma.installer.findFirst({ where: { name: body.installer } });
    if (!inst) return NextResponse.json({ error: `Installer "${body.installer}" not found` }, { status: 400 });
    if (!inst.active) return NextResponse.json({ error: 'Installer is archived' }, { status: 400 });
    data.installerId = inst.id;
  }
  if (body.financer !== undefined) {
    const fin = await prisma.financer.findFirst({ where: { name: body.financer } });
    if (!fin) return NextResponse.json({ error: `Financer "${body.financer}" not found` }, { status: 400 });
    if (!fin.active) return NextResponse.json({ error: 'Financer is archived' }, { status: 400 });
    data.financerId = fin.id;
  }

  // ─── Server-authoritative commission recompute (Batch 2b) ─────────────
  // If ANY math-input changed (netPPW, kWSize, installer, product, closer,
  // setter, trainer override, co-parties, etc.), recompute commission
  // amounts server-side and OVERRIDE whatever the client sent in the
  // same body. Client's m1Amount/m2Amount/etc. are silently discarded.
  //
  // Prevents the Timothy-Salunga-shape bug where editing netPPW left
  // stale stored amounts. Same resolvers as the client — see
  // lib/commission-server.ts for how it mirrors the new-deal compute.
  const bodyTouchesCommissionInputs = COMMISSION_INPUT_KEYS.some((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (bodyTouchesCommissionInputs) {
    const current = await prisma.project.findUnique({
      where: { id },
      include: {
        installer: true,
        additionalClosers: true,
        additionalSetters: true,
      },
    });
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Sub-dealer deals don't use the standard commission formula — skip the
    // recompute entirely so we don't overwrite stored amounts with zeros.
    if (current.subDealerId) {
      // Remove any client-sent commission amounts from data so the stored
      // values are left untouched.
      delete data.m1AmountCents;
      delete data.m2AmountCents;
      delete data.m3AmountCents;
      delete data.setterM1AmountCents;
      delete data.setterM2AmountCents;
      delete data.setterM3AmountCents;
    } else {

    // Load the pricing/trainer data needed by the resolver.
    const [
      installerPricingVersionsRaw,
      productCatalogProductsRaw,
      productCatalogPricingVersionsRaw,
      trainerAssignmentsRaw,
      payrollEntriesRaw,
      installers,
    ] = await Promise.all([
      prisma.installerPricingVersion.findMany({ include: { tiers: true } }),
      prisma.product.findMany({ where: { active: true }, include: { pricingVersions: { include: { tiers: true } } } }),
      prisma.productPricingVersion.findMany({ include: { tiers: true } }),
      prisma.trainerAssignment.findMany({ include: { tiers: { orderBy: { sortOrder: 'asc' } } } }),
      prisma.payrollEntry.findMany({ where: { paymentStage: 'Trainer' } }),
      prisma.installer.findMany({ select: { id: true, name: true, installPayPct: true, usesProductCatalog: true } }),
    ]);

    // Shape the loaded data into the forms the resolvers expect.
    // Library types use camelCase / slightly different field names than
    // the Prisma shape — do the conversion here at the seam.
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
    const solarTechProducts = productCatalogProductsRaw
      .filter((p) => p.installerId === solarTechInstaller?.id)
      .map((p) => {
        const now = new Date();
        const activeVersion = p.pricingVersions.find((v) => v.effectiveTo === null && new Date(v.effectiveFrom) <= now)
          ?? p.pricingVersions[0];
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

    // Build effective inputs: body value if sent, else current DB value.
    const installerName = body.installer !== undefined
      ? body.installer
      : installers.find((i) => i.id === current.installerId)?.name ?? '';

    const effectiveBaselineOverride: InstallerBaseline | null = (() => {
      const json = body.baselineOverrideJson !== undefined ? body.baselineOverrideJson : current.baselineOverrideJson;
      if (!json) return null;
      try { return JSON.parse(json) as InstallerBaseline; } catch { return null; }
    })();

    const effectiveAdditionalClosers = body.additionalClosers !== undefined
      ? body.additionalClosers.map((c) => ({ m1Amount: c.m1Amount ?? 0, m2Amount: c.m2Amount ?? 0, m3Amount: c.m3Amount ?? null }))
      : current.additionalClosers.map((c) => ({ m1Amount: c.m1AmountCents / 100, m2Amount: c.m2AmountCents / 100, m3Amount: c.m3AmountCents == null ? null : c.m3AmountCents / 100 }));
    const effectiveAdditionalSetters = body.additionalSetters !== undefined
      ? body.additionalSetters.map((s) => ({ m1Amount: s.m1Amount ?? 0, m2Amount: s.m2Amount ?? 0, m3Amount: s.m3Amount ?? null }))
      : current.additionalSetters.map((s) => ({ m1Amount: s.m1AmountCents / 100, m2Amount: s.m2AmountCents / 100, m3Amount: s.m3AmountCents == null ? null : s.m3AmountCents / 100 }));

    const result = computeProjectCommission(
      {
        soldDate: body.soldDate ?? current.soldDate,
        netPPW: body.netPPW ?? current.netPPW,
        kWSize: body.kWSize ?? current.kWSize,
        installer: installerName,
        productType: body.productType ?? current.productType,
        closerId: body.closerId !== undefined ? (body.closerId || null) : current.closerId,
        setterId: body.setterId !== undefined ? (body.setterId || null) : current.setterId,
        subDealerId: current.subDealerId,
        solarTechProductId: installerName === 'SolarTech' ? (current.productId ?? null) : null,
        installerProductId: installerName !== 'SolarTech' ? (current.productId ?? null) : null,
        baselineOverride: effectiveBaselineOverride,
        trainerId: body.trainerId !== undefined ? (body.trainerId || null) : current.trainerId,
        trainerRate: body.trainerRate !== undefined ? (body.trainerRate ?? null) : current.trainerRate,
        additionalClosers: effectiveAdditionalClosers,
        additionalSetters: effectiveAdditionalSetters,
      },
      {
        installerPricingVersions,
        solarTechProducts,
        productCatalogProducts,
        productCatalogPricingVersions,
        trainerAssignments,
        payrollEntries,
        installerPayConfigs,
        currentProjectId: id,
      },
    );

    // Override any client-sent amounts with the server-computed values.
    data.m1AmountCents = fromDollars(result.m1Amount).cents;
    data.m2AmountCents = fromDollars(result.m2Amount).cents;
    data.m3AmountCents = result.m3Amount == null ? null : fromDollars(result.m3Amount).cents;
    data.setterM1AmountCents = fromDollars(result.setterM1Amount).cents;
    data.setterM2AmountCents = fromDollars(result.setterM2Amount).cents;
    data.setterM3AmountCents = result.setterM3Amount == null ? null : fromDollars(result.setterM3Amount).cents;
    } // end else (not sub-dealer)
  }

  // Snapshot before-state for audit diff (only fields we care about).
  const auditSelect: Record<string, true> = {};
  for (const f of AUDITED_FIELDS.Project) auditSelect[f] = true;
  const before = await prisma.project.findUnique({
    where: { id },
    select: auditSelect,
  });

  // If the body included additionalClosers / additionalSetters, replace
  // the existing rows wholesale. Omitting the key leaves rows untouched
  // — admins editing notes or phase won't lose co-party attribution.
  // Full-replace (rather than diff-based upsert) is simpler and the
  // 10-row max from the Zod schema keeps the deleteMany + createMany
  // cheap. Wrapped in a transaction so a failed createMany doesn't leave
  // the project with zero co-parties mid-save.
  if (body.additionalClosers !== undefined || body.additionalSetters !== undefined) {
    await prisma.$transaction(async (tx) => {
      if (body.additionalClosers !== undefined) {
        await tx.projectCloser.deleteMany({ where: { projectId: id } });
        if (body.additionalClosers.length > 0) {
          await tx.projectCloser.createMany({
            data: body.additionalClosers.map((c, i) => ({
              projectId: id,
              userId: c.userId,
              m1AmountCents: dollarsToCents(c.m1Amount) ?? 0,
              m2AmountCents: dollarsToCents(c.m2Amount) ?? 0,
              m3AmountCents: dollarsToNullableCents(c.m3Amount) ?? null,
              position: c.position ?? i + 1,
            })),
          });
        }
      }
      if (body.additionalSetters !== undefined) {
        await tx.projectSetter.deleteMany({ where: { projectId: id } });
        if (body.additionalSetters.length > 0) {
          await tx.projectSetter.createMany({
            data: body.additionalSetters.map((s, i) => ({
              projectId: id,
              userId: s.userId,
              m1AmountCents: dollarsToCents(s.m1Amount) ?? 0,
              m2AmountCents: dollarsToCents(s.m2Amount) ?? 0,
              m3AmountCents: dollarsToNullableCents(s.m3Amount) ?? null,
              position: s.position ?? i + 1,
            })),
          });
        }
      }
    });
  }

  const project = await prisma.project.update({
    where: { id },
    data,
    include: {
      closer: true, setter: true, installer: true, financer: true,
      additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
      additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
    },
  });

  // Audit: record diff of audited fields (no-op if nothing changed in them).
  const phaseChanged = before && (before as Record<string, unknown>).phase !== project.phase;
  await logChange({
    actor: { id: user.id, email: user.email ?? null },
    action: phaseChanged ? 'phase_change' : 'project_update',
    entityType: 'Project',
    entityId: id,
    before: before as Record<string, unknown> | undefined,
    after: project as unknown as Record<string, unknown>,
    fields: AUDITED_FIELDS.Project,
  });
  logger.info('project_updated', {
    projectId: id,
    actorId: user.id,
    actorRole: user.role,
    phaseChanged: !!phaseChanged,
    phase: project.phase,
    fieldsChanged: Object.keys(data).length,
  });

  const dto = {
    ...serializeProject(project),
    additionalClosers: project.additionalClosers.map(serializeProjectParty),
    additionalSetters: project.additionalSetters.map(serializeProjectParty),
  };
  const chainTrainees = user.role === 'rep' ? await loadChainTrainees(user.id) : undefined;
  const rel = relationshipToProject(user, {
    closerId: project.closerId,
    setterId: project.setterId,
    subDealerId: (project as { subDealerId?: string | null }).subDealerId ?? null,
    trainerId: project.trainerId,
    additionalClosers: dto.additionalClosers.map((c) => ({ userId: c.userId })),
    additionalSetters: dto.additionalSetters.map((s) => ({ userId: s.userId })),
  }, chainTrainees);
  return NextResponse.json(scrubProjectForViewer(dto, rel));
}

// DELETE /api/projects/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  // Delete related records first (activity, messages, payroll entries)
  await prisma.projectActivity.deleteMany({ where: { projectId: id } });
  await prisma.projectCheckItem.deleteMany({ where: { message: { projectId: id } } });
  await prisma.projectMention.deleteMany({ where: { message: { projectId: id } } });
  await prisma.projectMessage.deleteMany({ where: { projectId: id } });
  await prisma.payrollEntry.deleteMany({ where: { projectId: id } });
  await prisma.project.delete({ where: { id } });
  logger.info('project_deleted', { projectId: id, actorId: viewer.id });
  return NextResponse.json({ success: true });
}
