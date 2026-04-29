import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { renamePrepaidOptionSchema } from '../../../../lib/schemas/business';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';

// PATCH /api/prepaid-options/by-name (admin only)
export async function PATCH(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const installerId = req.nextUrl.searchParams.get('installerId');
  const name = req.nextUrl.searchParams.get('name');
  if (!installerId || !name) return NextResponse.json({ error: 'installerId and name required' }, { status: 400 });

  const parsed = await parseJsonBody(req, renamePrepaidOptionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const existing = await prisma.installerPrepaidOption.findFirst({ where: { installerId, name } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updated = await prisma.installerPrepaidOption.update({
    where: { id: existing.id },
    data: { name: body.name },
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'prepaid_option_update_by_name',
    entityType: 'PrepaidOption',
    entityId: updated.id,
    before: existing, after: updated,
    fields: AUDITED_FIELDS.PrepaidOption,
  });
  return NextResponse.json(updated);
}

// DELETE /api/prepaid-options/by-name (admin only)
export async function DELETE(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const installerId = req.nextUrl.searchParams.get('installerId');
  const name = req.nextUrl.searchParams.get('name');
  if (!installerId || !name) return NextResponse.json({ error: 'installerId and name required' }, { status: 400 });

  const existing = await prisma.installerPrepaidOption.findFirst({ where: { installerId, name } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.installerPrepaidOption.delete({ where: { id: existing.id } });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'prepaid_option_delete_by_name',
    entityType: 'PrepaidOption',
    entityId: existing.id,
    detail: { name: existing.name, installerId: existing.installerId },
  });
  return NextResponse.json({ success: true });
}
