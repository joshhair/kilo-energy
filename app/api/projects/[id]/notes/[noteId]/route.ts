import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { requireInternalUser, userCanAccessProject } from '../../../../../../lib/api-auth';

// DELETE /api/projects/[id]/notes/[noteId] — delete a note.
// Policy: admin can delete any note. Anyone else can only delete notes
// they authored. Vendor PMs can delete their own notes on their
// installer's projects like any other author.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id, noteId } = await params;

  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const note = await prisma.projectNote.findUnique({ where: { id: noteId } });
  if (!note || note.projectId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (user.role !== 'admin' && note.authorId !== user.id) {
    return NextResponse.json({ error: 'Forbidden — can only delete own notes' }, { status: 403 });
  }
  await prisma.projectNote.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}
