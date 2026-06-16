import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchProductSchema } from '../../../../lib/schemas/pricing';
import { logChange } from '../../../../lib/audit';
import { recordAdminAction } from '../../../../lib/anomaly-detector';
import { enforceAdminMutationLimit } from '../../../../lib/rate-limit';

// PATCH /api/products/[id] — Update product name or replace active version tiers (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'PATCH /api/products/[id]');
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchProductSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Capture before-state for audit. Cheap (single row by PK).
  const before = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true, family: true },
  });

  if (body.name !== undefined || body.family !== undefined) {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.family !== undefined) data.family = body.family;
    await prisma.product.update({ where: { id }, data });
    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'product_update',
      entityType: 'Product',
      entityId: id,
      before: before ? { name: before.name, family: before.family } : undefined,
      after: { name: body.name ?? before?.name, family: body.family ?? before?.family },
    });
  }

  // STOP-THE-BLEEDING GUARD (2026-06-16, pricing-remediation Phase 1a).
  //
  // This endpoint used to close the active ProductPricingVersion and create a
  // NEW one effective-today on EVERY tier write. The inline Baselines grid
  // called it on every keystroke, which minted 22 versions for one product in
  // ~3 minutes (19 degenerate). Until the draft-then-publish rework (Phase 3)
  // ships, tier/pricing changes through this route are REJECTED — version
  // creation must go through the validated, transactional bulk flow
  // (POST /api/baselines/bulk-version-create). Product metadata (name/family)
  // edits above still work. The inline grid is frozen client-side to match.
  if (body.tiers) {
    return NextResponse.json(
      {
        error: 'pricing_edit_disabled',
        message:
          'Inline tier editing is temporarily disabled while the pricing editor is being reworked. ' +
          'Create a new pricing version via the bulk "Refresh pricing" flow instead.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/products/[id] — Soft-archive a product (admin only).
//
// Sets active=false. Existing projects that reference this product via
// productId continue to resolve historical commission lookups (the row
// stays in the DB; the version chain stays intact). The Baselines UI
// hides archived products from the active tab; an "Archived" tab toggle
// surfaces them with a Restore action (POST /api/products/[id]/restore).
//
// Hard-delete is a separate endpoint with stricter gating — see the
// hard-delete handler below.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const limited = await enforceAdminMutationLimit(actor.id, 'DELETE /api/products/[id]');
  if (limited) return limited;

  const before = await prisma.product.findUnique({
    where: { id },
    select: { id: true, name: true, family: true, installerId: true, active: true },
  });
  if (!before) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  // Cascade analysis — surface project / version counts so the caller
  // can decide. Does not block archive; archive is always safe (the
  // row is preserved). Used by the UI to render the confirmation modal.
  const [projectRefs, pricingVersions] = await Promise.all([
    prisma.project.count({ where: { productId: id } }),
    prisma.productPricingVersion.count({ where: { productId: id } }),
  ]);

  await prisma.product.update({ where: { id }, data: { active: false } });

  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'archive',
    entityType: 'Product',
    entityId: id,
    before: { active: before.active, name: before.name, family: before.family },
    after: { active: false },
  });
  recordAdminAction({
    actorId: actor.id,
    action: 'baseline.product.archive',
    severity: 'normal',
    target: { productId: id, family: before.family, projectRefs, pricingVersions },
  });

  return NextResponse.json({ success: true, archived: true, projectRefs, pricingVersions });
}
