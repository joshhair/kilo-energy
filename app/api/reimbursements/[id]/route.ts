import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// PATCH /api/reimbursements/[id] — Update status (admin only — approve/deny)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;

  const reimbursement = await prisma.reimbursement.update({
    where: { id },
    data,
    include: { rep: true },
  });
  return NextResponse.json(reimbursement);
}
