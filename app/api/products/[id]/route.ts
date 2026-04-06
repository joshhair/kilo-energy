import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';

// PATCH /api/products/[id] — Update product name or replace active version tiers (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  if (body.name !== undefined || body.family !== undefined) {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.family !== undefined) data.family = body.family;
    await prisma.product.update({ where: { id }, data });
  }

  if (Array.isArray(body.tiers)) {
    const activeVersion = await prisma.productPricingVersion.findFirst({
      where: { productId: id, effectiveTo: null },
    });
    if (activeVersion) {
      await prisma.productPricingTier.deleteMany({ where: { versionId: activeVersion.id } });
      await prisma.productPricingTier.createMany({
        data: body.tiers.map((t: { minKW: number; maxKW: number | null; closerPerW: number; setterPerW: number; kiloPerW: number; subDealerPerW?: number }) => ({
          versionId: activeVersion.id,
          minKW: t.minKW,
          maxKW: t.maxKW ?? null,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW,
          kiloPerW: t.kiloPerW,
          subDealerPerW: t.subDealerPerW ?? null,
        })),
      });
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/products/[id] — Delete a product catalog product (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
