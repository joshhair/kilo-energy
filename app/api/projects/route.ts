import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser, relationshipToProject } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProjectSchema } from '../../../lib/schemas/project';
import { enforceRateLimit } from '../../../lib/rate-limit';
import { serializeProject, serializeProjectParty, dollarsToCents, dollarsToNullableCents, scrubProjectForViewer } from '../../../lib/serialize';
import { logger } from '../../../lib/logger';

// POST /api/projects — Create a new project/deal.
// - admin: can create deals with any closer/setter/sub-dealer
// - project_manager: must have canCreateDeals flag; can create for any rep
// - rep: must be the closer or the setter on the deal they create
// - sub-dealer: must be the sub-dealer on the deal they create
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  // 30 deal creations/minute/user — the form + idempotency handle double-
  // clicks, so legit flow is nowhere near this. Catches runaway clients.
  const limited = await enforceRateLimit(`POST /api/projects:${user.id}`, 30, 60_000);
  if (limited) return limited;

  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({
      where: { id: user.id },
      select: { canCreateDeals: true },
    });
    if (!pm?.canCreateDeals) {
      return NextResponse.json({ error: 'Forbidden — deal creation not enabled for this account' }, { status: 403 });
    }
  }

  const parsed = await parseJsonBody(req, createProjectSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // ─── Ownership check: reps + SDs can only create deals they're on ───
  if (user.role === 'rep') {
    const isCloser = body.closerId === user.id;
    const isSetter = body.setterId === user.id;
    if (!isCloser && !isSetter) {
      return NextResponse.json({ error: 'Forbidden — reps can only create deals they are on' }, { status: 403 });
    }
  } else if (user.role === 'sub-dealer') {
    if (body.subDealerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden — sub-dealers can only create their own deals' }, { status: 403 });
    }
  }

  // Validate blitz window and participation before writing
  if (body.blitzId) {
    if (!body.soldDate) {
      return NextResponse.json({ error: 'soldDate is required when blitzId is provided' }, { status: 400 });
    }
    const blitz = await prisma.blitz.findUnique({
      where: { id: body.blitzId },
      select: { startDate: true, endDate: true, status: true },
    });
    if (!blitz) {
      return NextResponse.json({ error: 'Blitz not found' }, { status: 400 });
    }
    if (blitz.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot attribute a deal to a cancelled blitz' }, { status: 400 });
    }
    const sold = new Date(body.soldDate);
    const start = new Date(blitz.startDate);
    const end = blitz.endDate ? new Date(blitz.endDate) : null;
    if (sold < start || (end !== null && sold > end)) {
      return NextResponse.json({ error: 'soldDate is outside the blitz window' }, { status: 400 });
    }

    if (body.closerId) {
      const participation = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: body.closerId, joinStatus: 'approved' },
      });
      if (!participation) {
        return NextResponse.json({ error: 'Closer is not an approved participant of this blitz' }, { status: 403 });
      }
    }
    if (body.setterId) {
      const setterParticipation = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: body.setterId, joinStatus: 'approved' },
      });
      if (!setterParticipation) {
        return NextResponse.json({ error: 'Setter is not an approved participant of this blitz' }, { status: 403 });
      }
    }
    for (const coCloser of body.additionalClosers ?? []) {
      const p = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: coCloser.userId, joinStatus: 'approved' },
      });
      if (!p) {
        return NextResponse.json({ error: 'Co-closer is not an approved participant of this blitz' }, { status: 403 });
      }
    }
    for (const coSetter of body.additionalSetters ?? []) {
      const p = await prisma.blitzParticipant.findFirst({
        where: { blitzId: body.blitzId, userId: coSetter.userId, joinStatus: 'approved' },
      });
      if (!p) {
        return NextResponse.json({ error: 'Co-setter is not an approved participant of this blitz' }, { status: 403 });
      }
    }
  }

  // ─── FK existence checks ───
  const closerRep = await prisma.user.findUnique({ where: { id: body.closerId }, select: { id: true, repType: true } });
  if (!closerRep) {
    return NextResponse.json({ error: 'Closer not found' }, { status: 400 });
  }
  if (closerRep.repType !== 'closer' && closerRep.repType !== 'both') {
    return NextResponse.json({ error: 'Setter-type rep cannot be assigned as closer' }, { status: 400 });
  }

  if (body.setterId) {
    const setterRep = await prisma.user.findUnique({ where: { id: body.setterId }, select: { repType: true } });
    if (setterRep && setterRep.repType !== 'setter' && setterRep.repType !== 'both') {
      return NextResponse.json({ error: 'Closer-type rep cannot be assigned as setter' }, { status: 400 });
    }
  }

  const installer = await prisma.installer.findUnique({ where: { id: body.installerId }, select: { id: true, active: true } });
  if (!installer) {
    return NextResponse.json({ error: 'Installer not found' }, { status: 400 });
  }
  if (!installer.active) {
    return NextResponse.json({ error: 'Installer is archived' }, { status: 400 });
  }

  // For Cash deals, auto-resolve the Cash financer so clients don't need the ID.
  // Cash is a system-managed record — we force active:true on every upsert so an
  // admin-triggered archive doesn't silently block new Cash deals.
  let financerId = body.financerId;
  const isCashAutoResolve = !financerId && (body.productType === 'Cash' || body.financer === 'Cash');
  if (isCashAutoResolve) {
    const cashFinancer = await prisma.financer.upsert({
      where: { name: 'Cash' },
      update: { active: true },
      create: { name: 'Cash', active: true },
    });
    financerId = cashFinancer.id;
  }
  if (!financerId) {
    return NextResponse.json({ error: 'financerId is required (unless productType=Cash)' }, { status: 400 });
  }
  // Skip the archive check on the auto-resolve path — we just reactivated it.
  if (!isCashAutoResolve) {
    const financer = await prisma.financer.findUnique({ where: { id: financerId }, select: { id: true, active: true } });
    if (!financer) {
      return NextResponse.json({ error: 'Financer not found' }, { status: 400 });
    }
    if (!financer.active) {
      return NextResponse.json({ error: 'Financer is archived' }, { status: 400 });
    }
  }

  // Build the additionalClosers / additionalSetters nested-create payload
  // so the project + its co-party rows land in a single Prisma transaction.
  // Fallback position assignment: if the client didn't send one, use the
  // array index + 1 (so the first co-closer is position 1, matching the
  // UI's "1-indexed display order" contract).
  const additionalClosersCreate = (body.additionalClosers ?? []).map((c, i) => ({
    userId: c.userId,
    m1AmountCents: dollarsToCents(c.m1Amount) ?? 0,
    m2AmountCents: dollarsToCents(c.m2Amount) ?? 0,
    m3AmountCents: dollarsToNullableCents(c.m3Amount) ?? null,
    position: c.position ?? i + 1,
  }));
  const additionalSettersCreate = (body.additionalSetters ?? []).map((s, i) => ({
    userId: s.userId,
    m1AmountCents: dollarsToCents(s.m1Amount) ?? 0,
    m2AmountCents: dollarsToCents(s.m2Amount) ?? 0,
    m3AmountCents: dollarsToNullableCents(s.m3Amount) ?? null,
    position: s.position ?? i + 1,
  }));

  const project = await prisma.project.create({
    data: {
      customerName: body.customerName,
      closerId: body.closerId,
      setterId: body.setterId ?? null,
      soldDate: body.soldDate,
      installerId: body.installerId,
      financerId,
      productType: body.productType,
      kWSize: body.kWSize,
      netPPW: body.netPPW,
      phase: body.phase,
      m1AmountCents: dollarsToCents(body.m1Amount) ?? 0,
      m2AmountCents: dollarsToCents(body.m2Amount) ?? 0,
      m3AmountCents: dollarsToNullableCents(body.m3Amount) ?? null,
      setterM1AmountCents: dollarsToCents(body.setterM1Amount) ?? 0,
      setterM2AmountCents: dollarsToCents(body.setterM2Amount) ?? 0,
      setterM3AmountCents: dollarsToNullableCents(body.setterM3Amount) ?? null,
      notes: body.notes ?? '',
      installerPricingVersionId: body.installerPricingVersionId ?? null,
      productId: body.productId ?? null,
      productPricingVersionId: body.productPricingVersionId ?? null,
      baselineOverrideJson: body.baselineOverrideJson ?? null,
      prepaidSubType: body.prepaidSubType ?? null,
      leadSource: body.leadSource ?? null,
      blitzId: body.blitzId ?? null,
      subDealerId: body.subDealerId ?? null,
      ...(additionalClosersCreate.length ? { additionalClosers: { create: additionalClosersCreate } } : {}),
      ...(additionalSettersCreate.length ? { additionalSetters: { create: additionalSettersCreate } } : {}),
    },
    include: {
      closer: true, setter: true, subDealer: true, installer: true, financer: true,
      additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
      additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
    },
  });

  const dto = {
    ...serializeProject(project),
    additionalClosers: project.additionalClosers.map(serializeProjectParty),
    additionalSetters: project.additionalSetters.map(serializeProjectParty),
  };
  const rel = relationshipToProject(user, {
    closerId: project.closerId,
    setterId: project.setterId,
    subDealerId: project.subDealerId,
    trainerId: project.trainerId,
    additionalClosers: dto.additionalClosers.map((c) => ({ userId: c.userId })),
    additionalSetters: dto.additionalSetters.map((s) => ({ userId: s.userId })),
  });
  logger.info('project_created', {
    projectId: project.id,
    actorId: user.id,
    actorRole: user.role,
    closerId: project.closerId,
    setterId: project.setterId,
    kWSize: project.kWSize,
    netPPW: project.netPPW,
    m1Cents: project.m1AmountCents,
    m2Cents: project.m2AmountCents,
    m3Cents: project.m3AmountCents,
  });
  return NextResponse.json(scrubProjectForViewer(dto, rel), { status: 201 });
}
