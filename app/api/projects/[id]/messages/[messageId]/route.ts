import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../../lib/api-validation';
import { patchProjectMessageSchema } from '../../../../../../lib/schemas/business';
import { logChange } from '../../../../../../lib/audit';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';

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

// DELETE /api/projects/[id]/messages/[messageId] — Delete a chatter message.
//
// Allowed when:
//   - admin or PM (full delete authority on any message), OR
//   - the message's author (delete own message)
//
// Cascades: ProjectMention + ProjectCheckItem rows are removed via the
// Prisma onDelete:Cascade relation. The audit log keeps the record of
// the deletion (entity type ProjectMessage isn't in AUDITED_FIELDS, so
// we log via the `detail` shape — captures who, when, and a snippet of
// the text + check-item count for forensics).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id, messageId } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }

  // 60/min/user — well above any legitimate manual flow, low enough to
  // catch a runaway client loop trying to bulk-delete history.
  const limited = await enforceRateLimit(`DELETE /api/projects/[id]/messages/[messageId]:${user.id}`, 60, 60_000);
  if (limited) return limited;

  const message = await prisma.projectMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      projectId: true,
      authorId: true,
      text: true,
      checkItems: { select: { id: true } },
    },
  });
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (message.projectId !== id) {
    return NextResponse.json({ error: 'Message does not belong to this project' }, { status: 400 });
  }

  const isAdminOrPM = user.role === 'admin' || user.role === 'project_manager';
  const isAuthor = message.authorId === user.id;
  if (!isAdminOrPM && !isAuthor) {
    return NextResponse.json({ error: 'Forbidden — only the author or an admin/PM can delete' }, { status: 403 });
  }

  await prisma.projectMessage.delete({ where: { id: messageId } });

  // Snippet for audit (first 200 chars). Mentions + check items count
  // captured as well so the forensic trail shows what was wiped.
  const snippet = message.text.length > 200 ? message.text.slice(0, 200) + '…' : message.text;
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_message_delete',
    entityType: 'Project',
    entityId: id,
    detail: {
      messageId,
      authorId: message.authorId,
      deletedByAuthor: isAuthor,
      deletedByAdmin: !isAuthor && isAdminOrPM,
      snippet,
      checkItemCount: message.checkItems.length,
    },
  });

  return NextResponse.json({ success: true });
}
