import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// GET /api/users/[id] — Get a single user
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(user);
}

// PATCH /api/users/[id] — Update user permissions (canRequestBlitz, canCreateBlitz, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.canRequestBlitz !== undefined) data.canRequestBlitz = body.canRequestBlitz;
  if (body.canCreateBlitz !== undefined) data.canCreateBlitz = body.canCreateBlitz;

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json(user);
}
