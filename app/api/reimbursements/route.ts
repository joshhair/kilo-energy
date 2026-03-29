import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/reimbursements — Create a reimbursement request
export async function POST(req: NextRequest) {
  const body = await req.json();
  const reimbursement = await prisma.reimbursement.create({
    data: {
      repId: body.repId,
      amount: body.amount,
      description: body.description,
      date: body.date,
      status: 'Pending',
      receiptName: body.receiptName || null,
    },
    include: { rep: true },
  });
  return NextResponse.json(reimbursement, { status: 201 });
}
