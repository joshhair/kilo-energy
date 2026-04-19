import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { logger } from '../../../../lib/logger';

// DELETE /api/product-pricing/[id] — Delete product pricing version (admin only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  // Cascade delete will remove associated tiers automatically
  await prisma.productPricingVersion.delete({ where: { id } });
  logger.info('product_pricing_version_deleted', { versionId: id, actorId: actor.id });
  return NextResponse.json({ ok: true });
}
