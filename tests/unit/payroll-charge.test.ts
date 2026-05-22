// Tests for standalone one-off charge entries (Phase: 2026-05-21).
//
// Standalone charges sit on the same `pay_chargeback` mandatory-notify
// rails as linked chargebacks, but with no parent entry — they're
// recorded for things like equipment damage, reimbursement clawbacks,
// customer disputes, etc. The aggregator + UI treat them as a fourth
// payment-type kind alongside Deal / Bonus / Trainer.

import { describe, it, expect } from 'vitest';
import {
  createPayrollSchema,
  CHARGE_CATEGORIES,
  CHARGE_CATEGORY_LABELS,
} from '@/lib/schemas/payroll';
import { breakdownByType, sumPaid } from '@/lib/aggregators';

const baseValid = {
  repId: 'cm_rep_1',
  amount: -500,
  type: 'Deal',
  paymentStage: 'Charge',
  date: '2026-05-21',
  status: 'Draft' as const,
  notes: '',
  isChargeback: true,
  chargebackOfId: null,
};

describe('createPayrollSchema — standalone Charge', () => {
  it('accepts a valid standalone charge with chargeCategory', () => {
    const parsed = createPayrollSchema.safeParse({
      ...baseValid,
      chargeCategory: 'equipment_damage',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when both chargebackOfId and chargeCategory are set', () => {
    const parsed = createPayrollSchema.safeParse({
      ...baseValid,
      chargebackOfId: 'cm_linked_entry_1',
      chargeCategory: 'misc',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a chargeback with neither chargebackOfId nor chargeCategory', () => {
    const parsed = createPayrollSchema.safeParse({
      ...baseValid,
      isChargeback: true,
      chargebackOfId: null,
      chargeCategory: null,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a positive-amount standalone charge', () => {
    const parsed = createPayrollSchema.safeParse({
      ...baseValid,
      amount: 500, // positive — invalid for a charge
      chargeCategory: 'misc',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown chargeCategory value', () => {
    const parsed = createPayrollSchema.safeParse({
      ...baseValid,
      chargeCategory: 'unknown_category', // not in CHARGE_CATEGORIES
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a linked chargeback (no chargeCategory)', () => {
    // Regression guard — the new mutual-exclusion rules must not break
    // the original linked-chargeback path.
    const parsed = createPayrollSchema.safeParse({
      ...baseValid,
      chargebackOfId: 'cm_paid_entry_1',
      chargeCategory: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('every CHARGE_CATEGORY has a human-readable label', () => {
    for (const c of CHARGE_CATEGORIES) {
      expect(CHARGE_CATEGORY_LABELS[c]).toBeTruthy();
      expect(CHARGE_CATEGORY_LABELS[c].length).toBeGreaterThan(0);
    }
  });
});

describe('aggregator — standalone Charge entries', () => {
  const today = '2026-05-21';
  const dealPaid = {
    status: 'Paid', date: today, amount: 1000,
    type: 'Deal', paymentStage: 'M1', repId: 'r1',
    isChargeback: false,
  } as const;
  const standaloneCharge = {
    status: 'Paid', date: today, amount: -500,
    type: 'Deal', paymentStage: 'Charge', repId: 'r1',
    isChargeback: true, chargeCategory: 'equipment_damage',
  } as const;

  it('sumPaid subtracts a Paid standalone charge from the YTD total', () => {
    const total = sumPaid([dealPaid, standaloneCharge], { asOf: today });
    expect(total).toBe(500); // 1000 + (-500)
  });

  it('breakdownByType counts standalone charge in chargebacks bucket + reduces deal gross', () => {
    const b = breakdownByType([dealPaid, standaloneCharge], 'Paid', { asOf: today });
    expect(b.total).toBe(500);          // net
    expect(b.deal).toBe(500);           // 1000 + (-500) — charges flow into the deal bucket because they're stored as type='Deal' (same as legacy chargebacks)
    expect(b.chargebacks).toBe(-500);   // the charge itself
    expect(b.bonus).toBe(0);
    expect(b.trainer).toBe(0);
  });

  it('Draft standalone charge is excluded from sumPaid', () => {
    const draftCharge = { ...standaloneCharge, status: 'Draft' as const };
    expect(sumPaid([dealPaid, draftCharge], { asOf: today })).toBe(1000);
  });
});
