import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../lib/api-auth';
import { logChange } from '../../../lib/audit';
import { parseJsonBody } from '../../../lib/api-validation';
import { createPayrollSchema, patchPayrollSchema } from '../../../lib/schemas/payroll';
import { enforceRateLimit } from '../../../lib/rate-limit';
import { REP_PUBLIC_SELECT } from '../../../lib/redact';
import { serializePayrollEntry } from '../../../lib/serialize';
import { fromDollars } from '../../../lib/money';
import { logger, errorContext } from '../../../lib/logger';
import { notify } from '../../../lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '../../../lib/email-templates/notification';

// POST /api/payroll — Create a payroll entry (admin or project manager).
//
// Idempotency: if `body.idempotencyKey` is present, check for an existing
// row with that key first. If found, return it instead of inserting again.
// This prevents accidental double-pay from double-clicks, network retries,
// or React StrictMode double-invocations. Clients should generate a fresh
// key per logical submit attempt and reuse it on retry.
export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdminOrPM(); } catch (r) { return r as NextResponse; }

  // Rate limit: 60 payroll creates/minute/user — generous for legitimate
  // bulk-publish workflows, tight enough to stop a runaway client loop.
  const limited = await enforceRateLimit(`POST /api/payroll:${actor.id}`, 60, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, createPayrollSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.idempotencyKey) {
    const existing = await prisma.payrollEntry.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
      include: { rep: { select: REP_PUBLIC_SELECT }, project: true },
    });
    if (existing) {
      return NextResponse.json(serializePayrollEntry(existing), { status: 200 });
    }
  }

  // Imported-from-Glide deals are inviolable historical records — their
  // commission state was locked at import time and pre-dated Kilo's
  // auto-generated chargeback convention. The phase-transition generator
  // in lib/context/project-transitions.ts skips them. The admin
  // manual-create path also blocks negative entries EXCEPT when the new
  // explicit isChargeback flag is set — the whole point of the Batch 2
  // work is letting admins record historical clawbacks on imported
  // cancelled deals. Positive amounts on imports still flow through
  // (legitimate post-import bonuses etc.).
  if (body.projectId && body.amount < 0 && !body.isChargeback) {
    const proj = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { importedFromGlide: true, customerName: true },
    });
    if (proj?.importedFromGlide) {
      return NextResponse.json(
        { error: `Cannot create an implicit chargeback on imported deal "${proj.customerName}". Use the explicit chargeback flow (isChargeback=true + chargebackOfId) to record a historical clawback.` },
        { status: 400 },
      );
    }
  }

  // Chargeback validation: when isChargeback=true, chargebackOfId must
  // reference an existing Paid entry on the same project+rep+stage, and
  // |amount| must not exceed the original. The Zod schema already enforces
  // (isChargeback → chargebackOfId set) and (isChargeback → amount<0).
  if (body.isChargeback && body.chargebackOfId) {
    const original = await prisma.payrollEntry.findUnique({
      where: { id: body.chargebackOfId },
      select: { id: true, projectId: true, repId: true, paymentStage: true, status: true, amountCents: true, isChargeback: true },
    });
    if (!original) {
      return NextResponse.json({ error: 'chargebackOfId does not reference an existing entry' }, { status: 400 });
    }
    if (original.isChargeback) {
      return NextResponse.json({ error: 'Cannot charge back a chargeback' }, { status: 400 });
    }
    if (original.status !== 'Paid') {
      return NextResponse.json({ error: 'Can only charge back entries in Paid status' }, { status: 400 });
    }
    if (original.projectId !== (body.projectId ?? null)) {
      return NextResponse.json({ error: 'Chargeback projectId must match original entry' }, { status: 400 });
    }
    if (original.repId !== body.repId) {
      return NextResponse.json({ error: 'Chargeback repId must match original entry' }, { status: 400 });
    }
    if (original.paymentStage !== body.paymentStage) {
      return NextResponse.json({ error: 'Chargeback paymentStage must match original entry' }, { status: 400 });
    }
    const requestedCents = Math.abs(fromDollars(body.amount).cents);
    if (requestedCents > original.amountCents) {
      return NextResponse.json({ error: 'Chargeback amount cannot exceed original entry amount' }, { status: 400 });
    }
  }

  const entry = await prisma.payrollEntry.create({
    data: {
      repId: body.repId,
      projectId: body.projectId ?? null,
      amountCents: fromDollars(body.amount).cents,
      type: body.type,
      paymentStage: body.paymentStage,
      status: body.status,
      date: body.date,
      notes: body.notes ?? '',
      idempotencyKey: body.idempotencyKey ?? null,
      isChargeback: body.isChargeback ?? false,
      chargebackOfId: body.chargebackOfId ?? null,
    },
    include: { rep: true, project: true },
  });

  await logChange({
    actor: { id: actor.id, email: actor.email ?? null },
    action: entry.isChargeback ? 'chargeback_create' : 'payroll_create',
    entityType: 'PayrollEntry',
    entityId: entry.id,
    detail: {
      repId: entry.repId,
      projectId: entry.projectId,
      amountCents: entry.amountCents,
      paymentStage: entry.paymentStage,
      status: entry.status,
      isChargeback: entry.isChargeback,
      chargebackOfId: entry.chargebackOfId,
    },
  });
  logger.info('payroll_created', {
    entryId: entry.id,
    actorId: actor.id,
    repId: entry.repId,
    projectId: entry.projectId,
    amountCents: entry.amountCents,
    paymentStage: entry.paymentStage,
    status: entry.status,
    type: entry.type,
  });

  return NextResponse.json(serializePayrollEntry(entry), { status: 201 });
}

