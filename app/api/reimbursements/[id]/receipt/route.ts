import { NextRequest, NextResponse } from 'next/server';
import { put, del as deleteBlob } from '@vercel/blob';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser } from '../../../../../lib/api-auth';
import { REP_PUBLIC_SELECT } from '../../../../../lib/redact';
import { serializeReimbursement } from '../../../../../lib/serialize';
import { logger, errorContext } from '../../../../../lib/logger';

// POST /api/reimbursements/[id]/receipt — Upload a receipt file.
// Multipart: `file` field, max 10 MB, images + PDF.
//
// RBAC:
//   - Rep can upload for their own reimbursements (repId match).
//   - Admin can upload for any.
//   - PM / sub-dealer: rejected.
//
// Side effects: stores in Vercel Blob (public URL) and writes receiptUrl +
// receiptName onto the Reimbursement row. If a prior receipt exists, the
// old blob is best-effort deleted.
//
// DELETE /api/reimbursements/[id]/receipt — Remove the attached receipt.
// Rep (own) or admin only.

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const existing = await prisma.reimbursement.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const canUpload =
    viewer.role === 'admin' ||
    (viewer.role === 'rep' && existing.repId === viewer.id);
  if (!canUpload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing `file` field' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_SIZE_BYTES / 1024 / 1024} MB limit` },
      { status: 413 },
    );
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: images (jpeg/png/heic/webp) or PDF.` },
      { status: 415 },
    );
  }

  // Preflight: receipt storage is Vercel Blob. If the token isn't set in
  // this environment (e.g., admin hasn't provisioned blob storage yet),
  // return a clear, human-readable 503 instead of letting put() throw a
  // cryptic "missing token" error. The rest of the reimbursement flow
  // (create row, approve/deny, delete) still works — only file upload
  // is gated on this env var.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    logger.error('vercel_blob_token_missing', { reimbursementId: id });
    return NextResponse.json(
      {
        error: 'Receipt upload is not configured yet. Your reimbursement was saved, but the attached file was not uploaded. Ask an admin to finish setting up receipt storage.',
        code: 'BLOB_NOT_CONFIGURED',
      },
      { status: 503 },
    );
  }

  // Namespace per-reimbursement so uploads don't clash, and include a
  // timestamp so re-upload creates a new URL (cache-bust for admins).
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `reimbursements/${id}/${Date.now()}-${safeName}${ext.endsWith(ext) ? '' : ext}`;

  let uploaded;
  try {
    uploaded = await put(key, file, {
      access: 'public',
      contentType: file.type,
    });
  } catch (err) {
    logger.error('vercel_blob_put_failed', { reimbursementId: id, ...errorContext(err) });
    return NextResponse.json({ error: 'Upload failed — try again or contact admin' }, { status: 502 });
  }

  // Best-effort delete of the prior blob (if any) so we don't accumulate
  // orphans. A failure here is non-fatal; the DB row still updates.
  if (existing.receiptUrl) {
    try { await deleteBlob(existing.receiptUrl); } catch (err) {
      logger.error('vercel_blob_replace_delete_failed', { reimbursementId: id, url: existing.receiptUrl, ...errorContext(err) });
    }
  }

  const updated = await prisma.reimbursement.update({
    where: { id },
    data: { receiptUrl: uploaded.url, receiptName: file.name },
    include: { rep: { select: REP_PUBLIC_SELECT } },
  });

  logger.info('reimbursement_receipt_uploaded', {
    reimbursementId: id,
    actorId: viewer.id,
    fileName: file.name,
    size: file.size,
  });
  return NextResponse.json(serializeReimbursement(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const existing = await prisma.reimbursement.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const canDelete =
    viewer.role === 'admin' ||
    (viewer.role === 'rep' && existing.repId === viewer.id);
  if (!canDelete) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!existing.receiptUrl) {
    return NextResponse.json({ error: 'No receipt to delete' }, { status: 400 });
  }

  try {
    await deleteBlob(existing.receiptUrl);
  } catch (err) {
    logger.error('vercel_blob_delete_failed', { reimbursementId: id, url: existing.receiptUrl, ...errorContext(err) });
  }

  const updated = await prisma.reimbursement.update({
    where: { id },
    data: { receiptUrl: null, receiptName: null },
    include: { rep: { select: REP_PUBLIC_SELECT } },
  });
  return NextResponse.json(serializeReimbursement(updated));
}
