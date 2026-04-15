import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../lib/api-auth';
import { logChange } from '../../../lib/audit';
import { parseJsonBody } from '../../../lib/api-validation';
import { createPayrollSchema, patchPayrollSchema } from '../../../lib/schemas/payroll';

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

  const parsed = await parseJsonBody(req, createPayrollSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.idempotencyKey) {
    const existing = await prisma.payrollEntry.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
      include: { rep: true, project: true },
    });
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }
  }

  const entry = await prisma.payrollEntry.create({
    data: {
      repId: body.repId,
      projectId: body.projectId ?? null,
      amount: body.amount,
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
      amount: entry.amount,
      paymentStage: entry.paymentStage,
      status: entry.status,
    },
  });

  return NextResponse.json(entry, { status: 201 });
}

// PATCH /api/payroll — Bulk update payroll entries (admin only)
export async function PATCH(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, patchPayrollSchema);
  if (!parsed.ok) return parsed.response;
  const { ids, status } = parsed.data;

  // Only allow lawful transitions: Draft → Pending, Pending → Paid.
  const sourceStatusMap: Record<'Pending' | 'Paid', 'Draft' | 'Pending'> = {
    Pending: 'Draft',
    Paid: 'Pending',
  };
  const sourceStatus = sourceStatusMap[status];

  const result = await prisma.payrollEntry.updateMany({
    where: { id: { in: ids }, status: sourceStatus },
    data: { status },
  });
  return NextResponse.json({ success: true, updated: result.count });
}
