import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// PATCH /api/installers/[id] — Update installer (active, installPayPct, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.active !== undefined) data.active = body.active;
  if (body.installPayPct !== undefined) data.installPayPct = body.installPayPct;
  if (body.name !== undefined) data.name = body.name;

  const installer = await prisma.installer.update({ where: { id }, data });
  return NextResponse.json(installer);
}

// DELETE /api/installers/[id] — Delete installer and cascade pricing/products
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Cascading deletes are handled by the schema (onDelete: Cascade)
  await prisma.installer.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
