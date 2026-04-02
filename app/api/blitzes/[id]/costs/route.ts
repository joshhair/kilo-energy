import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/api-auth';

// POST /api/blitzes/[id]/costs — Add a cost
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const body = await req.json();

  const cost = await prisma.blitzCost.create({
    data: {
      blitzId,
      category: body.category,
      amount: body.amount,
      description: body.description || '',
      date: body.date,
    },
  });
  return NextResponse.json(cost, { status: 201 });
}

// DELETE /api/blitzes/[id]/costs — Delete a cost
export async function DELETE(req: NextRequest) {
  try { await requireAuth(); } catch (r) { return r as NextResponse; }
  const costId = req.nextUrl.searchParams.get('costId');
  if (!costId) return NextResponse.json({ error: 'costId required' }, { status: 400 });

  await prisma.blitzCost.delete({ where: { id: costId } });
  return NextResponse.json({ success: true });
}
