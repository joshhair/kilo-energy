import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchFinancerSchema } from '../../../../lib/schemas/business';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';
import { enforceAdminMutationLimit } from '../../../../lib/rate-limit';

// PATCH /api/financers/[id] — Update financer (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'PATCH /api/financers/[id]');
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchFinancerSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const before = await prisma.financer.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const financer = await prisma.financer.update({
    where: { id },
    data: { active: body.active },
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'financer_update',
    entityType: 'Financer',
    entityId: financer.id,
    before, after: financer,
    fields: AUDITED_FIELDS.Financer,
  });
  return NextResponse.json(financer);
}

// DELETE /api/financers/[id] — Delete financer (admin only)
// Blocked if any projects reference this financer — use PATCH active:false to archive instead.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'DELETE /api/financers/[id]');
  if (limited) return limited;

  const projectCount = await prisma.project.count({ where: { financerId: id } });
  if (projectCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${projectCount} project(s) reference this financer. Archive it instead.` },
      { status: 409 },
    );
  }
  const before = await prisma.financer.findUnique({ where: { id } });
  await prisma.financer.delete({ where: { id } });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'financer_delete',
    entityType: 'Financer',
    entityId: id,
    detail: before ? { name: before.name } : { id },
  });
  return NextResponse.json({ success: true });
}
