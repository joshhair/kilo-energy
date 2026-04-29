/**
 * anomaly-detector.ts — Phase 1: structured event emission for admin actions.
 *
 * What this is now:
 *   Every admin write to baseline / pricing data emits a structured
 *   event via the existing logger. Events carry actor, action type,
 *   magnitude, target, timestamp. They land in Vercel logs (and any
 *   attached drain — Sentry / Axiom / etc).
 *
 * What this is NOT yet:
 *   - No alerting. Nothing fires when an event looks unusual.
 *   - No blocking. Nothing refuses an action based on heuristics.
 *   - No baseline. We're collecting data; pattern detection comes later.
 *
 * Why this is enough for production launch:
 *   With 2-3 admins, statistical anomaly detection has bad
 *   signal-to-noise. A workaholic admin editing at 2am isn't
 *   anomalous — it's Tuesday. What you DO want from day one is a
 *   forensic trail: "who changed Goodleap pricing on Tuesday at 2am
 *   and why?" Structured events make that question answerable.
 *
 * Phase 2 (when scale demands it): attach simple heuristics — alert
 * (don't block) on (actor, action) pairs that deviate from a 60-day
 * rolling baseline. Phase 3: heuristics block + require step-up.
 */

import { logger } from './logger';

export interface AdminActionEvent {
  /** ID of the internal user (Prisma User.id) performing the action. */
  actorId: string;
  /** Free-form action identifier — namespaced. e.g. 'baseline.product.create',
   *  'baseline.tier.bulk_adjust', 'baseline.version.create'. */
  action: string;
  /** Optional severity hint: 'normal' for routine ops, 'large' for ops
   *  affecting many rows, 'sensitive' for retroactive / hard-delete. */
  severity?: 'normal' | 'large' | 'sensitive';
  /** What was acted on — installer name, family, product id, etc. Avoid
   *  putting actual tier values here; the logger will redact them but
   *  it's cleaner to omit from the start. */
  target?: Record<string, unknown>;
  /** Optional rough magnitude — count of rows affected, dollar impact,
   *  whatever reads naturally for the action. */
  magnitude?: { rowsAffected?: number; dollarsImpact?: number; tiersAffected?: number };
  /** Optional admin-supplied reason. Useful for forensics later. */
  reason?: string;
}

/**
 * Emit a structured event for an admin action.
 *
 * No-throw: never let an analytics failure block a real operation.
 * If the logger errors, swallow and continue.
 */
export function recordAdminAction(event: AdminActionEvent): void {
  try {
    const enriched = {
      ...event,
      ts: new Date().toISOString(),
      _kind: 'admin_action_event',
    };
    // Logger will scrub any sensitive keys (tier values, etc.) from the
    // payload before serializing. But event consumers should already
    // avoid putting raw tiers in `target` — keep events high-level.
    logger.info(`admin_action: ${event.action}`, enriched);
  } catch {
    // Intentionally swallow. Anomaly logging is observability, not
    // correctness. A logger crash should not abort the actual mutation.
  }
}
