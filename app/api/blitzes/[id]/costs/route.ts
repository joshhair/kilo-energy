import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';

// POST /api/blitzes/[id]/costs — Add a cost
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const body = await req.json();

  const { category, amount, date } = body;
  if (!category || typeof category !== 'string') {
    return NextResponse.json({ error: 'category is required' }, { status: 400 });
  }
  if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 });
  }
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 });
  }

  try {
    const cost = await prisma.blitzCost.create({
      data: {
        blitzId,
        category,
        amount,
        description: body.description || '',
        date,
      },
    });
    return NextResponse.json(cost, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create cost' }, { status: 500 });
  }
}

// DELETE /api/blitzes/[id]/costs — Delete a cost
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;
  const costId = req.nextUrl.searchParams.get('costId');
  if (!costId) return NextResponse.json({ error: 'costId required' }, { status: 400 });

  await prisma.blitzCost.delete({ where: { id: costId, blitzId } });
  return NextResponse.json({ success: true });
}
