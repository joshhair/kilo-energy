import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../lib/api-auth';

// POST /api/payroll — Create a payroll entry (admin or project manager).
//
// Idempotency: if `body.idempotencyKey` is present, check for an existing
// row with that key first. If found, return it instead of inserting again.
// This prevents accidental double-pay from double-clicks, network retries,
// or React StrictMode double-invocations. Clients should generate a fresh
// key per logical submit attempt and reuse it on retry.
export async function POST(req: NextRequest) {
  try { await requireAdminOrPM(); } catch (r) { return r as NextResponse; }
  const body = await req.json();

  if (typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0) {
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
      projectId: body.projectId || null,
      amount: body.amount,
      type: body.type,
      paymentStage: body.paymentStage,
      status: body.status || 'Draft',
      date: body.date,
      notes: body.notes || '',
      idempotencyKey: body.idempotencyKey || null,
    },
    include: { rep: true, project: true },
  });
  return NextResponse.json(entry, { status: 201 });
}

// PATCH /api/payroll — Bulk update payroll entries (admin only)
export async function PATCH(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  // body.ids: string[], body.status: string
  if (body.ids && body.status) {
    const allowedSource: Record<string, string> = { Pending: 'Draft', Paid: 'Pending' };
    const sourceStatus = allowedSource[body.status];
    if (!sourceStatus) {
      return NextResponse.json({ error: 'Invalid target status' }, { status: 400 });
    }
    const result = await prisma.payrollEntry.updateMany({
      where: { id: { in: body.ids }, status: sourceStatus },
      data: { status: body.status },
    });
    return NextResponse.json({ success: true, updated: result.count });
  }
  return NextResponse.json({ error: 'ids and status required' }, { status: 400 });
}
