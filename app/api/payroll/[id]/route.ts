import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchPayrollEntrySchema } from '../../../../lib/schemas/pricing';
import { REP_PUBLIC_SELECT } from '../../../../lib/redact';
import { serializePayrollEntry, dollarsToCents } from '../../../../lib/serialize';
import { logger } from '../../../../lib/logger';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';

// PATCH /api/payroll/[id] — Update a single payroll entry (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchPayrollEntrySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Allowed status transitions for a single payroll entry. Forward
  // transitions mirror the publish-workflow (Draft → Pending → Paid).
  // Reverse transitions are admin-only corrections:
  //   - Pending → Draft: always allowed (pulls an entry out of the
  //     current payroll batch before publish).
  //   - Paid → Pending: allowed only within the 24-hour grace window
  //     after the original Paid transition. After that, corrections
  //     go through a negative-adjustment entry (real payroll, no
  //     retroactive history editing).
  // `paidAt` is stamped on the Paid transition and checked on reverse.
  const GRACE_WINDOW_MS = 24 * 60 * 60 * 1000;
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    Draft: ['Pending'],
    Pending: ['Paid', 'Draft'],
    Paid: ['Pending'],
  };

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    const current = await prisma.payrollEntry.findUnique({
      where: { id },
      select: { status: true, paidAt: true },
    });
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (body.status !== current.status) {
      const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          { error: `Invalid transition: ${current.status} → ${body.status}. Allowed: ${current.status} → ${allowed.length ? allowed.join(' | ') : '(none)'}` },
          { status: 422 }
        );
      }
      // Paid → Pending: enforce 24h grace window on paidAt.
      if (current.status === 'Paid' && body.status === 'Pending') {
        const paidAt = current.paidAt ? current.paidAt.getTime() : null;
        if (paidAt == null || Date.now() - paidAt > GRACE_WINDOW_MS) {
          return NextResponse.json(
            { error: 'Paid → Pending reversal is only allowed within 24 hours of the Paid transition. Add a negative adjustment entry to correct a post-window mistake.' },
            { status: 422 },
          );
        }
      }
    }
    data.status = body.status;
    // Stamp/clear paidAt based on the target state. Only set on forward
    // Pending→Paid; clear on Paid→Pending reversal (the reversed entry
    // hasn't been Paid after the reversal, so paidAt becoming stale
    // would make a subsequent re-Paid skip the window check).
    if (body.status === 'Paid') {
      data.paidAt = new Date();
    } else if (body.status === 'Pending' && current.status === 'Paid') {
      data.paidAt = null;
    }
  }
  if (body.amount !== undefined) data.amountCents = dollarsToCents(body.amount);
  if (body.date !== undefined) data.date = body.date;
  if (body.notes !== undefined) data.notes = body.notes;

  const before = await prisma.payrollEntry.findUnique({ where: { id } });
  const entry = await prisma.payrollEntry.update({
    where: { id },
    data,
    include: { rep: { select: REP_PUBLIC_SELECT }, project: true },
  });
  logger.info('payroll_updated', {
    entryId: id,
    actorId: actor.id,
    fieldsChanged: Object.keys(data),
    newStatus: entry.status,
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'payroll_entry_update',
    entityType: 'PayrollEntry',
    entityId: id,
    before: before ?? undefined, after: entry,
    fields: AUDITED_FIELDS.PayrollEntry,
  });
  return NextResponse.json(serializePayrollEntry(entry));
}

// DELETE /api/payroll/[id]
// Admin: can delete any payroll entry.
// PM: can only delete DRAFT entries (legitimate use case is phase rollback
//     cleanup; PMs must never be able to reach Pending/Paid entries).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdminOrPM(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  // For PMs, verify the entry is still Draft. Admin bypasses this.
  if (actor.role !== 'admin') {
    const entry = await prisma.payrollEntry.findUnique({ where: { id }, select: { status: true } });
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (entry.status !== 'Draft') {
      return NextResponse.json({ error: 'Forbidden — only admins can delete Pending or Paid entries' }, { status: 403 });
    }
  }

  const before = await prisma.payrollEntry.findUnique({ where: { id } });
  await prisma.payrollEntry.delete({ where: { id } });
  logger.info('payroll_deleted', { entryId: id, actorId: actor.id, actorRole: actor.role });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'payroll_entry_delete',
    entityType: 'PayrollEntry',
    entityId: id,
    detail: before
      ? { repId: before.repId, projectId: before.projectId, status: before.status, amountCents: before.amountCents, paymentStage: before.paymentStage }
      : { id },
  });
  return NextResponse.json({ success: true });
}
