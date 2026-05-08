import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchInstallerPricingSchema } from '../../../../lib/schemas/pricing';
import { logger } from '../../../../lib/logger';
import { logChange } from '../../../../lib/audit';
import { enforceAdminMutationLimit } from '../../../../lib/rate-limit';

// PATCH /api/installer-pricing/[id] — Update pricing version (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'PATCH /api/installer-pricing/[id]');
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchInstallerPricingSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const data: Record<string, unknown> = {};
  if (body.effectiveTo !== undefined) data.effectiveTo = body.effectiveTo;
  if (body.label !== undefined) data.label = body.label;

  // If updating tiers, delete existing and recreate
  if (body.tiers) {
    await prisma.installerPricingTier.deleteMany({ where: { versionId: id } });
    await prisma.installerPricingTier.createMany({
      data: body.tiers.map((t) => ({
        versionId: id,
        minKW: t.minKW,
        maxKW: t.maxKW ?? null,
        closerPerW: t.closerPerW,
        setterPerW: t.setterPerW ?? null,
        kiloPerW: t.kiloPerW,
        subDealerPerW: t.subDealerPerW ?? null,
      })),
    });
  }

  const version = await prisma.installerPricingVersion.update({
    where: { id },
    data,
    include: { tiers: true },
  });
  logger.info('installer_pricing_version_updated', {
    versionId: id,
    actorId: actor.id,
    fieldsChanged: Object.keys(data),
    tiersReplaced: !!body.tiers,
  });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'installer_pricing_version_update',
    entityType: 'InstallerPricingVersion',
    entityId: id,
    detail: {
      fieldsChanged: Object.keys(data),
      label: version.label,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      tierCount: version.tiers.length,
      tiersReplaced: !!body.tiers,
    },
  });
  return NextResponse.json(version);
}

// DELETE /api/installer-pricing/[id] — Delete pricing version (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'DELETE /api/installer-pricing/[id]');
  if (limited) return limited;

  const before = await prisma.installerPricingVersion.findUnique({
    where: { id },
    include: { tiers: true },
  });
  // Cascade delete will remove associated tiers automatically
  await prisma.installerPricingVersion.delete({ where: { id } });
  logger.info('installer_pricing_version_deleted', { versionId: id, actorId: actor.id });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'installer_pricing_version_delete',
    entityType: 'InstallerPricingVersion',
    entityId: id,
    detail: before
      ? { installerId: before.installerId, label: before.label, effectiveFrom: before.effectiveFrom, tierCount: before.tiers.length }
      : { id },
  });
  return NextResponse.json({ ok: true });
}
