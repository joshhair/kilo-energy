import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../../lib/api-auth';

// PATCH /api/payroll/[id] — Update a single payroll entry (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.amount !== undefined) data.amount = body.amount;
  if (body.date !== undefined) data.date = body.date;
  if (body.notes !== undefined) data.notes = body.notes;

  const entry = await prisma.payrollEntry.update({
    where: { id },
    data,
    include: { rep: true, project: true },
  });
  return NextResponse.json(entry);
}

// DELETE /api/payroll/[id] (admin or PM — PMs need this for phase rollback)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdminOrPM(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.payrollEntry.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
