import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/incentives/[id] — Update an incentive
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.active !== undefined) data.active = body.active;
  if (body.endDate !== undefined) data.endDate = body.endDate;

  const incentive = await prisma.incentive.update({
    where: { id },
    data,
    include: { milestones: true },
  });
  return NextResponse.json(incentive);
}

// DELETE /api/incentives/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.incentive.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
