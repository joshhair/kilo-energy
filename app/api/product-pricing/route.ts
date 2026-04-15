import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProductPricingSchema } from '../../../lib/schemas/pricing';

// POST /api/product-pricing — Create a new product pricing version (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

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

  return NextResponse.json(version, { status: 201 });
}
