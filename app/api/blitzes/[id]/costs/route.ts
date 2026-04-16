import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { createBlitzCostSchema } from '../../../../../lib/schemas/business';
import { serializeBlitzCost } from '../../../../../lib/serialize';
import { fromDollars } from '../../../../../lib/money';

// POST /api/blitzes/[id]/costs — Add a cost
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id: blitzId } = await params;

  const parsed = await parseJsonBody(req, createBlitzCostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const cost = await prisma.blitzCost.create({
      data: {
        blitzId,
        category: body.category,
        amountCents: fromDollars(body.amount).cents,
        description: body.description ?? '',
        date: body.date,
      },
    });
    return NextResponse.json(serializeBlitzCost(cost), { status: 201 });
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
