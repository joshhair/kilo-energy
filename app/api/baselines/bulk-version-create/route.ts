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
import { enforceRateLimit } from '../../../../lib/rate-limit';
import { validateTiers, validateWindowGraph, businessToday, type VersionWindow } from '../../../../lib/pricing/validate-version';
import { z } from 'zod';

const asDay = (v: string | Date | null): string | null => (v == null ? null : String(v).slice(0, 10));

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
  /** Client-generated key to dedupe accidental double-submits (the editor sends
   *  one per publish attempt). A second request with the same key returns 409
   *  rather than minting a duplicate batch of versions. */
  idempotencyKey: z.string().min(8).max(100).optional(),
  products: z.array(productEntrySchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  // Bulk version create — bound at 10/min to cap blast radius of a
  // compromised admin token. Above human-pace.
  const limited = await enforceRateLimit(`POST /api/baselines/bulk-version-create:${actor.id}`, 10, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, bulkVersionCreateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Validate effective date format (YYYY-MM-DD).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveFrom)) {
    return NextResponse.json({ error: 'effectiveFrom must be YYYY-MM-DD' }, { status: 400 });
  }
  // Business-local today (Pacific), NOT UTC — the publish boundary must match
  // where the business operates so a "future-dated" publish is genuinely after
  // the current business day everywhere.
  const today = businessToday();

  // Stage A is FUTURE-DATED ONLY: a new version must take effect strictly after
  // today. Same-day and past dates are effectively retroactive (any deal sold
  // earlier re-resolves its rate live until the frozen-version doctrine lands in
  // Stage B), so they require the explicit retroactive flag + step-up auth and
  // are flagged for forensic review.
  if (body.effectiveFrom <= today) {
    if (!body.retroactive) {
      return NextResponse.json(
        {
          error: 'retroactive_effective_date',
          message: `Effective date must be after today (${today}); same-day/past dates require an explicit retroactive flag. Got ${body.effectiveFrom}.`,
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

  // Validate every product's tier grid with the SHARED validator (same rules
  // the editor enforces inline): ≥1 tier, contiguous kW bands, last tier
  // open-ended, rates > 0, closer > kilo (never loss-making), setter = closer +
  // 0.10. Fail the whole batch loud rather than half-apply.
  for (const [pi, p] of body.products.entries()) {
    const v = validateTiers(p.tiers);
    if (!v.ok) {
      return NextResponse.json(
        { error: 'invalid_tiers', productId: p.productId, productIndex: pi, messages: v.errors },
        { status: 400 },
      );
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

  // Window-graph validation: publishing this effectiveFrom over each product's
  // EXISTING versions must yield a valid timeline — exactly one open version,
  // no overlap, no duplicate start, no zero-width closed window. Catches
  // double-publishes and data-integrity problems the per-tier check can't see.
  const existingVersions = await prisma.productPricingVersion.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, productId: true, effectiveFrom: true, effectiveTo: true },
  });
  const versionsByProduct = new Map<string, VersionWindow[]>();
  for (const v of existingVersions) {
    const list = versionsByProduct.get(v.productId) ?? [];
    list.push({ id: v.id, effectiveFrom: asDay(v.effectiveFrom) as string, effectiveTo: asDay(v.effectiveTo) });
    versionsByProduct.set(v.productId, list);
  }
  for (const [pi, p] of body.products.entries()) {
    const w = validateWindowGraph(versionsByProduct.get(p.productId) ?? [], body.effectiveFrom, {
      allowRetroactive: body.retroactive,
      today,
    });
    if (!w.ok) {
      return NextResponse.json(
        { error: 'invalid_window', productId: p.productId, productIndex: pi, messages: w.errors },
        { status: 400 },
      );
    }
  }

  // Idempotency: if a prior batch with this key already succeeded, do not mint a
  // duplicate. Best-effort via the audit trail (durable unique-column guard
  // lands with the gated A1 migration); the 10/min rate limit bounds the race.
  if (body.idempotencyKey) {
    const dup = await prisma.auditLog.findFirst({
      where: { action: 'bulk_version_create', newValue: { contains: `"idempotencyKey":"${body.idempotencyKey}"` } },
      select: { id: true },
    });
    if (dup) {
      return NextResponse.json(
        { error: 'duplicate_request', message: 'A publish with this idempotencyKey already completed.' },
        { status: 409 },
      );
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const newVersionsByProductId = new Map<string, { id: string; productId: string; label: string; effectiveFrom: string }>();

      for (const entry of body.products) {
        // In-transaction concurrency guard: re-check that no version already
        // starts on this effectiveFrom for this product. Write transactions
        // serialize on libSQL, so a concurrent publish that committed first is
        // visible here and we abort rather than mint a duplicate window. (The
        // durable belt-and-suspenders is the gated A1 UNIQUE(productId,
        // effectiveFrom) migration — a ship prerequisite for Stage A.)
        const concurrentDup = await tx.productPricingVersion.findFirst({
          where: { productId: entry.productId, effectiveFrom: body.effectiveFrom },
          select: { id: true },
        });
        if (concurrentDup) throw new Error('CONCURRENT_DUPLICATE_VERSION');

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
          ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
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
    // Concurrency guard tripped (a sibling publish landed the same window first).
    if (err instanceof Error && err.message === 'CONCURRENT_DUPLICATE_VERSION') {
      return NextResponse.json(
        { error: 'duplicate_request', message: 'A version for this effective date was just created — reload and retry.' },
        { status: 409 },
      );
    }
    logger.error('bulk_version_create_failed', {
      actorId: actor.id,
      productCount: body.products.length,
      effectiveFrom: body.effectiveFrom,
      ...errorContext(err),
    });
    return NextResponse.json({ error: 'Bulk version create failed' }, { status: 500 });
  }
}
