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
import { logger, errorContext } from '../../../../lib/logger';
import { notify } from '../../../../lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '../../../../lib/email-templates/notification';

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
  // Lead-source attribution. Reps shouldn't retroactively claim a blitz
  // they weren't tagged into at submit time — that opens the "rep
  // reattributes a teammate's deal to a blitz they were on" scenario.
  // Admin/PM-only edit.
  'leadSource', 'blitzId',
];

// Vendor PMs (installer-side staff) can touch only operational fields:
// phase, notes, flagged, cancellationReason, cancellationNotes. Everything
// else is blocked — they can't reassign reps, retarget an installer, or
// rewrite the price point.
const VENDOR_PM_ALLOWED_FIELDS: Array<keyof PatchProjectInput> = [
  'phase', 'notes', 'flagged', 'cancellationReason', 'cancellationNotes',
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
  if (user.role === 'project_manager' && user.scopedInstallerId) {
    // Vendor PM: keep only the small allow-list; drop everything else.
    for (const field of Object.keys(body) as Array<keyof PatchProjectInput>) {
      if (!VENDOR_PM_ALLOWED_FIELDS.includes(field)) delete body[field];
    }
  } else if (user.role === 'project_manager') {
    for (const field of PM_BLOCKED_FIELDS) delete body[field];
  } else if (user.role === 'rep' || user.role === 'sub-dealer') {
    // Carve-out: a rep who is the project's PRIMARY closer can cancel
    // their own deal. Setters / additional closers / additional setters
    // / sub-dealers cannot. Phase can ONLY be set to 'Cancelled' via
    // this carve-out — no other phase transitions for reps.
    let allowPhaseCancel = false;
    if (user.role === 'rep' && body.phase === 'Cancelled') {
      const primaryCheck = await prisma.project.findUnique({
        where: { id },
        select: { closerId: true },
      });
      if (primaryCheck?.closerId === user.id) {
        allowPhaseCancel = true;
      }
    }
    for (const field of REP_BLOCKED_FIELDS) {
      if (field === 'phase' && allowPhaseCancel) continue;
      delete body[field];
    }
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
          const end = blitz.endDate !== null ? new Date(blitz.endDate) : null;
          if (sold < new Date(blitz.startDate) || (end !== null && sold > end)) {
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
  // Admin's "remove all trainers from this deal" flag — suppresses chain
  // trainer visibility + commission. Only set explicitly by the project
  // sheet's Clear button; defaults false on new projects.
  if (body.noChainTrainer !== undefined) data.noChainTrainer = body.noChainTrainer;

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

  // Direct-amount edits (inline saveM1/saveM2 editors) send ONLY these
  // output keys. They skip recompute (admin's explicit override sticks)
  // but MUST still trigger the Pending-entry realign — otherwise the
  // Commission Breakdown keeps showing stale PayrollEntry amounts after
  // the admin manually tweaked M2. Fixed 2026-04-24.
  const DIRECT_AMOUNT_KEYS = [
    'm1Amount', 'm2Amount', 'm3Amount',
    'setterM1Amount', 'setterM2Amount', 'setterM3Amount',
  ] as const;
  const bodyTouchesDirectAmounts = DIRECT_AMOUNT_KEYS.some((k) => (body as Record<string, unknown>)[k] !== undefined);
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
        const effectiveSoldDate = new Date(body.soldDate ?? current.soldDate);
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
        noChainTrainer: body.noChainTrainer !== undefined ? body.noChainTrainer : current.noChainTrainer,
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

    // Preserve sold-at commission for projects whose original product is no
    // longer in the active catalog. Without this guard, a non-baseline edit
    // (trainer override, setter change, notes) on a legacy-product project
    // would route through resolveBaselines's fallback branch and silently
    // overwrite real historical commission with $0. Trainer/setter/other
    // field writes proceed normally — only the commission amount cents are
    // preserved. Client-side validation also avoids this path on no-op
    // edits; this server-side defense is the backstop. (Corrine Brooks
    // shape, 2026-05-07.)
    const isFallbackResolution = result.diagnostics.pricingSource === 'fallback';
    const hasStoredAmounts =
      current.m1AmountCents > 0 ||
      current.m2AmountCents > 0 ||
      (current.m3AmountCents ?? 0) > 0 ||
      current.setterM1AmountCents > 0 ||
      current.setterM2AmountCents > 0 ||
      (current.setterM3AmountCents ?? 0) > 0;

    if (isFallbackResolution && hasStoredAmounts) {
      console.warn(`[commission] preserving stored amounts for project ${id} — pricingSource=fallback (legacy product?) and project has non-zero amounts; skipping commission overwrite.`);
      // Discard any client-sent amounts so we don't pass them through.
      delete data.m1AmountCents;
      delete data.m2AmountCents;
      delete data.m3AmountCents;
      delete data.setterM1AmountCents;
      delete data.setterM2AmountCents;
      delete data.setterM3AmountCents;
    } else {
      // Override any client-sent amounts with the server-computed values.
      data.m1AmountCents = fromDollars(result.m1Amount).cents;
      data.m2AmountCents = fromDollars(result.m2Amount).cents;
      data.m3AmountCents = result.m3Amount == null ? null : fromDollars(result.m3Amount).cents;
      data.setterM1AmountCents = fromDollars(result.setterM1Amount).cents;
      data.setterM2AmountCents = fromDollars(result.setterM2Amount).cents;
      data.setterM3AmountCents = result.setterM3Amount == null ? null : fromDollars(result.setterM3Amount).cents;
    }
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
      trainer: true, subDealer: true,
      additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
      additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
    },
  });

  // After a commission recompute, any Draft OR Pending PayrollEntries
  // on this project that reference M1/M2/M3 stages need to have their
  // stored amounts realigned to the new Project amounts — otherwise the
  // payroll tab (and admin Commission Breakdown) keeps showing the
  // pre-recompute figures. Rule: auto-sync until Paid. Paid rows are
  // NEVER touched (money has moved). Chargebacks (isChargeback) are
  // also preserved as-is.
  //
  // Pending originally stayed frozen under the theory that "Pending
  // means committed to the next payroll run" — but Josh edited the
  // trainer override on Trevor Schauwecker AFTER marking entries
  // Pending, and the display never caught up. Admin should see the
  // right number to publish; Pending is no longer treated as
  // immutable. (2026-04-23)
  if ((bodyTouchesCommissionInputs || bodyTouchesDirectAmounts) && !project.subDealerId) {
    const draftsToSync = await prisma.payrollEntry.findMany({
      where: {
        projectId: id,
        status: { in: ['Draft', 'Pending'] },
        isChargeback: false,
        paymentStage: { in: ['M1', 'M2', 'M3', 'Trainer'] },
      },
      select: { id: true, repId: true, paymentStage: true },
    });
    // M1/M2/M3 stages: overwrite with the rep's current per-milestone
    // amount. Trainer stage is handled below (needs proportional split
    // logic to preserve an 80/20 M2/M3 split when multiple trainer
    // entries exist on the same project).
    for (const entry of draftsToSync) {
      if (entry.paymentStage === 'Trainer') continue;
      let newCents: number | null = null;
      const isCloser = entry.repId === project.closerId;
      const isSetter = entry.repId === project.setterId;
      const coCloser = (!isCloser && !isSetter)
        ? (project.additionalClosers.find((c) => c.userId === entry.repId) ?? null)
        : null;
      const coSetter = (!isCloser && !isSetter && !coCloser)
        ? (project.additionalSetters.find((s) => s.userId === entry.repId) ?? null)
        : null;
      if (entry.paymentStage === 'M1') {
        newCents = isCloser ? project.m1AmountCents
          : isSetter ? project.setterM1AmountCents
          : coCloser ? coCloser.m1AmountCents
          : coSetter ? coSetter.m1AmountCents
          : null;
      } else if (entry.paymentStage === 'M2') {
        newCents = isCloser ? project.m2AmountCents
          : isSetter ? project.setterM2AmountCents
          : coCloser ? coCloser.m2AmountCents
          : coSetter ? coSetter.m2AmountCents
          : null;
      } else if (entry.paymentStage === 'M3') {
        newCents = isCloser ? project.m3AmountCents
          : isSetter ? project.setterM3AmountCents
          : coCloser ? coCloser.m3AmountCents
          : coSetter ? coSetter.m3AmountCents
          : null;
      }
      if (newCents != null) {
        await prisma.payrollEntry.update({
          where: { id: entry.id },
          data: { amountCents: newCents },
        });
      } else {
        // Stage no longer applicable (e.g. M3 when installer changes to
        // installPayPct=100). Delete the stale draft entry; phase rollback
        // only fires on phase changes, not installer changes.
        await prisma.payrollEntry.delete({ where: { id: entry.id } });
      }
    }

    // Trainer stage: realign to the new trainerRate × kW pool. When a
    // project has multiple Draft/Pending Trainer entries (e.g. 80% at
    // M2 + 20% at M3 under installPayPct=80), preserve the existing
    // proportional split so the M2/M3 breakdown stays intact. Single-
    // entry case collapses to "entry gets the full pool" which is the
    // common path for projects before Installed phase.
    const trainerEntryIds = draftsToSync.filter((e) => e.paymentStage === 'Trainer').map((e) => e.id);
    if (trainerEntryIds.length > 0) {
      const trainerRate = project.trainerRate ?? 0;
      const kW = project.kWSize ?? 0;
      const poolCents = Math.round(trainerRate * kW * 100_000); // rate × kW × 1000 dollars, × 100 = cents
      const trainerRows = await prisma.payrollEntry.findMany({
        where: { id: { in: trainerEntryIds } },
        select: { id: true, amountCents: true },
      });
      const currentSum = trainerRows.reduce((s, e) => s + e.amountCents, 0);
      for (const row of trainerRows) {
        const proportion = currentSum > 0 ? row.amountCents / currentSum : 1 / trainerRows.length;
        const newCents = Math.round(poolCents * proportion);
        await prisma.payrollEntry.update({
          where: { id: row.id },
          data: { amountCents: newCents },
        });
      }
    }

    logger.info('drafts_realigned_after_recompute', {
      projectId: id,
      draftCount: draftsToSync.length,
      actorId: user.id,
    });
  }

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

  // Phase-change notifications — fan out to closer, setter, trainer, and
  // sub-dealer (if any), skipping the actor making the change. Choose the
  // event type by destination phase: cancellation and PTO get their own
  // events (so users can opt out of just those without losing all phase
  // updates); everything else uses the generic project_phase_change.
  if (phaseChanged) {
    const beforePhase = (before as Record<string, unknown> | undefined)?.phase as string | undefined;
    const newPhase = project.phase;
    const eventType =
      newPhase === 'Cancelled'  ? 'project_cancelled' :
      newPhase === 'PTO'        ? 'milestone_pto_granted' :
      'project_phase_change';
    const subjectByEvent: Record<string, string> = {
      project_cancelled:     `Deal cancelled — ${project.customerName}`,
      milestone_pto_granted: `PTO granted — ${project.customerName}`,
      project_phase_change:  `${project.customerName}: ${beforePhase ?? '?'} → ${newPhase}`,
    };
    const headingByEvent: Record<string, string> = {
      project_cancelled:     `Deal cancelled`,
      milestone_pto_granted: `Permission to operate granted`,
      project_phase_change:  `Phase updated`,
    };
    const projectUrl = `${process.env.APP_URL || 'https://app.kiloenergies.com'}/dashboard/projects/${id}`;
    const actorName = `${user.firstName} ${user.lastName}`;
    const recipients = Array.from(new Set([
      project.closerId,
      project.setterId,
      project.trainerId,
      project.subDealerId,
    ].filter((uid): uid is string => !!uid && uid !== user.id)));

    Promise.all(
      recipients.map((uid) =>
        notify({
          type: eventType,
          userId: uid,
          projectId: id,
          subject: subjectByEvent[eventType],
          emailHtml: renderNotificationEmail({
            heading: headingByEvent[eventType],
            bodyHtml: `
              <p style="margin:0 0 12px 0;">The <strong>${escapeHtml(project.customerName)}</strong> deal moved from <strong>${escapeHtml(beforePhase ?? '—')}</strong> to <strong>${escapeHtml(newPhase)}</strong>.</p>
              <p style="margin:0;color:#5b6477;font-size:13px;">Updated by ${escapeHtml(actorName)}.</p>
            `,
            cta: { label: 'Open deal in Kilo', url: projectUrl },
            footerNote: 'Manage which phase changes you hear about at /dashboard/preferences.',
          }),
          smsBody: `Kilo: ${project.customerName} → ${newPhase} (was ${beforePhase ?? '—'}).`,
          pushBody: `${project.customerName}: ${beforePhase ?? '—'} → ${newPhase}`,
        }),
      ),
    ).catch((err) => {
      logger.error('phase_change_notification_fanout_failed', {
        projectId: id,
        recipientCount: recipients.length,
        eventType,
        ...errorContext(err),
      });
    });
  }

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
