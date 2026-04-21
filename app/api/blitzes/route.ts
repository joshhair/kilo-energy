import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser, relationshipToProject } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createBlitzSchema } from '../../../lib/schemas/business';
import { serializeProject, serializeBlitzCost, serializeProjectParty, scrubProjectForViewer } from '../../../lib/serialize';
import { logger } from '../../../lib/logger';

// GET /api/blitzes — List blitzes scoped to the current user's role.
// Admin: all blitzes. PM: all blitzes if canAccessBlitz is true. Others:
// only blitzes they own, created, or participate in (approved status).
export async function GET() {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // ─── Build a where clause that limits non-admin/non-PM users ───
  // Reps see: blitzes they're involved in (any status) OR upcoming/active
  // blitzes they haven't joined yet (so the "Browse Available" section works).
  const where: Record<string, unknown> =
    user.role === 'admin' || user.role === 'project_manager'
      ? {}
      : {
          OR: [
            { ownerId: user.id },
            { createdById: user.id },
            { participants: { some: { userId: user.id, joinStatus: { in: ['approved', 'pending'] } } } },
            { status: { in: ['upcoming', 'active'] } },
          ],
        };

  const blitzes = await prisma.blitz.findMany({
    where,
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: { orderBy: { date: 'desc' } },
      projects: {
        include: { closer: true, setter: true, installer: true, financer: true, additionalClosers: { include: { user: true } }, additionalSetters: { include: { user: true } } },
      },
      incentives: { include: { milestones: true } },
    },
    orderBy: { startDate: 'desc' },
  });

  // Non-admins: hide costs for blitzes they don't own.
  if (user.role !== 'admin') {
    for (const b of blitzes) {
      const isBlitzOwner = b.ownerId === user.id || b.createdById === user.id;
      if (!isBlitzOwner) (b as { costs: unknown[] }).costs = [];
    }
  }

  // Wire format is dollars; per-project financial scrubbing uses
  // scrubProjectForViewer (same as GET /api/blitzes/[id]) so co-party
  // relationships are classified correctly and only the viewer's own
  // commission amounts are visible.
  const serialized = blitzes.map((b) => ({
    ...b,
    projects: b.projects.map((p) => {
      const sp = serializeProject(p);
      const withParties = {
        ...sp,
        additionalClosers: p.additionalClosers.map(serializeProjectParty),
        additionalSetters: p.additionalSetters.map(serializeProjectParty),
      };
      if (user.role !== 'admin') {
        const rel = relationshipToProject(user, {
          closerId: p.closerId,
          setterId: p.setterId,
          subDealerId: (p as { subDealerId?: string | null }).subDealerId ?? null,
          trainerId: (p as { trainerId?: string | null }).trainerId ?? null,
          additionalClosers: withParties.additionalClosers.map((c) => ({ userId: c.userId })),
          additionalSetters: withParties.additionalSetters.map((sv) => ({ userId: sv.userId })),
        });
        return scrubProjectForViewer(withParties, rel);
      }
      return withParties;
    }),
    costs: b.costs.map(serializeBlitzCost),
  }));
  return NextResponse.json(serialized);
}

// POST /api/blitzes — Create a new blitz. Admin or user with canCreateBlitz.
// Owner/createdBy are forced to the current user to prevent spoofing.
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  if (user.role !== 'admin') {
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { canCreateBlitz: true } });
    if (!u?.canCreateBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz creation not enabled' }, { status: 403 });
    }
  }

  const parsed = await parseJsonBody(req, createBlitzSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Force createdById + ownerId to the current user unless admin supplies an ownerId override.
  const ownerId = user.role === 'admin' && body.ownerId ? body.ownerId : user.id;
  const createdById = user.id;

  const blitz = await prisma.blitz.create({
    data: {
      name: body.name,
      location: body.location ?? '',
      housing: body.housing ?? '',
      startDate: body.startDate,
      endDate: body.endDate,
      notes: body.notes ?? '',
      status: body.status,
      createdById,
      ownerId,
      // Auto-add the owner as an approved participant
      participants: {
        create: { userId: ownerId, joinStatus: 'approved' },
      },
    },
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: true,
    },
  });

  // Link owner's existing deals within the blitz window. At creation the only
  // approved participant is the owner, so thisBlitzParticipantIds = [ownerId].
  // This covers self-gen deals (no setter) and closer-only deals the owner already had.
  const approvedAtCreation = await prisma.blitzParticipant.findMany({
    where: { blitzId: blitz.id, joinStatus: 'approved' },
    select: { userId: true },
  });
  const approvedIds = approvedAtCreation.map((p) => p.userId);
  await prisma.project.updateMany({
    where: {
      blitzId: null,
      soldDate: { gte: blitz.startDate, lte: blitz.endDate },
      closerId: ownerId,
      OR: [{ setterId: null }, { setterId: { in: approvedIds } }],
    },
    data: { blitzId: blitz.id },
  });
  await prisma.project.updateMany({
    where: {
      blitzId: null,
      soldDate: { gte: blitz.startDate, lte: blitz.endDate },
      setterId: ownerId,
      closerId: { in: approvedIds },
    },
    data: { blitzId: blitz.id },
  });
  const coRoleProjects = await prisma.project.findMany({
    where: {
      blitzId: null,
      soldDate: { gte: blitz.startDate, lte: blitz.endDate },
      OR: [
        { additionalClosers: { some: { userId: ownerId } }, closerId: { in: approvedIds } },
        { additionalSetters: { some: { userId: ownerId } }, setterId: { in: approvedIds } },
      ],
    },
    select: { id: true },
  });
  for (const project of coRoleProjects) {
    await prisma.project.update({ where: { id: project.id }, data: { blitzId: blitz.id } });
  }

  const serialized = {
    ...blitz,
    projects: blitz.projects.map(serializeProject),
    costs: blitz.costs.map(serializeBlitzCost),
  };
  logger.info('blitz_created', {
    blitzId: blitz.id,
    actorId: user.id,
    ownerId,
    startDate: blitz.startDate,
    endDate: blitz.endDate,
  });
  return NextResponse.json(serialized, { status: 201 });
}
