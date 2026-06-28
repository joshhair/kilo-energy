/**
 * commission-rollup.ts — the single source of truth for the admin/internal-PM
 * "Total / Rep / Kilo-Margin" rollup.
 *
 * Three figures, related by:  Rep Commission + Kilo Margin = Total (gross).
 *   - totalCommissionGross = (netPPW − kiloPerW) × kW × 1000  — the gross pool
 *     Kilo receives from the installer.
 *   - repCommissionTotal   = everything paid out to reps (closer + setter +
 *     co-parties + projected trainer legs).
 *   - kiloMargin           = gross − rep  — what Kilo keeps (derived by
 *     subtraction so the three always reconcile to the cent).
 *
 * This was inlined in deriveProjectCommissionView() (the client view-model) at
 * projects/.../detail/commission-derived.ts:135-137. It is extracted here as a
 * PURE function — no `@/lib/data` import, no cost-basis tables — so that BOTH
 * the client derive AND the server read-path endpoints (/api/data, the blitz
 * GETs) call the same arithmetic. That structurally guarantees server and
 * client agree to the cent, rather than relying on two copies of the formula
 * staying in sync.
 *
 * `kiloPerW` is an INPUT here, resolved by the caller via the server-side
 * resolveBaselines() path. This module never resolves or exposes the rate; it
 * only multiplies it out and returns dollars + integer cents. The cents fields
 * are what cross the wire (admin + internal PM only); the rate never does.
 */

export interface ProjectRollupInputs {
  /** Net price-per-watt sold (the deal's netPPW). */
  netPPW: number;
  /** System size in kW. */
  kWSize: number;
  /** Kilo's cost basis $/W for this deal — resolved server-side by the caller. */
  kiloPerW: number;
  /** Closer's total expected commission across milestones (m1+m2+m3). */
  closerTotalExpected: number;
  /** Setter's total expected commission across milestones (0 when self-gen). */
  setterTotalExpected: number;
  /** Sum of all additional-closer (co-party) commission. */
  coCloserTotal: number;
  /** Sum of all additional-setter (co-party) commission. */
  coSetterTotal: number;
  /** Sum of all projected trainer legs for this deal. */
  trainerTotalExpected: number;
}

export interface ProjectRollup {
  /** dollars (2dp) — the existing client view-model fields. */
  repCommissionTotal: number;
  totalCommissionGross: number;
  kiloMarginAmount: number;
  /** integer cents — the role-gated wire fields (admin + internal PM only). */
  repCommissionTotalCents: number;
  totalCommissionGrossCents: number;
  kiloMarginCents: number;
}

/** Round to 2 decimal places (cents), matching the client's inline rounding. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Dollars → integer cents. Inputs are already 2dp, so this is exact. */
const toCents = (dollars: number): number => Math.round(dollars * 100);

/**
 * Compute the Total / Rep / Kilo-Margin rollup. Mirrors
 * deriveProjectCommissionView():135-137 exactly, then adds integer-cents
 * variants for the API wire. Pure; no side effects, no data access.
 */
export function computeProjectRollup(inputs: ProjectRollupInputs): ProjectRollup {
  const repCommissionTotal = round2(
    inputs.closerTotalExpected +
      inputs.setterTotalExpected +
      inputs.coCloserTotal +
      inputs.coSetterTotal +
      inputs.trainerTotalExpected,
  );
  const totalCommissionGross = round2((inputs.netPPW - inputs.kiloPerW) * inputs.kWSize * 1000);
  const kiloMarginAmount = round2(totalCommissionGross - repCommissionTotal);

  return {
    repCommissionTotal,
    totalCommissionGross,
    kiloMarginAmount,
    repCommissionTotalCents: toCents(repCommissionTotal),
    totalCommissionGrossCents: toCents(totalCommissionGross),
    kiloMarginCents: toCents(kiloMarginAmount),
  };
}
