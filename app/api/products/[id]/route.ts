import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchProductSchema } from '../../../../lib/schemas/pricing';

// PATCH /api/products/[id] — Update product name or replace active version tiers (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchProductSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.name !== undefined || body.family !== undefined) {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.family !== undefined) data.family = body.family;
    await prisma.product.update({ where: { id }, data });
  }

  if (body.tiers) {
    const today = new Date().toISOString().slice(0, 10);
    const activeVersion = await prisma.productPricingVersion.findFirst({
      where: { productId: id, effectiveTo: null },
    });
    if (activeVersion) {
      await prisma.productPricingVersion.update({
        where: { id: activeVersion.id },
        data: { effectiveTo: today },
      });
    }
    await prisma.productPricingVersion.create({
      data: {
        productId: id,
        label: today,
        effectiveFrom: today,
        effectiveTo: null,
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
    });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/products/[id] — Soft-archive a product (admin only).
// Hard delete is intentionally avoided: existing projects reference this product via
// installerProductId; deleting it would orphan those FKs and break commission recompute.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  await prisma.product.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ success: true });
}
