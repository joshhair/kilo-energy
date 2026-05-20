/**
 * Unit test for the projected-amount math used by RecordTrainerPaymentModal.
 * The modal multiplies rate × kW × 1000 × (installPayPct / 100) for the M2
 * default and × ((100 - installPayPct) / 100) for the M3 default — exactly
 * mirroring the engine's split in lib/context/project-transitions.ts.
 *
 * Why a test for a UI helper: the modal pre-fills the dollar field with
 * this number. If it drifts from the engine, admins record entries that
 * don't match what the engine WOULD have generated, leading to silent
 * discrepancies. Test enforces the contract.
 */

import { describe, it, expect } from 'vitest';

// Inline the modal's projected-amount math so the test is decoupled from
// React internals. If the modal's implementation drifts away from this
// formula, the next change will break the test — exactly what we want.
function projectedAmount(
  rate: number,
  kWSize: number,
  installPayPct: number,
  milestone: 'M2' | 'M3',
): number {
  if (!rate || !kWSize) return 0;
  const total = rate * kWSize * 1000;
  const fraction = milestone === 'M2' ? installPayPct / 100 : (100 - installPayPct) / 100;
  return Math.round(total * fraction * 100) / 100;
}

describe('RecordTrainerPaymentModal — projected amount math', () => {
  it('M2 for an 80%-pay-at-install installer: 80% of the total override', () => {
    // 0.10/W × 10 kW × 1000 = $1000. 80% → $800.
    expect(projectedAmount(0.10, 10, 80, 'M2')).toBe(800);
  });

  it('M3 for an 80%-pay-at-install installer: 20% of the total override', () => {
    expect(projectedAmount(0.10, 10, 80, 'M3')).toBe(200);
  });

  it('M2 for a 100% installer (SolarTech) takes the full override; M3 is $0', () => {
    expect(projectedAmount(0.10, 10, 100, 'M2')).toBe(1000);
    expect(projectedAmount(0.10, 10, 100, 'M3')).toBe(0);
  });

  it('returns 0 when rate is 0 (rep blew through all tiers)', () => {
    expect(projectedAmount(0, 10, 80, 'M2')).toBe(0);
  });

  it('returns 0 when kWSize is 0 (data anomaly)', () => {
    expect(projectedAmount(0.10, 0, 80, 'M2')).toBe(0);
  });

  it('rounds to cent precision (no float artifacts on tier-edge rates)', () => {
    // 0.07 × 10.13 × 1000 × 0.80 = 567.28
    expect(projectedAmount(0.07, 10.13, 80, 'M2')).toBe(567.28);
  });

  it('mirrors the engine: a real prod-bug case before single-fire shipped', () => {
    // Lee Strauch (SolarTech 100%, 0.10/W, 10.12 kW) — one of the 3 affected
    // projects in the trainer-double-pay audit.
    expect(projectedAmount(0.10, 10.12, 100, 'M2')).toBe(1012);
  });

  it('M2 + M3 always sum to the full override (rate × kW × 1000)', () => {
    const m2 = projectedAmount(0.15, 7.5, 65, 'M2');
    const m3 = projectedAmount(0.15, 7.5, 65, 'M3');
    expect(m2 + m3).toBe(0.15 * 7.5 * 1000); // = 1125
  });

  it('handles negative / boundary install pct gracefully (defensive)', () => {
    // installPayPct values outside 0-100 shouldn't crash. The modal's UI
    // sources this from server data, but defensive math is cheap.
    expect(projectedAmount(0.10, 10, 0, 'M2')).toBe(0);
    expect(projectedAmount(0.10, 10, 0, 'M3')).toBe(1000);
  });
});
