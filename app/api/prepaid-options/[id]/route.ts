import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/prepaid-options/[id] — Rename a prepaid option
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const option = await prisma.installerPrepaidOption.update({
    where: { id },
    data: { name: body.name.trim() },
  });
  return NextResponse.json(option);
}

// DELETE /api/prepaid-options/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.installerPrepaidOption.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
