import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { logDataAccess } from '@/lib/audit-log';
import { logChange } from '@/lib/audit';
import { logger, errorContext } from '@/lib/logger';
import {
  INSTALLER_FILE_ALLOWED_CONTENT_TYPES,
  validateUploadedFile,
  buildBlobKey,
  assertBlobConfigured,
} from '@/lib/file-uploads';

// GET  /api/projects/[id]/files — List files for a project (admin/PM/vendor-PM-of-installer).
// POST /api/projects/[id]/files — Upload a new file (multipart) for the project.
//
// Privacy: gated via lib/db-gated. The visibility WHERE on ProjectFile
// scopes to projects whose installerId matches the caller's scope (vendor PM)
// or unrestricted for admin/internal PM. Reps DENY.

const VALID_KINDS = new Set([
  'utility_bill',
  'permit',
  'plan',
  'inspection',
  'as_built',
  'other',
]);

export const GET = withApiHandler<{ id: string }>(async (_req, { params, user }) => {
  const { id } = await params!;
  const files = await db.projectFile.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (files.length > 0) {
    void logDataAccess({
      route: '/api/projects/[id]/files',
      modelName: 'ProjectFile',
      recordIds: files.map((f) => f.id),
    });
  }
  // Strip blobUrl from the wire response — clients should never get the
  // raw private URL; downloads go through the gated proxy.
  const safe = files.map((f) => ({
    id: f.id,
    projectId: f.projectId,
    kind: f.kind,
    label: f.label,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    uploadedById: f.uploadedById,
    createdAt: f.createdAt,
  }));
  // user is for type-coverage; suppresses unused warning when handler
  // doesn't reference it directly.
  void user;
  return NextResponse.json(safe);
});

export const POST = withApiHandler<{ id: string }>(async (req, { params, user }) => {
  const { id } = await params!;

  // Verify the caller can see the project at all. The gate is what enforces
  // this — an invisible project returns null, which we surface as 404.
  const project = await db.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Parse multipart
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  const kindRaw = (form.get('kind') ?? 'other') as string;
  const labelRaw = (form.get('label') ?? '') as string;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field' }, { status: 400 });
  }
  const kind = VALID_KINDS.has(kindRaw) ? kindRaw : 'other';
  const label = (labelRaw && labelRaw.trim()) || file.name || 'Untitled';

  const validation = validateUploadedFile(file, { allowedTypes: INSTALLER_FILE_ALLOWED_CONTENT_TYPES });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }

  const blobReady = assertBlobConfigured();
  if (!blobReady.ok) {
    logger.error('vercel_blob_token_missing', { projectId: id, route: 'project_files_post' });
    return blobReady.response;
  }

  const key = buildBlobKey(`project-files/${id}/${kind}`, file.name);
  let uploaded;
  try {
    uploaded = await put(key, file, {
      access: 'public',
      contentType: file.type,
    });
  } catch (err) {
    logger.error('vercel_blob_put_failed', {
      projectId: id,
      route: 'project_files_post',
      ...errorContext(err),
    });
    return NextResponse.json({ error: 'Upload failed — try again or contact admin' }, { status: 502 });
  }

  // Use raw prisma via the gated db — Prisma's create operations don't go
  // through the gate's read-only interception, so the create itself works.
  // We've already verified project visibility above.
  const created = await db.projectFile.create({
    data: {
      projectId: id,
      kind,
      label,
      originalName: file.name,
      blobUrl: uploaded.url,
      blobPath: key,
      mimeType: file.type,
      sizeBytes: file.size,
      uploadedById: user.id,
    },
  });

  // If this is a utility bill, mirror it to Project.utilityBillFileId for
  // O(1) lookup at handoff time. Most recent upload wins (replacement
  // semantics — admin can re-upload to swap).
  if (kind === 'utility_bill') {
    await db.project.update({
      where: { id },
      data: { utilityBillFileId: created.id },
    });
  }

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_file_upload',
    entityType: 'ProjectFile',
    entityId: created.id,
    detail: {
      projectId: id,
      kind,
      label,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  });

  return NextResponse.json({
    id: created.id,
    projectId: created.projectId,
    kind: created.kind,
    label: created.label,
    originalName: created.originalName,
    mimeType: created.mimeType,
    sizeBytes: created.sizeBytes,
    uploadedById: created.uploadedById,
    createdAt: created.createdAt,
  });
});
