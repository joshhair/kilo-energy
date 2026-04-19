import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createInstallerPricingSchema } from '../../../lib/schemas/pricing';
import { logChange } from '../../../lib/audit';
import { logger } from '../../../lib/logger';

// POST /api/installer-pricing — Create a new pricing version (admin only)
export async function POST(req: NextRequest) {
  let actor: { id: string; email: string | null };
  try {
    const admin = await requireAdmin();
    actor = { id: admin.id, email: admin.email ?? null };
  } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createInstallerPricingSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // If closing the previous active version
  if (body.closePreviousForInstaller && body.closePreviousEffectiveTo) {
    await prisma.installerPricingVersion.updateMany({
      where: { installerId: body.installerId, effectiveTo: null },
      data: { effectiveTo: body.closePreviousEffectiveTo },
    });
  }

  const version = await prisma.installerPricingVersion.create({
    data: {
      installerId: body.installerId,
      label: body.label,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      rateType: body.rateType,
      tiers: {
        create: body.tiers.map((t) => ({
          minKW: t.minKW,
          maxKW: t.maxKW ?? null,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW ?? null,
          kiloPerW: t.kiloPerW,
          subDealerPerW: t.subDealerPerW ?? null,
        })),
      },
    },
    include: { tiers: true },
  });

  // Commission math depends on this row — always record who created it.
  await logChange({
    actor,
    action: 'installer_pricing_version_create',
    entityType: 'InstallerPricingVersion',
    entityId: version.id,
    detail: {
      installerId: version.installerId,
      label: version.label,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      rateType: version.rateType,
      tierCount: version.tiers.length,
      closedPrevious: !!(body.closePreviousForInstaller && body.closePreviousEffectiveTo),
    },
  });
  logger.info('installer_pricing_version_created', {
    versionId: version.id,
    actorId: actor.id,
    installerId: version.installerId,
    effectiveFrom: version.effectiveFrom,
    tierCount: version.tiers.length,
  });

  return NextResponse.json(version, { status: 201 });
}
