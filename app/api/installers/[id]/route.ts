import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchInstallerSchema } from '../../../../lib/schemas/pricing';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';
import { enforceAdminMutationLimit } from '../../../../lib/rate-limit';

// PATCH /api/installers/[id] — Update installer (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'PATCH /api/installers/[id]');
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchInstallerSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.active !== undefined) data.active = body.active;
  if (body.installPayPct !== undefined) data.installPayPct = body.installPayPct;
  if (body.name !== undefined) data.name = body.name;

  const before = await prisma.installer.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const installer = await prisma.installer.update({ where: { id }, data });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'installer_update',
    entityType: 'Installer',
    entityId: installer.id,
    before, after: installer,
    fields: AUDITED_FIELDS.Installer,
  });
  return NextResponse.json(installer);
}

// DELETE /api/installers/[id] — Delete installer (admin only)
// Blocked if any projects reference this installer — use PATCH active:false to archive instead.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'DELETE /api/installers/[id]');
  if (limited) return limited;

  const projectCount = await prisma.project.count({ where: { installerId: id } });
  if (projectCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${projectCount} project(s) reference this installer. Archive it instead.` },
      { status: 409 },
    );
  }
  const before = await prisma.installer.findUnique({ where: { id } });
  await prisma.installer.delete({ where: { id } });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'installer_delete',
    entityType: 'Installer',
    entityId: id,
    detail: before ? { name: before.name } : { id },
  });
  return NextResponse.json({ success: true });
}
