// Shared pricing-version validation — used by BOTH the client draft-then-
// publish editor and the server publish path (Phase 3, A1). Pure functions,
// no IO. Returns { ok, errors } so the editor can show inline messages and the
// server can reject with the same rules.
//
// Two layers:
//   validateTiers(tiers)            — one version's tier grid is well-formed.
//   validateWindowGraph(...)        — publishing a new version yields a valid
//                                     effective-window graph for that product.
//
// Conventions (grounded in real prod data, not assumed):
//   - kW bands are CONTIGUOUS: sorted ascending, each tier.minKW === prior
//     tier.maxKW, the LAST tier is open-ended (maxKW === null). The first
//     tier's minKW is NOT required to be 0 (real Enfin tiers start at 1).
//   - rates are $/W, all > 0; closerPerW > kiloPerW (never loss-making);
//     setterPerW === round(closerPerW + 0.10, 2) (the app's setter convention).
//   - subDealerPerW is null or > 0.

export interface PricingTierInput {
  minKW: number;
  maxKW: number | null;
  closerPerW: number;
  setterPerW: number;
  kiloPerW: number;
  subDealerPerW?: number | null;
}

export interface VersionWindow {
  id: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isFinitePos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Business-local "today" as YYYY-MM-DD. Computed in the company's timezone
 *  (Pacific) regardless of where the code runs — NOT toISOString (UTC, a day
 *  off near midnight) and NOT runtime-local (UTC on Vercel). This is the gate
 *  that makes "future-dated only" mean "after today where the business lives."
 *  Callers may pass a fixed instant and/or timezone for tests. */
export const BUSINESS_TZ = 'America/Los_Angeles';
export function businessToday(now: Date = new Date(), timeZone: string = BUSINESS_TZ): string {
  // en-CA renders as YYYY-MM-DD; timeZone shifts the instant into business-local.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function validateTiers(tiers: PricingTierInput[]): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { ok: false, errors: ['At least one tier is required.'] };
  }
  const sorted = [...tiers].sort((a, b) => a.minKW - b.minKW);

  sorted.forEach((t, i) => {
    const where = `tier ${i + 1} (from ${t.minKW}kW)`;
    if (!Number.isFinite(t.minKW) || t.minKW < 0) errors.push(`${where}: minKW must be ≥ 0.`);
    const isLast = i === sorted.length - 1;
    if (isLast) {
      if (t.maxKW !== null && t.maxKW !== undefined) errors.push(`${where}: the highest tier must be open-ended (no max kW).`);
    } else {
      if (t.maxKW === null || t.maxKW === undefined) errors.push(`${where}: only the highest tier may be open-ended.`);
      else if (t.maxKW <= t.minKW) errors.push(`${where}: max kW must be greater than min kW.`);
    }
    // Contiguity: this tier starts exactly where the previous ended.
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.maxKW === null || prev.maxKW === undefined) errors.push(`${where}: a tier follows an already open-ended tier.`);
      else if (t.minKW !== prev.maxKW) errors.push(`${where}: kW band gap/overlap — starts at ${t.minKW} but previous ends at ${prev.maxKW}.`);
    }
    // Rates.
    if (!isFinitePos(t.closerPerW)) errors.push(`${where}: closer $/W must be > 0.`);
    if (!isFinitePos(t.setterPerW)) errors.push(`${where}: setter $/W must be > 0.`);
    if (!isFinitePos(t.kiloPerW)) errors.push(`${where}: kilo $/W must be > 0.`);
    if (isFinitePos(t.closerPerW) && isFinitePos(t.kiloPerW) && t.closerPerW <= t.kiloPerW) {
      errors.push(`${where}: closer $/W (${t.closerPerW}) must exceed kilo $/W (${t.kiloPerW}) — otherwise loss-making.`);
    }
    if (isFinitePos(t.closerPerW) && isFinitePos(t.setterPerW) && round2(t.setterPerW) !== round2(t.closerPerW + 0.1)) {
      errors.push(`${where}: setter $/W must equal closer + 0.10 (expected ${round2(t.closerPerW + 0.1)}, got ${t.setterPerW}).`);
    }
    if (t.subDealerPerW !== null && t.subDealerPerW !== undefined && !isFinitePos(t.subDealerPerW)) {
      errors.push(`${where}: sub-dealer $/W must be > 0 when set.`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Validate that publishing a new version effective `proposedEffectiveFrom`
 * yields a valid window graph for the product. Models the publish algorithm:
 * the current open version (effectiveTo === null) is closed to the day before
 * the new version, and the new version becomes the sole open one.
 *
 * opts.allowRetroactive=false (Stage A default) requires the new effective
 * date to be strictly AFTER today.
 */
export function validateWindowGraph(
  existing: VersionWindow[],
  proposedEffectiveFrom: string,
  opts: { allowRetroactive?: boolean; today?: string } = {},
): ValidationResult {
  const errors: string[] = [];
  const today = opts.today ?? businessToday();

  if (!ISO_DATE.test(proposedEffectiveFrom)) {
    return { ok: false, errors: [`Effective date must be YYYY-MM-DD (got "${proposedEffectiveFrom}").`] };
  }
  if (!opts.allowRetroactive && proposedEffectiveFrom <= today) {
    errors.push(`Effective date must be after today (${today}). Retroactive pricing is not enabled in this editor.`);
  }
  // No duplicate effectiveFrom.
  if (existing.some((v) => v.effectiveFrom === proposedEffectiveFrom)) {
    errors.push(`A version already starts on ${proposedEffectiveFrom}.`);
  }
  // Simulate the post-publish graph.
  const openVersions = existing.filter((v) => v.effectiveTo === null);
  if (openVersions.length > 1) errors.push(`Data integrity: ${openVersions.length} open versions already exist (expected ≤ 1).`);
  const dayBefore = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const projected = existing.map((v) =>
    v.effectiveTo === null ? { ...v, effectiveTo: dayBefore(proposedEffectiveFrom) } : { ...v },
  );
  projected.push({ id: '__new__', effectiveFrom: proposedEffectiveFrom, effectiveTo: null });

  // Exactly one open version after publish.
  const openAfter = projected.filter((v) => v.effectiveTo === null);
  if (openAfter.length !== 1) errors.push(`Post-publish would leave ${openAfter.length} open versions (expected exactly 1).`);
  // No zero/negative-width closed windows; no overlaps.
  const closed = projected.filter((v) => v.effectiveTo !== null);
  for (const v of closed) {
    if ((v.effectiveTo as string) < v.effectiveFrom) {
      errors.push(`Closing a version to ${v.effectiveTo} before its start ${v.effectiveFrom} — publish too close to the previous version's start.`);
    }
  }
  const sorted = [...projected].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevEnd = prev.effectiveTo ?? '9999-12-31';
    if (cur.effectiveFrom <= prevEnd) {
      errors.push(`Effective windows overlap: ${cur.effectiveFrom} starts on/before previous window ends (${prevEnd}).`);
    }
  }
  return { ok: errors.length === 0, errors };
}
