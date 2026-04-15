import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchFinancerSchema } from '../../../../lib/schemas/business';

// PATCH /api/financers/[id] — Update financer (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchFinancerSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const financer = await prisma.financer.update({
    where: { id },
    data: { active: body.active },
  });
  return NextResponse.json(financer);
}

// DELETE /api/financers/[id] — Delete financer (admin only)
// Blocked if any projects reference this financer — use PATCH active:false to archive instead.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const projectCount = await prisma.project.count({ where: { financerId: id } });
  if (projectCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${projectCount} project(s) reference this financer. Archive it instead.` },
      { status: 409 },
    );
  }
  await prisma.financer.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
