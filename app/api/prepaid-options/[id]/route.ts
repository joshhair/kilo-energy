import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { renamePrepaidOptionSchema } from '../../../../lib/schemas/business';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';

// PATCH /api/prepaid-options/[id] — Rename a prepaid option (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, renamePrepaidOptionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const before = await prisma.installerPrepaidOption.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const option = await prisma.installerPrepaidOption.update({
    where: { id },
    data: { name: body.name },
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'prepaid_option_update',
    entityType: 'PrepaidOption',
    entityId: option.id,
    before, after: option,
    fields: AUDITED_FIELDS.PrepaidOption,
  });
  return NextResponse.json(option);
}

// DELETE /api/prepaid-options/[id] (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const before = await prisma.installerPrepaidOption.findUnique({ where: { id } });
  await prisma.installerPrepaidOption.delete({ where: { id } });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'prepaid_option_delete',
    entityType: 'PrepaidOption',
    entityId: id,
    detail: before ? { name: before.name, installerId: before.installerId } : { id },
  });
  return NextResponse.json({ success: true });
}
