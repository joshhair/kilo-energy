import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// POST /api/payroll — Create a payroll entry
export async function POST(req: NextRequest) {
  const body = await req.json();
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
    },
    include: { rep: true, project: true },
  });
  return NextResponse.json(entry, { status: 201 });
}

// PATCH /api/payroll — Bulk update payroll entries (e.g., mark multiple as Pending/Paid)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  // body.ids: string[], body.status: string
  if (body.ids && body.status) {
    await prisma.payrollEntry.updateMany({
      where: { id: { in: body.ids } },
      data: { status: body.status },
    });
    return NextResponse.json({ success: true, updated: body.ids.length });
  }
  return NextResponse.json({ error: 'ids and status required' }, { status: 400 });
}
