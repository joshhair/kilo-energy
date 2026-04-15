import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchReimbursementSchema } from '../../../../lib/schemas/reimbursement';
import { REP_PUBLIC_SELECT } from '../../../../lib/redact';

// PATCH /api/reimbursements/[id] — Update status (admin only — approve/deny)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchReimbursementSchema);
  if (!parsed.ok) return parsed.response;
  const { status } = parsed.data;

  const reimbursement = await prisma.reimbursement.update({
    where: { id },
    data: { status },
    include: { rep: { select: REP_PUBLIC_SELECT } },
  });
  return NextResponse.json(reimbursement);
}
