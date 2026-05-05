import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { parseJsonBody } from '@/lib/api-validation';
import { patchProjectInstallerNoteSchema } from '@/lib/schemas/pricing';
import { isVendorPM } from '@/lib/api-auth';
import { logChange } from '@/lib/audit';

// PATCH  /api/projects/[id]/installer-notes/[noteId] — Edit a note.
// DELETE /api/projects/[id]/installer-notes/[noteId] — Remove a note.
//
// Privacy: gated for visibility. Authorship rule layered on top:
//   - admin / internal PM: can edit/delete ANY note
//   - vendor PM: can edit/delete only their OWN notes (authorId === user.id)
// This prevents BVI's PM from editing notes that BVI ops staff didn't write.

function canMutate(
  authorId: string,
  user: { id: string; role: string; scopedInstallerId: string | null },
): boolean {
  if (user.role === 'admin') return true;
  // Internal PMs (allowlisted, no scope) — same as admin for these.
  if (user.role === 'project_manager' && !user.scopedInstallerId) return true;
  // Vendor PMs: own notes only.
  if (isVendorPM(user)) return authorId === user.id;
  return false;
}

export const PATCH = withApiHandler<{ id: string; noteId: string }>(async (req, { params, user }) => {
  const { id, noteId } = await params!;

  const existing = await db.projectInstallerNote.findUnique({ where: { id: noteId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.projectId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canMutate(existing.authorId, user)) {
    return NextResponse.json({ error: 'Cannot edit notes authored by someone else' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, patchProjectInstallerNoteSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await db.projectInstallerNote.update({
    where: { id: noteId },
    data: { body: parsed.data.body.trim() },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_installer_note_update',
    entityType: 'ProjectInstallerNote',
    entityId: noteId,
    detail: {
      projectId: id,
      previousLength: existing.body.length,
      newLength: updated.body.length,
    },
  });

  return NextResponse.json(updated);
});

export const DELETE = withApiHandler<{ id: string; noteId: string }>(async (_req, { params, user }) => {
  const { id, noteId } = await params!;

  const existing = await db.projectInstallerNote.findUnique({ where: { id: noteId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.projectId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canMutate(existing.authorId, user)) {
    return NextResponse.json({ error: 'Cannot delete notes authored by someone else' }, { status: 403 });
  }

  await db.projectInstallerNote.delete({ where: { id: noteId } });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_installer_note_delete',
    entityType: 'ProjectInstallerNote',
    entityId: noteId,
    detail: {
      projectId: id,
      authorId: existing.authorId,
      bodyLength: existing.body.length,
    },
  });

  return NextResponse.json({ success: true });
});
