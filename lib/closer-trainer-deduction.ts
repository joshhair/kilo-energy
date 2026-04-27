/**
 * Calculator-local helper that mirrors the server's closer-trainer-override
 * deduction (see `lib/context/project-transitions.ts` ~line 329 for the M2
 * leg and ~line 750 for the M3 leg).
 *
 * The canonical commission split (`splitCloserSetterPay` in `lib/commission.ts`)
 * does NOT take a closer-trainer rate — only a setter-trainer rate. Server
 * payroll handles closer trainer overrides as a post-split deduction when
 * Trainer-stage PayrollEntries are created. The calculator was missing this
 * deduction entirely, so reps with a trainer assignment saw inflated closer
 * pay (e.g. $750 calc vs $250 actual on a deal where Paul takes a $500 cut).
 *
 * This helper does the same arithmetic the server does, in the calculator's
 * own scope. It does NOT modify `splitCloserSetterPay` or any shared math.
 *
 * Rules (must match server):
 *   - Closer trainer total = rate × kW × 1000 (in dollars).
 *   - Total is split across M2/M3 by installPayPct: M2 takes installPayPct%,
 *     M3 takes (100 - installPayPct)%. M1 is never reduced.
 *   - Closer's M2 / M3 / total never go negative (clamp at 0).
 *   - On flat installers (`installPayPct === 100`), the entire deduction
 *     hits M2; M3 stays at 0.
 *   - Setter side of the split is returned unchanged.
 */
import type { CommissionSplit } from './commission';

export function applyCloserTrainerDeduction(
  split: CommissionSplit,
  closerTrainerRate: number,
  kW: number,
  installPayPct: number,
): CommissionSplit {
  if (closerTrainerRate <= 0 || kW <= 0) return split;

  // Work in cents to avoid drift; mirror server's rounding.
  const totalCents = Math.round(closerTrainerRate * kW * 1000 * 100);
  const m2Cents = Math.round(totalCents * (installPayPct / 100));
  const m3Cents = totalCents - m2Cents;

  const closerM2 = Math.max(0, split.closerM2 - m2Cents / 100);
  const closerM3 = Math.max(0, split.closerM3 - m3Cents / 100);
  const closerTotal = split.closerM1 + closerM2 + closerM3;

  return {
    ...split,
    closerM2,
    closerM3,
    closerTotal,
  };
}
