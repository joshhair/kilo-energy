/**
 * commission.ts — commission math for Kilo deals.
 *
 * All arithmetic uses the `Money` utility (lib/money.ts) internally to
 * avoid float drift. Public signatures still return `number` (dollars)
 * so existing call sites don't change.
 *
 * Extracted from lib/data.ts during Phase 7 structure polish — this is
 * the safety-critical code path that computes how much each rep gets
 * paid on every deal, so it lives on its own with its own test suite.
 */

import * as $ from './money';

/** Per-rep breakdown of a deal's commission across milestones. */
export interface CommissionSplit {
  closerTotal: number;
  setterTotal: number;
  closerM1: number;
  closerM2: number;
  closerM3: number;
  setterM1: number;
  setterM2: number;
  setterM3: number;
}

/** Core formula in Money terms: max(0, (soldPPW - baseline) × kW × 1000). */
export function commissionMoney(soldPPW: number, baselinePerW: number, kW: number): $.Money {
  if (!Number.isFinite(soldPPW) || !Number.isFinite(baselinePerW) || !Number.isFinite(kW)) {
    return $.ZERO;
  }
  // Total watts × rate-diff $/W = total dollars. Round to cents ONCE, here.
  const dollars = (soldPPW - baselinePerW) * kW * 1000;
  return $.nonNegative($.fromDollars(dollars));
}

// Commission = (soldPPW - baseline) × kW × 1000
// Returns total commission amount in dollars.
export function calculateCommission(soldPPW: number, baselinePerW: number, kW: number): number {
  return $.toDollars(commissionMoney(soldPPW, baselinePerW, kW));
}

/**
 * Calculates the full closer/setter commission split and M1/M2/M3 milestone breakdown.
 * Pass setterBaselinePerW=0 for self-gen deals (no setter).
 * trainerRate is added on top of setterBaselinePerW before the 50/50 split point.
 *
 * All arithmetic is done in integer cents (`lib/money`). Invariants:
 *  - closerM1 + closerM2 + closerM3 === closerTotal (to the cent)
 *  - setterM1 + setterM2 + setterM3 === setterTotal (to the cent)
 *  - closerHalf + setterHalf === aboveSplit (to the cent, via splitEvenly)
 */
export function splitCloserSetterPay(
  soldPPW: number,
  closerPerW: number,
  setterBaselinePerW: number,
  trainerRate: number,
  kW: number,
  installPayPct: number,
): CommissionSplit {
  const isSelfGen = setterBaselinePerW === 0;

  let closerTotalM: $.Money;
  let setterTotalM: $.Money;
  if (isSelfGen) {
    closerTotalM = commissionMoney(soldPPW, closerPerW, kW);
    setterTotalM = $.ZERO;
  } else {
    // Closer gets paid on the $/W slice between their baseline and the
    // setter baseline (the "differential"), capped by soldPPW.
    const diffPerW = soldPPW > closerPerW
      ? Math.max(0, Math.min(setterBaselinePerW - closerPerW, soldPPW - closerPerW))
      : 0;
    const closerDifferentialM = diffPerW > 0
      ? $.fromDollars(diffPerW * kW * 1000)
      : $.ZERO;

    // Everything above the split point (setter baseline + trainer override)
    // is split 50/50. splitEvenly guarantees the two halves sum to the
    // whole — no 1-cent drift from independent rounding.
    const splitPoint = setterBaselinePerW + trainerRate;
    const aboveSplitM = commissionMoney(soldPPW, splitPoint, kW);
    const [closerHalf, setterHalf] = $.splitEvenly(aboveSplitM, 2);

    closerTotalM = $.add(closerDifferentialM, closerHalf);
    setterTotalM = setterHalf;
  }

  // M1 is a flat upfront amount that counts against the closer's total
  // on self-gen deals, or the setter's total on setter deals.
  const m1FlatM = $.fromDollars(kW >= 5 ? 1000 : 500);
  const closerM1M = isSelfGen ? $.min(m1FlatM, $.nonNegative(closerTotalM)) : $.ZERO;
  const closerRemainderM = $.nonNegative($.sub(closerTotalM, closerM1M));
  const setterM1M = isSelfGen ? $.ZERO : $.min(m1FlatM, $.nonNegative(setterTotalM));
  const setterRemainderM = $.nonNegative($.sub(setterTotalM, setterM1M));

  // M2/M3 split: allocate the remainder by installPayPct / (100-installPayPct).
  // allocate() guarantees m2+m3 === remainder exactly.
  const hasM3 = installPayPct < 100;
  let closerM2M: $.Money;
  let closerM3M: $.Money;
  let setterM2M: $.Money;
  let setterM3M: $.Money;
  if (hasM3) {
    [closerM2M, closerM3M] = $.allocate(closerRemainderM, [installPayPct, 100 - installPayPct]);
    [setterM2M, setterM3M] = $.allocate(setterRemainderM, [installPayPct, 100 - installPayPct]);
  } else {
    closerM2M = closerRemainderM;
    closerM3M = $.ZERO;
    setterM2M = setterRemainderM;
    setterM3M = $.ZERO;
  }

  return {
    closerTotal: $.toDollars(closerTotalM),
    setterTotal: $.toDollars(setterTotalM),
    closerM1: $.toDollars(closerM1M),
    closerM2: $.toDollars(closerM2M),
    closerM3: $.toDollars(closerM3M),
    setterM1: $.toDollars(setterM1M),
    setterM2: $.toDollars(setterM2M),
    setterM3: $.toDollars(setterM3M),
  };
}
