import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProductSchema } from '../../../lib/schemas/pricing';

// POST /api/products — Create a new product catalog product (admin only)
export async function POST(req: NextRequest) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createProductSchema);
  if (!parsed.ok) return parsed.response;
  const { installerId, family, name, tiers } = parsed.data;

  const product = await prisma.product.create({
    data: { installerId, family, name, active: true },
  });

  if (tiers && tiers.length > 0) {
    await prisma.productPricingVersion.create({
      data: {
        productId: product.id,
        label: 'v1',
        effectiveFrom: new Date().toISOString().split('T')[0],
        effectiveTo: null,
        tiers: {
          create: tiers.map((t) => ({
            minKW: t.minKW,
            maxKW: t.maxKW ?? null,
            closerPerW: t.closerPerW,
            setterPerW: t.setterPerW,
            kiloPerW: t.kiloPerW,
            subDealerPerW: t.subDealerPerW ?? null,
          })),
        },
      },
    });
  }

  return NextResponse.json({ id: product.id }, { status: 201 });
}
