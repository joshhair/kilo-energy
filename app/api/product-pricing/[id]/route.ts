import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { logger } from '../../../../lib/logger';
import { logChange } from '../../../../lib/audit';

// DELETE /api/product-pricing/[id] — Delete product pricing version (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const before = await prisma.productPricingVersion.findUnique({
    where: { id },
    include: { tiers: true },
  });
  // Cascade delete will remove associated tiers automatically
  await prisma.productPricingVersion.delete({ where: { id } });
  logger.info('product_pricing_version_deleted', { versionId: id, actorId: actor.id });
  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'product_pricing_version_delete',
    entityType: 'ProductPricingVersion',
    entityId: id,
    detail: before
      ? { productId: before.productId, label: before.label, effectiveFrom: before.effectiveFrom, tierCount: before.tiers.length }
      : { id },
  });
  return NextResponse.json({ ok: true });
}
