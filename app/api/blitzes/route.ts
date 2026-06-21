import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser, getInternalUserById, relationshipToProject } from '../../../lib/api-auth';
import { resolveEffectiveUser } from '../../../lib/view-as';
import { parseJsonBody } from '../../../lib/api-validation';
import { createBlitzSchema } from '../../../lib/schemas/business';
import { serializeProject, serializeBlitzCost, serializeProjectParty, scrubProjectForViewer } from '../../../lib/serialize';
import { logger } from '../../../lib/logger';
import { logChange } from '../../../lib/audit';

// GET /api/blitzes — List blitzes scoped to the current user's role.
// Admin: all blitzes. PM: all blitzes if canAccessBlitz is true. Others:
// only blitzes they own, created, or participate in (approved status).
export async function GET(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  // Blitz-access authorization is on the REAL caller (can THEY use blitzes).
  if (user.role === 'project_manager') {
    const pm = await prisma.user.findUnique({ where: { id: user.id }, select: { canAccessBlitz: true } });
    if (!pm?.canAccessBlitz) {
      return NextResponse.json({ error: 'Forbidden — blitz access not enabled' }, { status: 403 });
    }
  }

  // View-As: an admin may impersonate a rep (?viewAs=<repId>) to see ONLY
  // the REP's view. resolveEffectiveUser is the security boundary
  // (admin-only, narrows only, falls back to self). The list scope, owner
  // check, project scrubbing, AND BlitzCost gating use the effective user;
  // only the audit identity + PM-access auth gate stay on the REAL user.
  const { effectiveUser, impersonating } = await resolveEffectiveUser(
    user, req.nextUrl.searchParams.get('viewAs'), getInternalUserById,
  );
  if (impersonating) {
    logger.info('view_as_read', { route: '/api/blitzes', actorId: user.id, effectiveUserId: effectiveUser.id });
  }

  // ─── Build a where clause that limits non-admin/non-PM users ───
  // Reps see: blitzes they're involved in (any status) OR upcoming/active
  // blitzes they haven't joined yet (so the "Browse Available" section works).
  const where: Record<string, unknown> =
    effectiveUser.role === 'admin' || effectiveUser.role === 'project_manager'
      ? {}
      : {
          OR: [
            { ownerId: effectiveUser.id },
            { createdById: effectiveUser.id },
            { participants: { some: { userId: effectiveUser.id, joinStatus: { in: ['approved', 'pending'] } } } },
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

  // Costs are admin-only AND gated on the EFFECTIVE user: while an admin is
  // viewing-as a rep, they must see ONLY what the rep sees — no BlitzCost
  // rows. (Non-impersonating admin → effectiveUser is the admin → costs show.)
  if (effectiveUser.role !== 'admin') {
    for (const b of blitzes) {
      (b as { costs: unknown[] }).costs = [];
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
      // Scrub from the EFFECTIVE viewer's perspective so an admin
      // viewing-as a rep sees the rep's commission view (only their own
      // amounts), not the admin's full passthrough.
      if (effectiveUser.role !== 'admin') {
        const isBlitzOwner = b.ownerId === effectiveUser.id;
        const naturalRel = relationshipToProject(effectiveUser, {
          closerId: p.closerId,
          setterId: p.setterId,
          subDealerId: (p as { subDealerId?: string | null }).subDealerId ?? null,
          trainerId: (p as { trainerId?: string | null }).trainerId ?? null,
          additionalClosers: withParties.additionalClosers.map((c) => ({ userId: c.userId })),
          additionalSetters: withParties.additionalSetters.map((sv) => ({ userId: sv.userId })),
        });
        const rel = isBlitzOwner ? 'blitz_owner' : naturalRel;
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

  // Phase 2e — RSVP defaults. If client didn't supply a confirmDeadline,
  // suggest startDate - 7 days at midnight local. Owner can edit later.
  // maxParticipants stays null (no cap) unless explicitly set.
  let defaultConfirmDeadline: Date | null = null;
  if (body.confirmDeadline === undefined && body.startDate) {
    const [y, m, d] = body.startDate.split('-').map(Number);
    if (y && m && d) {
      const startDateLocal = new Date(y, m - 1, d, 0, 0, 0);
      startDateLocal.setDate(startDateLocal.getDate() - 7);
      defaultConfirmDeadline = startDateLocal;
    }
  } else if (body.confirmDeadline) {
    defaultConfirmDeadline = new Date(body.confirmDeadline);
  }

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
      confirmDeadline: defaultConfirmDeadline,
      maxParticipants: body.maxParticipants ?? null,
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
        { additionalClosers: { some: { userId: ownerId } }, setterId: { in: approvedIds } },
        { additionalSetters: { some: { userId: ownerId } }, closerId: { in: approvedIds } },
      ],
    },
    select: { id: true },
  });
  for (const project of coRoleProjects) {
    await prisma.project.update({ where: { id: project.id }, data: { blitzId: blitz.id } });
  }

  // Re-fetch blitz after backfill so projects reflects the newly linked deals.
  const blitzWithProjects = await prisma.blitz.findUniqueOrThrow({
    where: { id: blitz.id },
    include: {
      createdBy: true,
      owner: true,
      participants: { include: { user: true } },
      costs: true,
      projects: {
        include: { closer: true, setter: true, installer: true, financer: true, additionalClosers: { include: { user: true } }, additionalSetters: { include: { user: true } } },
      },
    },
  });

  const serialized = {
    ...blitzWithProjects,
    projects: blitzWithProjects.projects.map(serializeProject),
    costs: blitzWithProjects.costs.map(serializeBlitzCost),
  };
  logger.info('blitz_created', {
    blitzId: blitz.id,
    actorId: user.id,
    ownerId,
    startDate: blitz.startDate,
    endDate: blitz.endDate,
  });
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'blitz_create',
    entityType: 'Blitz',
    entityId: blitz.id,
    detail: {
      name: blitz.name,
      location: blitz.location,
      ownerId,
      startDate: blitz.startDate,
      endDate: blitz.endDate,
      status: blitz.status,
      backfilledProjectCount: blitzWithProjects.projects.length,
    },
  });
  return NextResponse.json(serialized, { status: 201 });
}
