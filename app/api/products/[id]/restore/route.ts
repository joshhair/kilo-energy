import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';
import { logChange } from '../../../../../lib/audit';
import { recordAdminAction } from '../../../../../lib/anomaly-detector';

// POST /api/products/[id]/restore — Restore a soft-archived product
// (admin only). Sets active=true so the row reappears in /api/data
// payloads on the next reload.
//
// No additional gating beyond requireAdmin: restoring is reversible
// (just re-archive) and doesn't touch any historical references.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const before = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true, family: true, active: true },
  });
  if (!before) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  if (before.active) return NextResponse.json({ error: 'Product is not archived' }, { status: 400 });

  await prisma.product.update({ where: { id }, data: { active: true } });

  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'restore',
    entityType: 'Product',
    entityId: id,
    before: { active: false, name: before.name, family: before.family },
    after: { active: true },
  });
  recordAdminAction({
    actorId: actor.id,
    action: 'baseline.product.restore',
    severity: 'normal',
    target: { productId: id, family: before.family },
  });

  return NextResponse.json({ success: true, restored: true });
}
