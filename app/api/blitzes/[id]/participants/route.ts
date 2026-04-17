import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import {
  createBlitzParticipantSchema,
  patchBlitzParticipantSchema,
} from '../../../../../lib/schemas/business';

// POST /api/blitzes/[id]/participants — Add a participant
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = await prisma.user.findFirst({ where: { email } });
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await parseJsonBody(req, createBlitzParticipantSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const blitz = await prisma.blitz.findUnique({ where: { id: blitzId }, select: { ownerId: true } });
  if (!blitz) return NextResponse.json({ error: 'Blitz not found' }, { status: 404 });
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
    } else {
      participant = await prisma.blitzParticipant.create({
        data: { blitzId, userId: body.userId, joinStatus },
        include: { user: true },
      });
    }
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Rep is already a participant in this blitz' }, { status: 409 });
    }
    throw e;
  }
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

  // Only the blitz owner or an admin may approve/decline participants
  const blitz = await prisma.blitz.findUnique({ where: { id: blitzId }, select: { ownerId: true } });
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
    await prisma.project.updateMany({ where: { blitzId, closerId: body.userId }, data: { blitzId: null } });
    await prisma.project.updateMany({ where: { blitzId, setterId: body.userId }, data: { blitzId: null } });
  }

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

  const blitz = await prisma.blitz.findUnique({ where: { id: blitzId }, select: { ownerId: true } });
  if (!blitz) return NextResponse.json({ error: 'Blitz not found' }, { status: 404 });
  if (caller.role !== 'admin' && caller.id !== blitz.ownerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (userId === blitz.ownerId) {
    return NextResponse.json({ error: 'Cannot remove the blitz owner as a participant' }, { status: 400 });
  }

  await prisma.blitzParticipant.deleteMany({ where: { blitzId, userId } });

  await prisma.project.updateMany({ where: { blitzId, closerId: userId }, data: { blitzId: null } });
  await prisma.project.updateMany({ where: { blitzId, setterId: userId }, data: { blitzId: null } });

  return NextResponse.json({ success: true });
}
