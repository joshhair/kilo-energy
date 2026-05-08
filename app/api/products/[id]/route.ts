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
    const newVersion = await prisma.productPricingVersion.create({
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
      include: { tiers: true },
    });
    // Tier replacement is commission-affecting — audit the version cut.
    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'product_pricing_version_create',
      entityType: 'ProductPricingVersion',
      entityId: newVersion.id,
      detail: {
        productId: id,
        closedPreviousVersionId: activeVersion?.id ?? null,
        effectiveFrom: today,
        tierCount: newVersion.tiers.length,
        source: 'PATCH /api/products/[id]',
      },
    });
    return NextResponse.json({
      success: true,
      newVersion: {
        id: newVersion.id,
        productId: newVersion.productId,
        label: newVersion.label,
        effectiveFrom: newVersion.effectiveFrom,
        effectiveTo: newVersion.effectiveTo,
        tiers: newVersion.tiers.map((t) => ({
          minKW: t.minKW,
          maxKW: t.maxKW,
          closerPerW: t.closerPerW,
          setterPerW: t.setterPerW,
          kiloPerW: t.kiloPerW,
          subDealerPerW: t.subDealerPerW ?? undefined,
        })),
      },
    });
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
