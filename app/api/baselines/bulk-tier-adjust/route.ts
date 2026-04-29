/**
 * POST /api/baselines/bulk-tier-adjust
 *
 * Apply a tier-level adjustment to many products in a single Prisma
 * transaction. Either all updates land or none do — partial failure is
 * not possible. This replaces the previous "fire N×4 individual PATCH
 * calls in a loop" pattern that left the family in an inconsistent
 * state if the network blipped mid-loop.
 *
 * Operations:
 *   adjust    add/subtract a constant from each closerPerW; setterPerW
 *             auto-derives as closer + 0.10
 *   spread    set closerPerW = kiloPerW + spread for each tier; tiers
 *             can carry different spread values per tier index
 *
 * Authorization:
 *   - Admin only (requireAdmin)
 *   - Above-magnitude operations require step-up auth via
 *     requireFreshAdmin — see MAGNITUDE_THRESHOLDS below.
 *
 * Audit:
 *   - One AuditLog entry per affected ProductPricingVersion (or InstallerPricingVersion).
 *   - Single anomaly-detector event for the whole batch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { requireFreshAdmin } from '../../../../lib/auth-stepup';
import { parseJsonBody } from '../../../../lib/api-validation';
import { logger, errorContext } from '../../../../lib/logger';
import { logChange } from '../../../../lib/audit';
import { recordAdminAction } from '../../../../lib/anomaly-detector';
import { z } from 'zod';

const tierSelectionSchema = z.object({
  productId: z.string().min(1),
  tierIndex: z.number().int().min(0).max(20),
});

const bulkAdjustSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('adjust'),
    selections: z.array(tierSelectionSchema).min(1).max(500),
    adjustment: z.number().finite().min(-10).max(10),
  }),
  z.object({
    operation: z.literal('spread'),
    selections: z.array(tierSelectionSchema).min(1).max(500),
    spreadByTierIndex: z.record(z.string(), z.number().finite().min(0).max(10)),
  }),
  // Restore operation — replays the exact before-state from a previous
  // bulk apply's undoData. Used to implement the 30-second "Undo"
  // toast on the client. Same authorization gating as adjust/spread.
  z.object({
    operation: z.literal('restore'),
    restorePoints: z.array(z.object({
      tierId: z.string().min(1),
      closerPerW: z.number().finite().min(0).max(20),
      setterPerW: z.number().finite().min(0).max(20),
    })).min(1).max(500),
  }),
]);

// Magnitude thresholds for step-up requirements. A bulk op above any of
// these forces the admin to re-authenticate before the change lands.
// Numbers tuned for "small team where mistakes are recoverable but
// expensive to recover from."
const MAGNITUDE_THRESHOLDS = {
  selectionCount: 40, // >40 individual tier changes
  adjustmentMagnitude: 1.0, // ±$1.00/W is a big swing
};

export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, bulkAdjustSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Magnitude guard — step-up auth for large or high-impact ops.
  // Restore ops are exempt (they're an undo, the threshold was already
  // checked when the original bulk apply landed).
  const selectionCount = body.operation === 'restore' ? body.restorePoints.length : body.selections.length;
  const isLarge = body.operation !== 'restore' && selectionCount > MAGNITUDE_THRESHOLDS.selectionCount;
  const isHighSwing = body.operation === 'adjust' && Math.abs(body.adjustment) > MAGNITUDE_THRESHOLDS.adjustmentMagnitude;
  if (isLarge || isHighSwing) {
    try {
      await requireFreshAdmin(600);
    } catch (r) {
      return r as NextResponse;
    }
  }

  // Restore-operation short circuit: skip the per-tier compute / sanity
  // check since we're explicitly setting back to known-good prior values.
  if (body.operation === 'restore') {
    try {
      await prisma.$transaction(
        body.restorePoints.map((rp) => prisma.productPricingTier.update({
          where: { id: rp.tierId },
          data: { closerPerW: rp.closerPerW, setterPerW: rp.setterPerW },
        })),
      );
      for (const rp of body.restorePoints) {
        await logChange({
          actor: { id: actor.id, email: actor.email },
          action: 'bulk_tier_undo',
          entityType: 'ProductPricingVersion',
          entityId: rp.tierId,
          after: { closerPerW: rp.closerPerW, setterPerW: rp.setterPerW },
        });
      }
      recordAdminAction({
        actorId: actor.id,
        action: 'baseline.tier.bulk_undo',
        severity: 'normal',
        target: { tiersRestored: body.restorePoints.length },
      });
      return NextResponse.json({ success: true, restored: body.restorePoints.length });
    } catch (err) {
      logger.error('bulk_tier_restore_failed', { actorId: actor.id, ...errorContext(err) });
      return NextResponse.json({ error: 'Bulk restore failed' }, { status: 500 });
    }
  }

  // Resolve the active pricing version per product. Each affected
  // tier lives within ONE active version per product (ProductPricingVersion
  // with effectiveTo === null). We pull the version row + its tiers
  // upfront so we can apply changes in a single $transaction.
  const productIds = Array.from(new Set(body.selections.map((s) => s.productId)));
  const productsWithVersions = await prisma.product.findMany({
    where: { id: { in: productIds }, active: true },
    include: {
      pricingVersions: {
        where: { effectiveTo: null },
        include: { tiers: { orderBy: { minKW: 'asc' } } },
      },
    },
  });

  if (productsWithVersions.length === 0) {
    return NextResponse.json({ error: 'No matching active products', affected: 0 }, { status: 400 });
  }

  // Build the per-tier update plan. We walk every selection, find its
  // (product, version, tier) target, compute the new value, and stash
  // both the before/after for audit logging.
  type Plan = { tierId: string; productId: string; productName: string; tierIndex: number; before: { closerPerW: number; setterPerW: number; kiloPerW: number }; after: { closerPerW: number; setterPerW: number; kiloPerW: number } };
  const plan: Plan[] = [];
  const skipped: Array<{ productId: string; tierIndex: number; reason: string }> = [];

  for (const sel of body.selections) {
    const product = productsWithVersions.find((p) => p.id === sel.productId);
    if (!product) { skipped.push({ ...sel, reason: 'product not found or archived' }); continue; }
    const version = product.pricingVersions[0];
    if (!version) { skipped.push({ ...sel, reason: 'no active pricing version' }); continue; }
    const tier = version.tiers[sel.tierIndex];
    if (!tier) { skipped.push({ ...sel, reason: 'tier index out of range' }); continue; }

    const before = { closerPerW: tier.closerPerW, setterPerW: tier.setterPerW, kiloPerW: tier.kiloPerW };
    let newCloserPerW: number;
    if (body.operation === 'adjust') {
      newCloserPerW = Math.round((tier.closerPerW + body.adjustment) * 100) / 100;
    } else {
      const spread = body.spreadByTierIndex[String(sel.tierIndex)];
      if (typeof spread !== 'number') { skipped.push({ ...sel, reason: `no spread defined for tier ${sel.tierIndex}` }); continue; }
      newCloserPerW = Math.round((tier.kiloPerW + spread) * 100) / 100;
    }
    if (newCloserPerW <= tier.kiloPerW) {
      skipped.push({ ...sel, reason: `would make closer ($${newCloserPerW}) <= kilo ($${tier.kiloPerW}) — loss-making` });
      continue;
    }
    const newSetterPerW = Math.round((newCloserPerW + 0.10) * 100) / 100;
    plan.push({
      tierId: tier.id,
      productId: product.id,
      productName: product.name,
      tierIndex: sel.tierIndex,
      before,
      after: { closerPerW: newCloserPerW, setterPerW: newSetterPerW, kiloPerW: tier.kiloPerW },
    });
  }

  if (plan.length === 0) {
    return NextResponse.json(
      { error: 'No tiers eligible for update', skipped, affected: 0 },
      { status: 400 },
    );
  }

  try {
    // Single transaction: every tier write or none.
    await prisma.$transaction(
      plan.map((p) => prisma.productPricingTier.update({
        where: { id: p.tierId },
        data: { closerPerW: p.after.closerPerW, setterPerW: p.after.setterPerW },
      })),
    );

    // Per-tier audit (granular history rather than one giant batched
    // entry — answers "what was tier 2 of Q.TRON before the bulk?"
    // long after the fact).
    for (const p of plan) {
      await logChange({
        actor: { id: actor.id, email: actor.email },
        action: 'bulk_tier_adjust',
        entityType: 'ProductPricingVersion',
        entityId: p.tierId,
        before: { tierIndex: p.tierIndex, productName: p.productName, ...p.before },
        after: { tierIndex: p.tierIndex, productName: p.productName, ...p.after },
      });
    }

    recordAdminAction({
      actorId: actor.id,
      action: 'baseline.tier.bulk_adjust',
      severity: isLarge || isHighSwing ? 'large' : 'normal',
      target: { operation: body.operation, productCount: productIds.length },
      magnitude: { tiersAffected: plan.length },
    });

    return NextResponse.json({
      success: true,
      affected: plan.length,
      skipped,
      // Per-tier before/after snapshot the client can use for an in-tab
      // "Undo" — replays the inverse adjustment.
      undoData: plan.map((p) => ({
        tierId: p.tierId,
        productId: p.productId,
        tierIndex: p.tierIndex,
        before: p.before,
      })),
    });
  } catch (err) {
    logger.error('bulk_tier_adjust_failed', {
      actorId: actor.id,
      operation: body.operation,
      selectionCount: body.selections.length,
      ...errorContext(err),
    });
    return NextResponse.json({ error: 'Bulk adjust failed' }, { status: 500 });
  }
}
