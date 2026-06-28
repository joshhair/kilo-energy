/**
 * trainer-effective.ts — the viewing rep's "effective baseline" $/W.
 *
 * §2 of the server-side-margin migration: per installer & per product, the
 * server adds `effectiveCloserPerW`/`effectiveSetterPerW` = the standard
 * closer/setter $/W PLUS the viewing rep's OWN trainer-override `ratePerW`,
 * resolved at their CURRENT tier. The override is a single value (the rep's
 * current-tier rate, from the any-party union deal count) added to BOTH sides
 * — confirmed by the iOS author: "one count, one override, added to both;
 * different base, same override." Gated by the caller to the rep's OWN
 * assignment (traineeId === viewer); never another rep's.
 *
 * The tier resolution mirrors getTrainerOverrideRate (the same fn the web
 * calculator's closerBaselineDisplay/setterBaselineDisplay repoint to), so
 * server, web, and iOS all show the same number.
 */
import { getTrainerOverrideRate, type TrainerAssignment } from './data';

/**
 * The viewing rep's effective trainer-override $/W at their current tier.
 * `consumedDeals` is the any-party union count the caller computed (deals where
 * the rep was closer OR setter). Returns 0 when they have no trainee assignment.
 */
export function viewerTrainerOverridePerW(
  assignment: TrainerAssignment | null | undefined,
  consumedDeals: number,
): number {
  return assignment ? getTrainerOverrideRate(assignment, consumedDeals) : 0;
}

/**
 * The effective-rate fields to spread into ONE pricing tier for the viewing rep:
 * effectiveCloserPerW/effectiveSetterPerW = base + the same `overridePerW` on both
 * sides (effectiveSetterPerW uses (setterPerW ?? 0) since some installer bands
 * carry no setter rate). Returns {} when overridePerW <= 0 so non-trainees keep
 * the bare base with no effective fields. Usage: `...effectiveRateFields(t, ov)`.
 */
export function effectiveRateFields(
  tier: { closerPerW: number; setterPerW?: number | null },
  overridePerW: number,
): { effectiveCloserPerW: number; effectiveSetterPerW: number } | Record<string, never> {
  if (overridePerW <= 0) return {};
  return {
    effectiveCloserPerW: tier.closerPerW + overridePerW,
    effectiveSetterPerW: (tier.setterPerW ?? 0) + overridePerW,
  };
}
