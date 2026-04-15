import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireAdminOrPM } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchPayrollEntrySchema } from '../../../../lib/schemas/pricing';

// PATCH /api/payroll/[id] — Update a single payroll entry (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchPayrollEntrySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const ALLOWED_TRANSITIONS: Record<string, string> = {
    Draft: 'Pending',
    Pending: 'Paid',
  };

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    const current = await prisma.payrollEntry.findUnique({ where: { id }, select: { status: true } });
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (body.status !== current.status) {
      if (ALLOWED_TRANSITIONS[current.status] !== body.status) {
        return NextResponse.json(
          { error: `Invalid transition: ${current.status} → ${body.status}. Allowed: ${current.status} → ${ALLOWED_TRANSITIONS[current.status] ?? '(none)'}` },
          { status: 422 }
        );
      }
    }
    data.status = body.status;
  }
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

  await prisma.payrollEntry.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
