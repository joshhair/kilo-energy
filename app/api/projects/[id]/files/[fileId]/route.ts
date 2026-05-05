import { NextResponse } from 'next/server';
import { del as deleteBlob } from '@vercel/blob';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { logChange } from '@/lib/audit';
import { logger, errorContext } from '@/lib/logger';

// DELETE /api/projects/[id]/files/[fileId] — Remove a file (admin/PM/vendor-PM-of-installer).
//
// Privacy: gated db.projectFile.findUnique returns null for non-visible.
// We additionally assert projectId matches the route — defense against
// /api/projects/<wrong-id>/files/<correct-fileId> URL tampering.

export const DELETE = withApiHandler<{ id: string; fileId: string }>(async (_req, { params, user }) => {
  const { id, fileId } = await params!;

  const file = await db.projectFile.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (file.projectId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Best-effort blob delete; row delete is the canonical state change.
  try {
    await deleteBlob(file.blobUrl);
  } catch (err) {
    logger.error('vercel_blob_delete_failed', {
      projectId: id,
      fileId,
      ...errorContext(err),
    });
  }

  await db.projectFile.delete({ where: { id: fileId } });

  // If this was the project's utility bill, clear the FK pointer.
  if (file.kind === 'utility_bill') {
    await db.project.update({
      where: { id },
      data: { utilityBillFileId: null },
    }).catch(() => { /* race; tolerate */ });
  }

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_file_delete',
    entityType: 'ProjectFile',
    entityId: fileId,
    detail: {
      projectId: id,
      kind: file.kind,
      label: file.label,
      originalName: file.originalName,
    },
  });

  return NextResponse.json({ success: true });
});
