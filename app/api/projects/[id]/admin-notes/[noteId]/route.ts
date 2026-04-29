import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { requireInternalUser, userCanAccessProject, isVendorPM, isInternalPM as isInternalPMHelper } from '../../../../../../lib/api-auth';
import { logChange } from '../../../../../../lib/audit';

// DELETE /api/projects/[id]/admin-notes/[noteId] — delete an admin note.
// Policy: admin can delete any note. Internal PM can delete their own.
// Vendor PMs / reps / SDs / trainers: 403 — they shouldn't even see
// the admin notes surface.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id, noteId } = await params;

  const isAdmin = user.role === 'admin';
  // Internal PM = unscoped PM on INTERNAL_PM_EMAILS allowlist. Misconfigured
  // vendor PMs (role=project_manager + no scope, not allowlisted) get the
  // same 403 as anyone else here.
  const internalPm = isInternalPMHelper(user);
  if (!isAdmin && !internalPm) {
    return NextResponse.json(
      { error: 'Forbidden — admin notes are internal-only' },
      { status: 403 },
    );
  }

  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isVendorPM(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const note = await prisma.projectAdminNote.findUnique({ where: { id: noteId } });
  if (!note || note.projectId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!isAdmin && note.authorId !== user.id) {
    return NextResponse.json({ error: 'Forbidden — can only delete own notes' }, { status: 403 });
  }
  await prisma.projectAdminNote.delete({ where: { id: noteId } });
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_admin_note_delete',
    entityType: 'Project',
    entityId: id,
    detail: { noteId, originalAuthorId: note.authorId, originalAuthorName: note.authorName },
  });
  return NextResponse.json({ ok: true });
}
