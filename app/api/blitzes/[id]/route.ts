import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser, relationshipToProject } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchBlitzSchema } from '../../../../lib/schemas/business';
import { serializeProject, serializeProjectParty, serializeBlitzCost, scrubProjectForViewer } from '../../../../lib/serialize';
import { logger } from '../../../../lib/logger';

// GET /api/blitzes/[id] — Get a single blitz. Access:
// - admin, project_manager: yes
// - owner, creator, or approved participant: yes
// - everyone else: 403
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const blitz = await prisma.blitz.findUnique({
    where: { id },
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: { orderBy: { date: 'desc' } },
      projects: {
        include: {
          closer: true, setter: true, installer: true, financer: true,
          additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
          additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
        },
      },
      incentives: { include: { milestones: true } },
    },
  });
  if (!blitz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ─── PM canAccessBlitz gate (mirrors GET /api/blitzes) ───
  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // ─── Visibility check ───
  if (user.role !== 'admin' && user.role !== 'project_manager') {
    const isOwner = blitz.ownerId === user.id;
    const isCreator = blitz.createdById === user.id;
    const isParticipant = blitz.participants.some(
      (p) => p.userId === user.id && (p.joinStatus === 'approved' || p.joinStatus === 'pending'),
    );
    if (!isOwner && !isCreator && !isParticipant) {
      return NextResponse.json({ error: 'Forbidden — not a participant' }, { status: 403 });
    }
  }

  // Non-admins (except blitz owner): hide costs. Per-project financial
  // scrubbing happens below via scrubProjectForViewer on a per-relationship
  // basis — that closes the additionalClosers/additionalSetters leak that
  // the old top-level-only zeroing missed.
  const isBlitzOwner = blitz.ownerId === user.id;
  if (user.role !== 'admin' && !isBlitzOwner) {
    (blitz as unknown as { costs: unknown[] }).costs = [];
  }

  return NextResponse.json({
    ...blitz,
    costs: blitz.costs.map(serializeBlitzCost),
    projects: blitz.projects.map((p) => {
      const s = serializeProject(p);
      const withParties = {
        ...s,
        additionalClosers: (p as { additionalClosers?: Parameters<typeof serializeProjectParty>[0][] }).additionalClosers?.map(serializeProjectParty) ?? [],
        additionalSetters: (p as { additionalSetters?: Parameters<typeof serializeProjectParty>[0][] }).additionalSetters?.map(serializeProjectParty) ?? [],
      };
      const rel = relationshipToProject(user, {
        closerId: p.closerId,
        setterId: p.setterId,
        subDealerId: (p as { subDealerId?: string | null }).subDealerId ?? null,
        trainerId: (p as { trainerId?: string | null }).trainerId ?? null,
        additionalClosers: withParties.additionalClosers.map((c) => ({ userId: c.userId })),
        additionalSetters: withParties.additionalSetters.map((s) => ({ userId: s.userId })),
      });
      return scrubProjectForViewer(withParties, rel);
    }),
  });
}

// PATCH /api/blitzes/[id] — Update blitz (admin or blitz owner)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  if (user.role !== 'admin') {
    const existing = await prisma.blitz.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.ownerId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, patchBlitzSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.location !== undefined) data.location = body.location;
  if (body.housing !== undefined) data.housing = body.housing;
  if (body.startDate !== undefined) data.startDate = body.startDate;
  if (body.endDate !== undefined) data.endDate = body.endDate;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.status !== undefined) data.status = body.status;
  if (body.ownerId !== undefined) {
    if (user.role !== 'admin') return NextResponse.json({ error: 'Only admins can transfer blitz ownership' }, { status: 403 });
    data.ownerId = body.ownerId;
  }

  const blitz = await prisma.blitz.update({
    where: { id },
    data,
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: true,
    },
  });

  // Unlink projects whose soldDate falls outside the updated date window
  if (body.startDate !== undefined || body.endDate !== undefined) {
    await prisma.project.updateMany({
      where: {
        blitzId: id,
        OR: [
          ...(blitz.startDate ? [{ soldDate: { lt: blitz.startDate } }] : []),
          ...(blitz.endDate ? [{ soldDate: { gt: blitz.endDate } }] : []),
        ],
      },
      data: { blitzId: null },
    });
    blitz.projects = await prisma.project.findMany({
      where: { blitzId: id },
      include: {
        closer: true, setter: true, installer: true, financer: true,
        additionalClosers: { include: { user: true }, orderBy: { position: 'asc' } },
        additionalSetters: { include: { user: true }, orderBy: { position: 'asc' } },
      },
    });
  }

  // Non-admins (except blitz owner): strip other reps' financial data from projects + hide costs.
  // Using `as unknown as` tightens the cast vs `any` — explicit about what
  // shape we're forcing, and only the fields we actually mutate.
  const isBlitzOwnerPatch = blitz.ownerId === user.id;
  if (user.role !== 'admin' && !isBlitzOwnerPatch) {
    (blitz as unknown as { costs: unknown[] }).costs = [];
    for (const p of blitz.projects) {
      const isMyDeal = p.closerId === user.id || p.setterId === user.id
        || (p as any).additionalClosers?.some((cc: { userId: string }) => cc.userId === user.id)
        || (p as any).additionalSetters?.some((cs: { userId: string }) => cs.userId === user.id);
      if (!isMyDeal) {
        const mp = p as unknown as {
          netPPW: number;
          m1AmountCents: number;
          m2AmountCents: number;
          m3AmountCents: number;
          setterM1AmountCents: number;
          setterM2AmountCents: number;
          setterM3AmountCents: number;
        };
        mp.netPPW = 0;
        mp.m1AmountCents = 0;
        mp.m2AmountCents = 0;
        mp.m3AmountCents = 0;
        mp.setterM1AmountCents = 0;
        mp.setterM2AmountCents = 0;
        mp.setterM3AmountCents = 0;
      }
    }
  }

  logger.info('blitz_updated', {
    blitzId: id,
    actorId: user.id,
    fieldsChanged: Object.keys(data),
  });
  return NextResponse.json({
    ...blitz,
    costs: blitz.costs.map(serializeBlitzCost),
    projects: blitz.projects.map((p) => {
      const s = serializeProject(p);
      return {
        ...s,
        additionalClosers: (p as any).additionalClosers?.map(serializeProjectParty) ?? [],
        additionalSetters: (p as any).additionalSetters?.map(serializeProjectParty) ?? [],
      };
    }),
  });
}

// DELETE /api/blitzes/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.project.updateMany({ where: { blitzId: id }, data: { blitzId: null } });
  await prisma.blitz.delete({ where: { id } });
  logger.info('blitz_deleted', { blitzId: id, actorId: actor.id });
  return NextResponse.json({ success: true });
}
