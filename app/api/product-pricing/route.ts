import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';

// POST /api/product-pricing — Create a new product pricing version (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const body = await req.json();
  // body: { productId, label, effectiveFrom, closePreviousEffectiveTo?, tiers: [{minKW, maxKW, closerPerW, setterPerW, kiloPerW, subDealerPerW?}] }

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
        create: (body.tiers || []).map((t: { minKW: number; maxKW?: number | null; closerPerW: number; setterPerW: number; kiloPerW: number; subDealerPerW?: number | null }) => ({
          minKW: t.minKW ?? 0,
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
