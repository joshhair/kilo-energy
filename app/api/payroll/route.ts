import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../lib/api-auth';
import { logChange } from '../../../lib/audit';
import { parseJsonBody } from '../../../lib/api-validation';
import { createPayrollSchema, patchPayrollSchema } from '../../../lib/schemas/payroll';
import { enforceRateLimit } from '../../../lib/rate-limit';
import { REP_PUBLIC_SELECT } from '../../../lib/redact';
import { serializePayrollEntry, dollarsToCents } from '../../../lib/serialize';
import { fromDollars } from '../../../lib/money';

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
    },
    include: { rep: true, project: true },
  });

  await logChange({
    actor: { id: actor.id, email: actor.email ?? null },
    action: 'payroll_create',
    entityType: 'PayrollEntry',
    entityId: entry.id,
    detail: {
      repId: entry.repId,
      projectId: entry.projectId,
      amountCents: entry.amountCents,
      paymentStage: entry.paymentStage,
      status: entry.status,
    },
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

  const result = await prisma.payrollEntry.updateMany({
    where: { id: { in: ids }, status: sourceStatus },
    data: updateData,
  });
  return NextResponse.json({ success: true, updated: result.count });
}
