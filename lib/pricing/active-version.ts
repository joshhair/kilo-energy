// Resolve the pricing version effective at a given instant — the single source
// of truth for "which version applies right now" when hydrating baseline tiers
// (/api/data). Phase 3 A0: the prior `?? pricingVersions[0]` fallback could
// return the latest version even when it was FUTURE-dated, leaking unreleased
// rates into live pricing before their effective date. This selects the most-
// recent version whose effectiveFrom is on/before `now` and NEVER a future one.

export interface EffectiveWindow {
  effectiveFrom: string | Date;
  effectiveTo: string | Date | null;
}

/**
 * The version effective at `now`: the one with the greatest effectiveFrom that
 * is still on/before `now`. Returns undefined when nothing is yet effective
 * (e.g. a product whose only versions are future-dated) so callers hydrate
 * empty tiers rather than future rates. Order-independent — does not assume the
 * input is sorted.
 */
export function pickEffectiveVersion<T extends EffectiveWindow>(versions: T[], now: Date): T | undefined {
  let best: T | undefined;
  let bestFrom = -Infinity;
  const nowMs = now.getTime();
  for (const v of versions) {
    const from = new Date(v.effectiveFrom).getTime();
    if (from <= nowMs && from > bestFrom) { best = v; bestFrom = from; }
  }
  return best;
}
