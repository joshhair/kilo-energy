import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../../lib/api-validation';
import { patchProjectMessageSchema } from '../../../../../../lib/schemas/business';

// PATCH /api/projects/[id]/messages/[messageId] — Update check items or mark mentions read
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id, messageId } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, patchProjectMessageSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Branch 1: toggle a check item.
  if ('checkItemId' in body) {
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

  // Branch 2: mark mentions as read — scoped to current user only.
  await prisma.projectMention.updateMany({
    where: { messageId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
