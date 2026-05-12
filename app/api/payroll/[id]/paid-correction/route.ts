import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { paidCorrectionSchema } from '../../../../../lib/schemas/pricing';
import { REP_PUBLIC_SELECT } from '../../../../../lib/redact';
import { serializePayrollEntry, dollarsToCents } from '../../../../../lib/serialize';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logger } from '../../../../../lib/logger';
import { logChange } from '../../../../../lib/audit';
import { sendEmail } from '../../../../../lib/email-helpers';
import { renderPaidCorrectionEmail } from '../../../../../lib/email-templates/paid-correction';

// POST /api/payroll/[id]/paid-correction — admin-only retroactive edit of
// a Paid entry's recorded amount.
//
// Distinct from the standard PATCH /api/payroll/[id]:
//   - Standard PATCH refuses to edit Paid entries past the 24h grace
//     window (doctrine: real payment corrections go through negative-
//     adjustment entries, not history mutation).
//   - This route handles the OTHER case: the recorded value diverged
//     from what was actually paid (Glide-import typos, kW changes after
//     pay, manual entry errors). No money flow — just data correction.
//
// On first correction, the pre-correction amount is captured into
// originalAmountCents so the audit trail never loses what was originally
// recorded. Subsequent corrections overwrite amountCents but keep the
// originalAmountCents pinned at the FIRST-known value.
//
// Loud-by-design: every successful correction emails ALL active admins.
// A retroactive history edit is exactly the kind of action that should
// not happen silently. Rep is not notified — many of these will be
// Glide-import cleanup where the rep's actual paid amount is unchanged.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  // 5 corrections/hour/admin — bounds runaway scripts and discourages
  // casual use. Bulk Glide cleanup at higher volume should go through
  // a dedicated migration script with explicit operator review, not
  // this UI surface.
  const limited = await enforceRateLimit(`POST /api/payroll/paid-correction:${actor.id}`, 5, 60 * 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, paidCorrectionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const current = await prisma.payrollEntry.findUnique({
    where: { id },
    include: {
      rep: { select: { firstName: true, lastName: true } },
      project: { select: { customerName: true } },
    },
  });
  if (!current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (current.status !== 'Paid') {
    return NextResponse.json(
      { error: `Paid-correction is only valid on Paid entries. This entry is ${current.status}. Use the standard edit flow instead.` },
      { status: 422 },
    );
  }

  const newAmountCents = dollarsToCents(body.amount);
  if (newAmountCents == null) {
    return NextResponse.json({ error: 'Amount must be a finite number' }, { status: 400 });
  }
  if (newAmountCents === current.amountCents) {
    return NextResponse.json(
      { error: 'New amount equals current amount — nothing to correct.' },
      { status: 422 },
    );
  }
  // Sign preservation: a chargeback entry must stay negative, a regular
  // entry must stay non-negative. Operators correcting a typo shouldn't
  // accidentally flip an entry's role.
  if (current.isChargeback && newAmountCents > 0) {
    return NextResponse.json(
      { error: 'Chargeback entry amount must remain negative.' },
      { status: 422 },
    );
  }
  if (!current.isChargeback && newAmountCents < 0) {
    return NextResponse.json(
      { error: 'Non-chargeback entry amount must remain non-negative.' },
      { status: 422 },
    );
  }

  const fromCents = current.amountCents;
  // originalAmountCents stays at the FIRST-known pre-correction value.
  // Don't overwrite on re-edit so the trail never drifts.
  const originalToPersist = current.originalAmountCents ?? current.amountCents;

  // Optimistic-concurrency guard: two admins racing the same entry
  // would otherwise last-write-wins. Match on the row's updatedAt
  // observed above so a concurrent mutation (even a non-paid-correction
  // edit) fails this update with a count of 0. Surface as 409 so the
  // client can refetch and try again with the latest state.
  const updated = await prisma.payrollEntry.update({
    where: { id, updatedAt: current.updatedAt },
    data: {
      amountCents: newAmountCents,
      originalAmountCents: originalToPersist,
      editedAfterPaidAt: new Date(),
      editedBy: actor.id,
      editReason: body.reason,
    },
    include: { rep: { select: REP_PUBLIC_SELECT }, project: true },
  }).catch((err) => {
    // Prisma throws P2025 when the where clause matches no rows. We
    // treat that as a concurrency conflict here since the row existed
    // moments ago (the findUnique succeeded) but updatedAt has moved.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
      return null;
    }
    throw err;
  });
  if (!updated) {
    return NextResponse.json(
      { error: 'Entry was modified by another admin while you were editing. Refresh and try again.' },
      { status: 409 },
    );
  }

  logger.info('payroll_entry_paid_amount_corrected', {
    entryId: id,
    actorId: actor.id,
    fromCents,
    toCents: newAmountCents,
    deltaCents: newAmountCents - fromCents,
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'payroll_entry_paid_amount_corrected',
    entityType: 'PayrollEntry',
    entityId: id,
    detail: {
      repId: current.repId,
      projectId: current.projectId,
      paymentStage: current.paymentStage,
      fromCents,
      toCents: newAmountCents,
      deltaCents: newAmountCents - fromCents,
      reason: body.reason,
      originalAmountCents: originalToPersist,
      // Preserve the original paidAt at edit time so audit-log review
      // can reconstruct "when was this entry actually paid before the
      // correction" without cross-referencing other tables.
      originalPaidAt: current.paidAt ? current.paidAt.toISOString() : null,
    },
  });

  // Fire-and-forget admin fanout. Email failure does NOT block the
  // mutation — the audit log + logger entry are the canonical record.
  void (async () => {
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'admin', active: true, NOT: { id: actor.id } },
        select: { email: true },
      });
      const recipients = admins.map((a) => a.email).filter((e): e is string => Boolean(e));
      if (recipients.length === 0) return;
      const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';
      const repName = current.rep
        ? `${current.rep.firstName ?? ''} ${current.rep.lastName ?? ''}`.trim() || 'Rep'
        : 'Rep';
      const actorName = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email || 'Admin';
      const { subject, html } = renderPaidCorrectionEmail({
        repName,
        customerName: current.project?.customerName ?? null,
        paymentStage: current.paymentStage,
        fromCents,
        toCents: newAmountCents,
        reason: body.reason,
        actorName,
        entryUrl: `${appUrl}/dashboard/payroll?entry=${id}`,
        correctedAt: new Date().toISOString(),
      });
      const result = await sendEmail({ to: recipients, subject, html });
      if (!result.ok) {
        logger.warn('paid_correction_email_send_failed', {
          entryId: id,
          code: result.code,
          error: result.error,
        });
      }
    } catch (err) {
      logger.warn('paid_correction_email_threw', {
        entryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return NextResponse.json(serializePayrollEntry(updated));
}
