import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { renamePrepaidOptionSchema } from '../../../../lib/schemas/business';

// PATCH /api/prepaid-options/[id] — Rename a prepaid option (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, renamePrepaidOptionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const option = await prisma.installerPrepaidOption.update({
    where: { id },
    data: { name: body.name },
  });
  return NextResponse.json(option);
}

// DELETE /api/prepaid-options/[id] (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.installerPrepaidOption.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
