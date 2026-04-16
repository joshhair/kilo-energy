/**
 * commission-split.ts — client-side helper for evenly splitting a deal's
 * commission across N co-closers / co-setters.
 *
 * Delegates the hard part to lib/money.ts so the split is cent-exact:
 *   splitEvenly(fromDollars(1000.01), 3) → [33367, 33367, 33367] cents, sum === 100001
 * Then converts back to dollars at the edge.
 *
 * Used by the new-deal form + project detail edit mode when the admin
 * clicks "+ Add co-closer" — the total is re-split across [primary +
 * existing co-closers + the new one].
 */

import { fromDollars, toDollars, splitEvenly } from './money';

/** Split `totalDollars` into `partyCount` cent-exact shares. Index 0 gets
 *  any trailing cent(s) from the remainder. Never returns NaN. */
export function evenSplit(totalDollars: number, partyCount: number): number[] {
  if (!Number.isFinite(totalDollars) || totalDollars === 0) {
    return Array.from({ length: partyCount }, () => 0);
  }
  if (!Number.isInteger(partyCount) || partyCount < 1) {
    throw new Error(`evenSplit: partyCount must be a positive integer, got ${partyCount}`);
  }
  const shares = splitEvenly(fromDollars(totalDollars), partyCount);
  return shares.map(toDollars);
}
