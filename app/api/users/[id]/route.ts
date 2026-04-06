import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// GET /api/users/[id] — Get a single user (admin only). Contains PII
// (email, phone) and permission flags — not exposed to PMs.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(user);
}

// PATCH /api/users/[id] — Update user permissions (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.canRequestBlitz !== undefined) data.canRequestBlitz = body.canRequestBlitz;
  if (body.canCreateBlitz !== undefined) data.canCreateBlitz = body.canCreateBlitz;
  if (body.canExport !== undefined) data.canExport = body.canExport;
  if (body.canCreateDeals !== undefined) data.canCreateDeals = body.canCreateDeals;
  if (body.canAccessBlitz !== undefined) data.canAccessBlitz = body.canAccessBlitz;

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json(user);
}
