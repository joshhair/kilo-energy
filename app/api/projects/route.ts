import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProjectSchema } from '../../../lib/schemas/project';

// POST /api/projects — Create a new project/deal.
// - admin: can create deals with any closer/setter/sub-dealer
// - project_manager: must have canCreateDeals flag; can create for any rep
// - rep: must be the closer or the setter on the deal they create
// - sub-dealer: must be the sub-dealer on the deal they create
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

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
    const end = new Date(blitz.endDate);
    if (sold < start || sold > end) {
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
  }

  // ─── FK existence checks ───
  const installer = await prisma.installer.findUnique({ where: { id: body.installerId }, select: { id: true, active: true } });
  if (!installer) {
    return NextResponse.json({ error: 'Installer not found' }, { status: 400 });
  }
  if (!installer.active) {
    return NextResponse.json({ error: 'Installer is archived' }, { status: 400 });
  }

  // For Cash deals, auto-resolve the Cash financer so clients don't need the ID
  let financerId = body.financerId;
  if (!financerId && (body.productType === 'Cash' || body.financer === 'Cash')) {
    const cashFinancer = await prisma.financer.upsert({
      where: { name: 'Cash' },
      update: {},
      create: { name: 'Cash' },
    });
    financerId = cashFinancer.id;
  }
  if (!financerId) {
    return NextResponse.json({ error: 'financerId is required (unless productType=Cash)' }, { status: 400 });
  }
  const financer = await prisma.financer.findUnique({ where: { id: financerId }, select: { id: true, active: true } });
  if (!financer) {
    return NextResponse.json({ error: 'Financer not found' }, { status: 400 });
  }
  if (!financer.active) {
    return NextResponse.json({ error: 'Financer is archived' }, { status: 400 });
  }

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
      m1Amount: body.m1Amount ?? 0,
      m2Amount: body.m2Amount ?? 0,
      m3Amount: body.m3Amount ?? 0,
      setterM1Amount: body.setterM1Amount ?? 0,
      setterM2Amount: body.setterM2Amount ?? 0,
      setterM3Amount: body.setterM3Amount ?? 0,
      notes: body.notes ?? '',
      installerPricingVersionId: body.installerPricingVersionId ?? null,
      productId: body.productId ?? null,
      productPricingVersionId: body.productPricingVersionId ?? null,
      baselineOverrideJson: body.baselineOverrideJson ?? null,
      prepaidSubType: body.prepaidSubType ?? null,
      leadSource: body.leadSource ?? null,
      blitzId: body.blitzId ?? null,
      subDealerId: body.subDealerId ?? null,
    },
    include: { closer: true, setter: true, subDealer: true, installer: true, financer: true },
  });
  return NextResponse.json(project, { status: 201 });
}
