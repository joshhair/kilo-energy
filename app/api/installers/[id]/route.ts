import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// PATCH /api/installers/[id] — Update installer (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.active !== undefined) data.active = body.active;
  if (body.installPayPct !== undefined) data.installPayPct = body.installPayPct;
  if (body.name !== undefined) data.name = body.name;

  const installer = await prisma.installer.update({ where: { id }, data });
  return NextResponse.json(installer);
}

// DELETE /api/installers/[id] — Delete installer (admin only)
// Blocked if any projects reference this installer — use PATCH active:false to archive instead.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const projectCount = await prisma.project.count({ where: { installerId: id } });
  if (projectCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${projectCount} project(s) reference this installer. Archive it instead.` },
      { status: 409 },
    );
  }
  await prisma.installer.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
