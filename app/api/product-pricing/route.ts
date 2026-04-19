import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProductPricingSchema } from '../../../lib/schemas/pricing';
import { logChange } from '../../../lib/audit';
import { logger } from '../../../lib/logger';

// POST /api/product-pricing — Create a new product pricing version (admin only)
export async function POST(req: NextRequest) {
  let actor: { id: string; email: string | null };
  try {
    const admin = await requireAdmin();
    actor = { id: admin.id, email: admin.email ?? null };
  } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createProductPricingSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.closePreviousEffectiveTo) {
    await prisma.productPricingVersion.updateMany({
      where: { productId: body.productId, effectiveTo: null },
      data: { effectiveTo: body.closePreviousEffectiveTo },
    });
  }

  const version = await prisma.productPricingVersion.create({
    data: {
      productId: body.productId,
      label: body.label,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      tiers: {
        create: body.tiers.map((t) => ({
          minKW: t.minKW,
          maxKW: t.maxKW ?? null,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW,
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
    action: 'product_pricing_version_create',
    entityType: 'ProductPricingVersion',
    entityId: version.id,
    detail: {
      productId: version.productId,
      label: version.label,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      tierCount: version.tiers.length,
      closedPrevious: !!body.closePreviousEffectiveTo,
    },
  });
  logger.info('product_pricing_version_created', {
    versionId: version.id,
    actorId: actor.id,
    productId: version.productId,
    effectiveFrom: version.effectiveFrom,
    tierCount: version.tiers.length,
  });

  return NextResponse.json(version, { status: 201 });
}
