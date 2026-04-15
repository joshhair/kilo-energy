import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '../../../lib/db';
import { requireAuth } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createReimbursementSchema } from '../../../lib/schemas/reimbursement';

// POST /api/reimbursements — Create a reimbursement request
export async function POST(req: NextRequest) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createReimbursementSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const clerkUser = await currentUser();
  if (!clerkUser?.emailAddresses?.[0]?.emailAddress) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = clerkUser.emailAddresses[0].emailAddress;
  const internalUser = await prisma.user.findFirst({ where: { email } });
  if (!internalUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Non-admins can only submit reimbursements for themselves
  if (internalUser.role !== 'admin' && body.repId !== internalUser.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const reimbursement = await prisma.reimbursement.create({
    data: {
      repId: body.repId,
      amount: body.amount,
      description: body.description,
      date: body.date,
      status: 'Pending',
      receiptName: body.receiptName ?? null,
    },
    include: { rep: true },
  });
  return NextResponse.json(reimbursement, { status: 201 });
}
