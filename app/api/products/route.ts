import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createProductSchema } from '../../../lib/schemas/pricing';
import { logger, errorContext } from '../../../lib/logger';
import { recordAdminAction } from '../../../lib/anomaly-detector';
import { logChange } from '../../../lib/audit';

// In-memory idempotency cache. Lives for the duration of the lambda's
// warm window — sufficient for "admin double-clicked Save" within a
// few seconds. For longer-window dedup we'd persist to Redis, but the
// double-click case is the realistic threat.
const IDEMPOTENCY_WINDOW_MS = 60_000;
const recentIdempotencyKeys = new Map<string, { productId: string; expires: number }>();
function rememberIdempotency(key: string, productId: string) {
  recentIdempotencyKeys.set(key, { productId, expires: Date.now() + IDEMPOTENCY_WINDOW_MS });
  // Best-effort cleanup of expired keys to prevent unbounded growth.
  if (recentIdempotencyKeys.size > 200) {
    const now = Date.now();
    for (const [k, v] of recentIdempotencyKeys) {
      if (v.expires < now) recentIdempotencyKeys.delete(k);
    }
  }
}
function lookupIdempotency(key: string): string | null {
  const hit = recentIdempotencyKeys.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    recentIdempotencyKeys.delete(key);
    return null;
  }
  return hit.productId;
}

// POST /api/products — Create a new product (Product Catalog OR SolarTech).
// Admin-only. The product lives in the same table regardless of which
// installer family it belongs to; the SolarTech-vs-PC distinction is just
// the parent installer's name.
export async function POST(req: NextRequest) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createProductSchema);
  if (!parsed.ok) return parsed.response;
  const { installerId, family, name, tiers, effectiveFrom, versionLabel, idempotencyKey, reason } = parsed.data;

  // Idempotency check: if the same key was submitted within the window
  // and produced a product, return that product's id rather than
  // creating a duplicate. Prevents the "admin clicked Save twice fast"
  // double-row problem without persisting state.
  if (idempotencyKey) {
    const existing = lookupIdempotency(`product:${actor.id}:${idempotencyKey}`);
    if (existing) {
      logger.info('product_create_idempotent_replay', {
        actorId: actor.id, productId: existing, idempotencyKey,
      });
      return NextResponse.json({ id: existing, idempotent: true }, { status: 200 });
    }
  }

  // Effective-date validation. Past dates are blocked outright — they
  // would silently rewrite commission for paid deals at the lookup
  // step. Retroactive overrides are a separate flow with two-person
  // approval (PR F).
  const effectiveFromValue = effectiveFrom?.trim() || new Date().toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromValue)) {
    return NextResponse.json(
      { error: 'effectiveFrom must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  const todayISO = new Date().toISOString().split('T')[0];
  if (effectiveFromValue < todayISO) {
    return NextResponse.json(
      {
        error: 'retroactive_effective_date',
        message: `Effective dates in the past are not allowed for new products. Got ${effectiveFromValue}, today is ${todayISO}.`,
      },
      { status: 400 },
    );
  }

  // Sanity-check: tier values must satisfy closer > kilo (otherwise the
  // company is paying out more than the install costs — likely a typo).
  // Returns warnings (non-blocking) for less severe deviations.
  const sanityWarnings: string[] = [];
  if (tiers && tiers.length > 0) {
    for (const [i, t] of tiers.entries()) {
      if (t.closerPerW <= t.kiloPerW) {
        return NextResponse.json(
          {
            error: 'tier_loss_making',
            message: `Tier ${i + 1}: closerPerW ($${t.closerPerW}) must be greater than kiloPerW ($${t.kiloPerW}). This would be a loss-making row — likely a typo.`,
            tierIndex: i,
          },
          { status: 400 },
        );
      }
      if (t.closerPerW > 15) {
        sanityWarnings.push(`Tier ${i + 1}: closerPerW $${t.closerPerW}/W is unusually high — verify before this version goes live.`);
      }
    }
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: { installerId, family, name, active: true },
      });
      if (tiers && tiers.length > 0) {
        await tx.productPricingVersion.create({
          data: {
            productId: created.id,
            label: versionLabel?.trim() || 'v1',
            effectiveFrom: effectiveFromValue,
            effectiveTo: null,
            tiers: {
              create: tiers.map((t) => ({
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
      return created;
    });

    // Audit + anomaly events. logChange is no-throw by design — the
    // product write is the source of truth even if audit fails.
    await logChange({
      actor: { id: actor.id, email: actor.email },
      action: 'create',
      entityType: 'Product',
      entityId: product.id,
      after: { installerId, family, name, effectiveFrom: effectiveFromValue, versionLabel: versionLabel ?? 'v1', reason: reason ?? null },
    });
    recordAdminAction({
      actorId: actor.id,
      action: 'baseline.product.create',
      severity: 'normal',
      target: { installerId, family, productId: product.id },
      reason,
    });

    if (idempotencyKey) {
      rememberIdempotency(`product:${actor.id}:${idempotencyKey}`, product.id);
    }

    return NextResponse.json(
      { id: product.id, warnings: sanityWarnings.length ? sanityWarnings : undefined },
      { status: 201 },
    );
  } catch (err) {
    logger.error('product_create_failed', { actorId: actor.id, installerId, family, ...errorContext(err) });
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
