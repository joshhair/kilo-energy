import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { logDataAccess } from '@/lib/audit-log';

// GET /api/projects/[id]/files/[fileId]/download — Gated download proxy.
//
// Returns 302 redirect to the underlying Vercel Blob URL, but ONLY after
// confirming the caller can see the ProjectFile through the privacy gate.
// Audit-logs the access (forensic record of who downloaded what when).
//
// Note: today's blob mode is 'public' (matches reimbursement). The URL
// is unguessable but technically world-readable if exfiltrated. We
// don't expose blobUrl directly to clients — they only ever see this
// download endpoint. To upgrade: switch put({access:'private'}) on
// upload + replace the redirect here with `get()` + stream.

export const GET = withApiHandler<{ id: string; fileId: string }>(async (_req, { params }) => {
  const { id, fileId } = await params!;

  const file = await db.projectFile.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (file.projectId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  void logDataAccess({
    route: '/api/projects/[id]/files/[fileId]/download',
    modelName: 'ProjectFile',
    recordIds: [file.id],
  });

  return NextResponse.redirect(file.blobUrl, { status: 302 });
});
