import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../../lib/api-auth';

// PATCH /api/projects/[id]/messages/[messageId] — Update check items or mark mentions read
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id, messageId } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }
  const body = await req.json();

  // Toggle check item completion — must be a user on the project.
  if (body.checkItemId) {
    const data: Record<string, unknown> = {};
    if (body.completed !== undefined) {
      data.completed = body.completed;
      // Force completedBy to the current user — do not trust client-supplied value.
      data.completedBy = body.completed ? user.id : null;
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

  // Mark mentions as read — force targetUserId to current user, ignore body.
  if (body.markMentionRead) {
    await prisma.projectMention.updateMany({
      where: { messageId, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'No valid operation specified' }, { status: 400 });
}
