import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/api-auth';

// POST /api/blitzes/[id]/participants — Add a participant
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const body = await req.json();

  const participant = await prisma.blitzParticipant.create({
    data: {
      blitzId,
      userId: body.userId,
      joinStatus: body.joinStatus || 'pending',
    },
    include: { user: true },
  });
  return NextResponse.json(participant, { status: 201 });
}

// PATCH /api/blitzes/[id]/participants — Update participant
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const body = await req.json();
  // body: { userId, joinStatus?, attendanceStatus? }

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
  return NextResponse.json(updated);
}

// DELETE /api/blitzes/[id]/participants — Remove a participant
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const { searchParams } = req.nextUrl;
  const userId = searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  await prisma.blitzParticipant.deleteMany({ where: { blitzId, userId } });
  return NextResponse.json({ success: true });
}
