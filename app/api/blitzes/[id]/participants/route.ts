import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { deriveBlitzStatus } from '../../../../../lib/blitzStatus';
import {
  createBlitzParticipantSchema,
  patchBlitzParticipantSchema,
} from '../../../../../lib/schemas/business';
import { logChange } from '../../../../../lib/audit';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

// POST /api/blitzes/[id]/participants — Add a participant
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = await prisma.user.findFirst({ where: { email } });
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit per-caller — 50 join/approve writes per hour. Caps the
  // damage from a compromised non-admin token (e.g. a setter using a
  // leaked token to spam-join blitzes or churn pending requests).
  const limited = await enforceRateLimit(`POST /api/blitzes/[id]/participants:${caller.id}`, 50, 60 * 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, createBlitzParticipantSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const blitz = await prisma.blitz.findUnique({ where: { id: blitzId }, select: { ownerId: true, status: true, startDate: true, endDate: true } });
  if (!blitz) return NextResponse.json({ error: 'Blitz not found' }, { status: 404 });
  const effectiveStatus = deriveBlitzStatus(blitz);
  if (effectiveStatus === 'cancelled' || effectiveStatus === 'completed') {
    return NextResponse.json({ error: 'Cannot join a cancelled or completed blitz' }, { status: 409 });
  }
  if (caller.role !== 'admin' && caller.id !== blitz.ownerId && caller.id !== body.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const joinStatus = (caller.role !== 'admin' && caller.id !== blitz.ownerId) ? 'pending' : (body.joinStatus ?? 'pending');
  let participant;
  try {
    const existingParticipant = await prisma.blitzParticipant.findUnique({
      where: { blitzId_userId: { blitzId, userId: body.userId } },
    });
    if (existingParticipant) {
      if (existingParticipant.joinStatus !== 'declined') {
        return NextResponse.json({ error: 'Rep is already a participant in this blitz' }, { status: 409 });
      }
      // Re-add a previously declined rep by resetting their status
      participant = await prisma.blitzParticipant.update({
        where: { id: existingParticipant.id },
        data: { joinStatus },
        include: { user: true },
      });
      // Re-link their deals within the blitz window if they are now approved
      if (joinStatus === 'approved') {
        const thisBlitzParticipants = await prisma.blitzParticipant.findMany({
          where: { blitzId, joinStatus: 'approved' },
          select: { userId: true },
        });
        const thisBlitzParticipantIds = thisBlitzParticipants.map(p => p.userId);
        await prisma.project.updateMany({
          where: {
            blitzId: null,
            soldDate: { gte: blitz.startDate, lte: blitz.endDate },
            closerId: body.userId,
            OR: [{ setterId: null }, { setterId: { in: thisBlitzParticipantIds } }],
          },
          data: { blitzId },
        });
        await prisma.project.updateMany({
          where: {
            blitzId: null,
            soldDate: { gte: blitz.startDate, lte: blitz.endDate },
            setterId: body.userId,
            closerId: { in: thisBlitzParticipantIds },
          },
          data: { blitzId },
        });
        const coRoleProjects = await prisma.project.findMany({
          where: {
            blitzId: null,
            soldDate: { gte: blitz.startDate, lte: blitz.endDate },
            OR: [
              { additionalClosers: { some: { userId: body.userId } } },
              { additionalSetters: { some: { userId: body.userId } } },
            ],
          },
          select: { id: true, closerId: true, setterId: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
        });
        for (const project of coRoleProjects) {
          const primaryIds = [project.closerId, project.setterId].filter((id): id is string => id !== null);
          if (primaryIds.some(id => thisBlitzParticipantIds.includes(id))) {
            await prisma.project.update({ where: { id: project.id }, data: { blitzId } });
          }
        }
      }
    } else {
      participant = await prisma.blitzParticipant.create({
        data: { blitzId, userId: body.userId, joinStatus },
        include: { user: true },
      });
      if (joinStatus === 'approved') {
        const thisBlitzParticipants = await prisma.blitzParticipant.findMany({
          where: { blitzId, joinStatus: 'approved' },
          select: { userId: true },
        });
        const thisBlitzParticipantIds = thisBlitzParticipants.map(p => p.userId);
        await prisma.project.updateMany({
          where: {
            blitzId: null,
            soldDate: { gte: blitz.startDate, lte: blitz.endDate },
            closerId: body.userId,
            OR: [{ setterId: null }, { setterId: { in: thisBlitzParticipantIds } }],
          },
          data: { blitzId },
        });
        await prisma.project.updateMany({
          where: {
            blitzId: null,
            soldDate: { gte: blitz.startDate, lte: blitz.endDate },
            setterId: body.userId,
            closerId: { in: thisBlitzParticipantIds },
          },
          data: { blitzId },
        });
        const coRoleProjects = await prisma.project.findMany({
          where: {
            blitzId: null,
            soldDate: { gte: blitz.startDate, lte: blitz.endDate },
            OR: [
              { additionalClosers: { some: { userId: body.userId } } },
              { additionalSetters: { some: { userId: body.userId } } },
            ],
          },
          select: { id: true, closerId: true, setterId: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
        });
        for (const project of coRoleProjects) {
          const primaryIds = [project.closerId, project.setterId].filter((id): id is string => id !== null);
          if (primaryIds.some(id => thisBlitzParticipantIds.includes(id))) {
            await prisma.project.update({ where: { id: project.id }, data: { blitzId } });
          }
        }
      }
    }
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Rep is already a participant in this blitz' }, { status: 409 });
    }
    throw e;
  }
  await logChange({
    actor: { id: caller.id, email: caller.email },
    action: 'blitz_participant_add',
    entityType: 'Blitz',
    entityId: blitzId,
    detail: { addedUserId: body.userId, joinStatus },
  });
  return NextResponse.json(participant, { status: 201 });
}

// PATCH /api/blitzes/[id]/participants — Update participant
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;

  const parsed = await parseJsonBody(req, patchBlitzParticipantSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Resolve caller's internal user record
  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = await prisma.user.findFirst({ where: { email } });
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`PATCH /api/blitzes/[id]/participants:${caller.id}`, 50, 60 * 60_000);
  if (limited) return limited;

  // Only the blitz owner or an admin may approve/decline participants
  const blitz = await prisma.blitz.findUnique({ where: { id: blitzId }, select: { ownerId: true, startDate: true, endDate: true } });
  if (!blitz) return NextResponse.json({ error: 'Blitz not found' }, { status: 404 });
  if (caller.role !== 'admin' && caller.id !== blitz.ownerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (body.userId === blitz.ownerId && body.joinStatus !== undefined && body.joinStatus !== 'approved') {
    return NextResponse.json({ error: 'Cannot change the blitz owner\'s join status to non-approved' }, { status: 400 });
  }

  const existing = await prisma.blitzParticipant.findUnique({
    where: { blitzId_userId: { blitzId, userId: body.userId } },
  });
  if (!existing) return NextResponse.json({ error: 'Participant not found' }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.joinStatus !== undefined) data.joinStatus = body.joinStatus;
  if (body.attendanceStatus !== undefined) data.attendanceStatus = body.attendanceStatus;

  const updated = await prisma.blitzParticipant.update({
    where: { id: existing.id },
    data,
    include: { user: true },
  });

  // If the participant is no longer approved, unlink their orphaned deals (same logic as DELETE).
  if (body.joinStatus !== undefined && body.joinStatus !== 'approved' && existing.joinStatus === 'approved') {
    const approvedAfterPatch = await prisma.blitzParticipant.findMany({
      where: { blitzId, joinStatus: 'approved' },
      select: { userId: true },
    });
    const approvedIds = approvedAfterPatch.map(p => p.userId);
    // Only unlink deals where no remaining approved party is on the deal
    await prisma.project.updateMany({
      where: {
        blitzId,
        closerId: body.userId,
        OR: [{ setterId: null }, { setterId: { notIn: approvedIds } }],
        additionalClosers: { none: { userId: { in: approvedIds } } },
        additionalSetters: { none: { userId: { in: approvedIds } } },
      },
      data: { blitzId: null },
    });
    await prisma.project.updateMany({
      where: {
        blitzId,
        setterId: body.userId,
        closerId: { notIn: approvedIds },
        additionalClosers: { none: { userId: { in: approvedIds } } },
        additionalSetters: { none: { userId: { in: approvedIds } } },
      },
      data: { blitzId: null },
    });
    // Also unlink deals where the user is only an additionalCloser or additionalSetter
    const coRoleProjectsPatch = await prisma.project.findMany({
      where: { blitzId, OR: [{ additionalClosers: { some: { userId: body.userId } } }, { additionalSetters: { some: { userId: body.userId } } }] },
      select: { id: true, closerId: true, setterId: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
    });
    for (const project of coRoleProjectsPatch) {
      const involvedIds = [project.closerId, project.setterId, ...project.additionalClosers.map(c => c.userId), ...project.additionalSetters.map(s => s.userId)].filter((id): id is string => id !== null);
      if (!involvedIds.some(id => approvedIds.includes(id))) {
        await prisma.project.update({ where: { id: project.id }, data: { blitzId: null } });
      }
    }
  }

  // If the participant is re-approved after being unlinked, re-link their deals within the blitz window.
  if (body.joinStatus === 'approved' && existing.joinStatus !== 'approved') {
    // Scope re-linking to deals where the other primary party is also a participant of THIS blitz.
    // Without this, overlapping blitz windows would allow re-approval in Blitz B to steal deals
    // that were originally linked to Blitz A (their blitzId was set to null when unlinked from A).
    const thisBlitzParticipants = await prisma.blitzParticipant.findMany({
      where: { blitzId, joinStatus: 'approved' },
      select: { userId: true },
    });
    const thisBlitzParticipantIds = thisBlitzParticipants.map(p => p.userId);

    // Re-link deals where user is closer: setter must be absent or a participant of this blitz
    await prisma.project.updateMany({
      where: {
        blitzId: null,
        soldDate: { gte: blitz.startDate, lte: blitz.endDate },
        closerId: body.userId,
        OR: [{ setterId: null }, { setterId: { in: thisBlitzParticipantIds } }],
      },
      data: { blitzId },
    });
    // Re-link deals where user is setter: closer must be a participant of this blitz
    await prisma.project.updateMany({
      where: {
        blitzId: null,
        soldDate: { gte: blitz.startDate, lte: blitz.endDate },
        setterId: body.userId,
        closerId: { in: thisBlitzParticipantIds },
      },
      data: { blitzId },
    });
    const coRoleProjects = await prisma.project.findMany({
      where: {
        blitzId: null,
        soldDate: { gte: blitz.startDate, lte: blitz.endDate },
        OR: [
          { additionalClosers: { some: { userId: body.userId } } },
          { additionalSetters: { some: { userId: body.userId } } },
        ],
      },
      select: { id: true, closerId: true, setterId: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
    });
    for (const project of coRoleProjects) {
      // Only re-link if the primary closer or setter is a participant of this blitz
      const primaryIds = [project.closerId, project.setterId].filter((id): id is string => id !== null);
      if (primaryIds.some(id => thisBlitzParticipantIds.includes(id))) {
        await prisma.project.update({ where: { id: project.id }, data: { blitzId } });
      }
    }
  }

  await logChange({
    actor: { id: caller.id, email: caller.email },
    action: 'blitz_participant_update',
    entityType: 'Blitz',
    entityId: blitzId,
    detail: {
      affectedUserId: body.userId,
      joinStatusBefore: existing.joinStatus,
      joinStatusAfter: updated.joinStatus,
      attendanceStatusAfter: updated.attendanceStatus,
    },
  });
  return NextResponse.json(updated);
}

// DELETE /api/blitzes/[id]/participants — Remove a participant
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const { searchParams } = req.nextUrl;
  const userId = searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = await prisma.user.findFirst({ where: { email } });
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`DELETE /api/blitzes/[id]/participants:${caller.id}`, 50, 60 * 60_000);
  if (limited) return limited;

  const blitz = await prisma.blitz.findUnique({ where: { id: blitzId }, select: { ownerId: true } });
  if (!blitz) return NextResponse.json({ error: 'Blitz not found' }, { status: 404 });
  if (caller.role !== 'admin' && caller.id !== blitz.ownerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (userId === blitz.ownerId) {
    return NextResponse.json({ error: 'Cannot remove the blitz owner as a participant' }, { status: 400 });
  }

  await prisma.blitzParticipant.deleteMany({ where: { blitzId, userId } });

  // Only unlink deals where no remaining approved party is on the deal
  const approvedAfterDelete = await prisma.blitzParticipant.findMany({
    where: { blitzId, joinStatus: 'approved' },
    select: { userId: true },
  });
  const approvedIds = approvedAfterDelete.map(p => p.userId);
  await prisma.project.updateMany({
    where: {
      blitzId,
      closerId: userId,
      OR: [{ setterId: null }, { setterId: { notIn: approvedIds } }],
      additionalClosers: { none: { userId: { in: approvedIds } } },
      additionalSetters: { none: { userId: { in: approvedIds } } },
    },
    data: { blitzId: null },
  });
  await prisma.project.updateMany({
    where: {
      blitzId,
      setterId: userId,
      closerId: { notIn: approvedIds },
      additionalClosers: { none: { userId: { in: approvedIds } } },
      additionalSetters: { none: { userId: { in: approvedIds } } },
    },
    data: { blitzId: null },
  });
  // Also unlink deals where the user is only an additionalCloser or additionalSetter
  const coRoleProjectsDelete = await prisma.project.findMany({
    where: { blitzId, OR: [{ additionalClosers: { some: { userId } } }, { additionalSetters: { some: { userId } } }] },
    select: { id: true, closerId: true, setterId: true, additionalClosers: { select: { userId: true } }, additionalSetters: { select: { userId: true } } },
  });
  for (const project of coRoleProjectsDelete) {
    const involvedIds = [project.closerId, project.setterId, ...project.additionalClosers.map(c => c.userId), ...project.additionalSetters.map(s => s.userId)].filter((id): id is string => id !== null);
    if (!involvedIds.some(id => approvedIds.includes(id))) {
      await prisma.project.update({ where: { id: project.id }, data: { blitzId: null } });
    }
  }

  await logChange({
    actor: { id: caller.id, email: caller.email },
    action: 'blitz_participant_remove',
    entityType: 'Blitz',
    entityId: blitzId,
    detail: { removedUserId: userId },
  });
  return NextResponse.json({ success: true });
}
