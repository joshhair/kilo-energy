import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '../../../../../../lib/db';

// PATCH /api/projects/[id]/messages/[messageId] — Update check items or mark mentions read
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { messageId } = await params;
  const body = await req.json();

  // Toggle check item completion
  if (body.checkItemId) {
    const data: any = {};
    if (body.completed !== undefined) {
      data.completed = body.completed;
      data.completedBy = body.completedBy ?? null;
      data.completedAt = body.completed ? new Date() : null;
    }
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    const updated = await prisma.projectCheckItem.update({
      where: { id: body.checkItemId },
      data,
    });
    return NextResponse.json(updated);
  }

  // Mark mentions as read
  if (body.markMentionRead && body.userId) {
    await prisma.projectMention.updateMany({
      where: { messageId, userId: body.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'No valid operation specified' }, { status: 400 });
}
