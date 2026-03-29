import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/reimbursements/[id] — Update status (approve/deny)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
