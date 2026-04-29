import { NextRequest, NextResponse } from 'next/server';
import { del as deleteBlob } from '@vercel/blob';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchReimbursementSchema } from '../../../../lib/schemas/reimbursement';
import { REP_PUBLIC_SELECT } from '../../../../lib/redact';
import { logger, errorContext } from '../../../../lib/logger';
import { serializeReimbursement } from '../../../../lib/serialize';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';

// PATCH /api/reimbursements/[id] — Admin only. Updates status (approve /
// deny / paid / reset to pending) and/or archive flag. receiptUrl /
// receiptName also patchable for admin corrections.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchReimbursementSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.archived !== undefined) data.archivedAt = body.archived ? new Date() : null;
  if (body.receiptUrl !== undefined) data.receiptUrl = body.receiptUrl;
  if (body.receiptName !== undefined) data.receiptName = body.receiptName;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const before = await prisma.reimbursement.findUnique({ where: { id } });
  const reimbursement = await prisma.reimbursement.update({
    where: { id },
    data,
    include: { rep: { select: REP_PUBLIC_SELECT } },
  });
  logger.info('reimbursement_updated', {
    reimbursementId: id,
    actorId: actor.id,
    fieldsChanged: Object.keys(data),
    newStatus: reimbursement.status,
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'reimbursement_update',
    entityType: 'Reimbursement',
    entityId: id,
    before: before ?? undefined, after: reimbursement,
    fields: AUDITED_FIELDS.Reimbursement,
  });
  return NextResponse.json(serializeReimbursement(reimbursement));
}

// DELETE /api/reimbursements/[id] — Admin only. Hard delete for typo
// cleanup. Also deletes the Vercel Blob receipt if one is attached
// (best effort; the DB row is the source of truth).
//
// For the common case (hide from the default list without losing the
// record), use PATCH with `{archived: true}` instead.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const existing = await prisma.reimbursement.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Best-effort blob cleanup. If it fails, the DB row still gets deleted
  // and the orphan blob can be cleaned up from the Vercel dashboard.
  if (existing.receiptUrl) {
    try {
      await deleteBlob(existing.receiptUrl);
    } catch (err) {
      logger.error('vercel_blob_delete_failed', { reimbursementId: id, url: existing.receiptUrl, ...errorContext(err) });
    }
  }

  await prisma.reimbursement.delete({ where: { id } });
  logger.info('reimbursement_deleted', { reimbursementId: id, actorId: viewer.id });
  await logChange({
    actor: { id: viewer.id, email: viewer.email },
    action: 'reimbursement_delete',
    entityType: 'Reimbursement',
    entityId: id,
    detail: { repId: existing.repId, amountCents: existing.amountCents, status: existing.status, description: existing.description },
  });
  return NextResponse.json({ success: true });
}

// Silence the unused-import warning for requireInternalUser — it's wired
// when we later add a rep-owned upload fallback. For now only admin mutates.
void requireInternalUser;
