/**
 * POST /api/baselines/bulk-version-create
 *
 * Create new ProductPricingVersion records for many products in a single
 * transaction, each with possibly-different tier values. Replaces the
 * "open the GitBranch icon 9 times to refresh a whole family" workflow.
 *
 * For each product:
 *   1. Close the active version (effectiveTo = effectiveFrom - 1 day),
 *      if one exists.
 *   2. Create a new version with effectiveFrom + label + tiers.
 *
 * Atomic: all closes + creates happen in one Prisma $transaction. A
 * single product's failure rolls back the whole batch.
 *
 * Authorization:
 *   - Admin only (requireAdmin).
 *   - Past-dated effective dates are hard-blocked. Retroactive
 *     overrides require explicit retroactive=true flag + step-up
 *     auth. Even with that, we never re-apply pricing to deals where
 *     commission has already been paid — those carry their original
 *     productPricingVersionId via FK lock.
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

const tierInputSchema = z.object({
  minKW: z.number().finite().min(0).max(1000),
  maxKW: z.number().finite().min(0).max(1000).nullable(),
  closerPerW: z.number().finite().min(0).max(20),
  setterPerW: z.number().finite().min(0).max(20),
  kiloPerW: z.number().finite().min(0).max(20),
  subDealerPerW: z.number().finite().min(0).max(20).nullable().optional(),
});

const productEntrySchema = z.object({
  productId: z.string().min(1),
  tiers: z.array(tierInputSchema).min(1).max(20),
});

const bulkVersionCreateSchema = z.object({
  effectiveFrom: z.string().min(1).max(20),
  label: z.string().min(1).max(50),
  reason: z.string().max(500).optional(),
  /** When true, the requested effectiveFrom may be in the past. Step-up
   *  auth is enforced; the operation is logged with severity='sensitive'.
   *  Default false: past dates rejected with 400. */
  retroactive: z.boolean().optional().default(false),
  products: z.array(productEntrySchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, bulkVersionCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Validate effective date format (YYYY-MM-DD).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveFrom)) {
    return NextResponse.json({ error: 'effectiveFrom must be YYYY-MM-DD' }, { status: 400 });
  }
  const todayISO = new Date().toISOString().split('T')[0];

  // Past-dated effective: hard-block unless retroactive flag is set
  // AND step-up auth succeeds. Retroactive operations get an elevated
  // anomaly event so they're flagged for forensic review later.
  if (body.effectiveFrom < todayISO) {
    if (!body.retroactive) {
      return NextResponse.json(
        {
          error: 'retroactive_effective_date',
          message: `Effective dates in the past require an explicit retroactive flag. Got ${body.effectiveFrom}, today is ${todayISO}.`,
        },
        { status: 400 },
      );
    }
    try { await requireFreshAdmin(600); } catch (r) { return r as NextResponse; }
  }

  // Magnitude guard: bulk versioning > 20 products requires step-up.
  if (body.products.length > 20) {
    try { await requireFreshAdmin(600); } catch (r) { return r as NextResponse; }
  }

  // Resolve the day before effectiveFrom for the prior version's effectiveTo.
  const prevDate = new Date(`${body.effectiveFrom}T00:00:00Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const closePreviousAs = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}-${String(prevDate.getUTCDate()).padStart(2, '0')}`;

  // Sanity-check tiers: refuse the whole batch if any tier would be
  // loss-making (closer <= kilo). Better to fail loud than half-apply.
  for (const [pi, p] of body.products.entries()) {
    for (const [ti, t] of p.tiers.entries()) {
      if (t.closerPerW <= t.kiloPerW) {
        return NextResponse.json(
          {
            error: 'tier_loss_making',
            message: `Product ${pi + 1}, tier ${ti + 1}: closerPerW ($${t.closerPerW}) must be greater than kiloPerW ($${t.kiloPerW}).`,
            productId: p.productId,
            tierIndex: ti,
          },
          { status: 400 },
        );
      }
    }
  }

  // Verify all referenced products exist and are active.
  const productIds = body.products.map((p) => p.productId);
  const productsInDb = await prisma.product.findMany({
    where: { id: { in: productIds }, active: true },
    select: { id: true, name: true, family: true },
  });
  if (productsInDb.length !== productIds.length) {
    const missing = productIds.filter((id) => !productsInDb.find((p) => p.id === id));
    return NextResponse.json(
      { error: 'unknown_products', missingProductIds: missing },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const newVersionsByProductId = new Map<string, { id: string; productId: string; label: string; effectiveFrom: string }>();

      for (const entry of body.products) {
        // Close the active version (effectiveTo: null) for this product.
        await tx.productPricingVersion.updateMany({
          where: { productId: entry.productId, effectiveTo: null },
          data: { effectiveTo: closePreviousAs },
        });

        // Create the new version + tiers.
        const newVersion = await tx.productPricingVersion.create({
          data: {
            productId: entry.productId,
            label: body.label,
            effectiveFrom: body.effectiveFrom,
            effectiveTo: null,
            tiers: {
              create: entry.tiers.map((t) => ({
                minKW: t.minKW,
                maxKW: t.maxKW,
                closerPerW: t.closerPerW,
                setterPerW: t.setterPerW,
                kiloPerW: t.kiloPerW,
                subDealerPerW: t.subDealerPerW ?? null,
              })),
            },
          },
        });
        newVersionsByProductId.set(entry.productId, {
          id: newVersion.id,
          productId: newVersion.productId,
          label: newVersion.label,
          effectiveFrom: newVersion.effectiveFrom,
        });
      }
      return newVersionsByProductId;
    });

    // Audit + anomaly emission. Per-product audit entries for granular
    // history. Single batched anomaly event for the whole operation.
    for (const [productId, version] of created.entries()) {
      const product = productsInDb.find((p) => p.id === productId);
      await logChange({
        actor: { id: actor.id, email: actor.email },
        action: 'bulk_version_create',
        entityType: 'ProductPricingVersion',
        entityId: version.id,
        after: {
          productId,
          productName: product?.name,
          family: product?.family,
          label: body.label,
          effectiveFrom: body.effectiveFrom,
          retroactive: body.retroactive,
        },
      });
    }

    recordAdminAction({
      actorId: actor.id,
      action: 'baseline.version.bulk_create',
      severity: body.retroactive ? 'sensitive' : (body.products.length > 20 ? 'large' : 'normal'),
      target: { productCount: body.products.length, effectiveFrom: body.effectiveFrom, retroactive: body.retroactive },
      reason: body.reason,
    });

    return NextResponse.json({
      success: true,
      effectiveFrom: body.effectiveFrom,
      label: body.label,
      created: Array.from(created.values()),
    }, { status: 201 });
  } catch (err) {
    logger.error('bulk_version_create_failed', {
      actorId: actor.id,
      productCount: body.products.length,
      effectiveFrom: body.effectiveFrom,
      ...errorContext(err),
    });
    return NextResponse.json({ error: 'Bulk version create failed' }, { status: 500 });
  }
}