// PATCH /api/payroll — Bulk update payroll entries (admin only)
export async function PATCH(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  // Bulk publish can touch many rows per call; cap total calls per minute.
  const limited = await enforceRateLimit(`PATCH /api/payroll:${actor.id}`, 30, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchPayrollSchema);
  if (!parsed.ok) return parsed.response;
  const { ids, status } = parsed.data;

  // Only allow lawful transitions: Draft → Pending, Pending → Paid.
  const sourceStatusMap: Record<'Pending' | 'Paid', 'Draft' | 'Pending'> = {
    Pending: 'Draft',
    Paid: 'Pending',
  };
  const sourceStatus = sourceStatusMap[status];

  // Stamp paidAt on the Paid transition so the 24h grace-window rule in
  // the single-entry PATCH handler knows when to allow Paid→Pending
  // reversal. Pending transitions leave paidAt alone (null for a
  // never-paid entry, or stale from a reversed-then-re-progressed entry
  // — the single-entry reversal clears it explicitly).
  const updateData: Record<string, unknown> = { status };
  if (status === 'Paid') updateData.paidAt = new Date();

  // Capture which IDs are actually eligible for the transition before we
  // run updateMany — gives us the exact set to audit. Cheap (PK lookup,
  // bulk publishes top out around 100 rows per call).
  const eligible = await prisma.payrollEntry.findMany({
    where: { id: { in: ids }, status: sourceStatus },
    select: { id: true, repId: true, projectId: true, amountCents: true, paymentStage: true },
  });

  const result = await prisma.payrollEntry.updateMany({
    where: { id: { in: ids }, status: sourceStatus },
    data: updateData,
  });

  // Per-entry audit of the bulk transition. Forensics ("who moved this
  // entry to Paid?") would otherwise dead-end at the single-entry log,
  // missing the bulk-publish path entirely.
  const action = status === 'Paid' ? 'payroll_bulk_pay' : 'payroll_bulk_publish';
  for (const e of eligible) {
    await logChange({
      actor: { id: actor.id, email: actor.email ?? null },
      action,
      entityType: 'PayrollEntry',
      entityId: e.id,
      before: { status: sourceStatus },
      after: { status, paidAt: status === 'Paid' ? (updateData.paidAt as Date | undefined) ?? null : null },
      detail: {
        repId: e.repId,
        projectId: e.projectId,
        amountCents: e.amountCents,
        paymentStage: e.paymentStage,
        bulk: true,
      },
    });
  }

  // Per-rep notifications. Group eligible entries by repId, send ONE
  // summary email per rep (not one per entry) so a publish covering 10
  // commissions doesn't produce 10 emails. Uses pay_pending or pay_paid
  // depending on the transition. Mandatory chargebacks still flow
  // through their own event when the row was created (POST handler).
  const eventType: 'pay_pending' | 'pay_paid' = status === 'Paid' ? 'pay_paid' : 'pay_pending';
  const byRep = new Map<string, typeof eligible>();
  for (const e of eligible) {
    const arr = byRep.get(e.repId) ?? [];
    arr.push(e);
    byRep.set(e.repId, arr);
  }
  if (byRep.size > 0) {
    const repIds = [...byRep.keys()];
    const projectIds = [...new Set(eligible.map((e) => e.projectId).filter((p): p is string => !!p))];
    const [reps, projects] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: repIds } }, select: { id: true, firstName: true } }),
      projectIds.length
        ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, customerName: true } })
        : Promise.resolve([] as { id: string; customerName: string }[]),
    ]);
    const repFirstName = new Map(reps.map((r) => [r.id, r.firstName]));
    const projectName = new Map(projects.map((p) => [p.id, p.customerName]));
    const myPayUrl = `${process.env.APP_URL || 'https://app.kiloenergies.com'}/dashboard/my-pay`;

    Promise.all(
      [...byRep.entries()].map(([repId, entries]) => {
        const totalCents = entries.reduce((s, e) => s + e.amountCents, 0);
        const totalDollars = (totalCents / 100).toLocaleString('en-US', {
          style: 'currency', currency: 'USD',
        });
        const greeting = repFirstName.get(repId) ?? 'there';
        const verb = status === 'Paid' ? 'has been paid' : 'moved to Pending';
        const heading = status === 'Paid'
          ? `${entries.length === 1 ? 'A commission was' : `${entries.length} commissions were`} sent`
          : `${entries.length === 1 ? 'A commission' : `${entries.length} commissions`} moved to Pending`;
        const itemListHtml = entries.slice(0, 12).map((e) => {
          const proj = (e.projectId && projectName.get(e.projectId)) || '—';
          const amount = (e.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
          return `<li style="margin-bottom:4px;">${escapeHtml(proj)} · ${e.paymentStage} · <strong>${amount}</strong></li>`;
        }).join('');
        const overflowNote = entries.length > 12 ? `<p style="margin:8px 0 0 0;color:#5b6477;font-size:12px;">+ ${entries.length - 12} more</p>` : '';
        return notify({
          type: eventType,
          userId: repId,
          subject: status === 'Paid'
            ? `${entries.length === 1 ? 'Pay sent' : `${entries.length} commissions paid`} — ${totalDollars}`
            : `${entries.length === 1 ? 'Pay moved to Pending' : `${entries.length} commissions pending`} — ${totalDollars}`,
          emailHtml: renderNotificationEmail({
            heading,
            bodyHtml: `
              <p style="margin:0 0 12px 0;">Hi ${escapeHtml(greeting)} — your commission${entries.length === 1 ? '' : 's'} ${verb}. Total: <strong>${totalDollars}</strong>.</p>
              <ul style="margin:0;padding:0 0 0 18px;list-style:disc;font-size:13px;line-height:1.55;">${itemListHtml}</ul>
              ${overflowNote}
            `,
            cta: { label: 'Open My Pay', url: myPayUrl },
            footerNote: `Sent because you have ${eventType === 'pay_paid' ? 'pay-sent' : 'pay-pending'} alerts on. Manage at /dashboard/preferences.`,
          }),
          smsBody: `Kilo: ${entries.length === 1 ? '' : `${entries.length} `}commission${entries.length === 1 ? '' : 's'} ${verb} — ${totalDollars}.`,
          pushBody: `${heading} — ${totalDollars}`,
        });
      }),
    ).catch((err) => {
      logger.error('payroll_notification_fanout_failed', {
        actorId: actor.id,
        eventType,
        repCount: byRep.size,
        ...errorContext(err),
      });
    });
  }

  logger.info('payroll_bulk_transition', {
    actorId: actor.id,
    fromStatus: sourceStatus,
    toStatus: status,
    requestedIds: ids.length,
    updated: result.count,
  });
  return NextResponse.json({ success: true, updated: result.count });
}
