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
import { logger } from '../../../lib/logger';

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

  logger.info('payroll_bulk_transition', {
    actorId: actor.id,
    fromStatus: sourceStatus,
    toStatus: status,
    requestedIds: ids.length,
    updated: result.count,
  });
  return NextResponse.json({ success: true, updated: result.count });
}
