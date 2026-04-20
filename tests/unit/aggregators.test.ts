import { describe, it, expect } from 'vitest';
import {
  sumPaid,
  sumGrossPaid,
  sumPending,
  sumDraft,
  sumPendingChargebacks,
  countPendingChargebacks,
  type PayrollAggregable,
} from '@/lib/aggregators';

/**
 * These tests pin the canonical semantics so the "dashboard paid-out ≠
 * payroll-tab paid-out" class of bug can't return silently.
 */

const today = '2026-04-19';

const entries: PayrollAggregable[] = [
  { status: 'Paid',    date: '2026-04-01', amount: 1000, type: 'Deal',  repId: 'r1' },
  { status: 'Paid',    date: '2026-04-05', amount: 2000, type: 'Deal',  repId: 'r2' },
  { status: 'Paid',    date: '2026-04-10', amount: 500,  type: 'Bonus', repId: 'r1' },
  { status: 'Paid',    date: '2026-04-12', amount: 300,  type: 'Trainer', repId: 'r3' },
  { status: 'Paid',    date: '2026-04-15', amount: -200, type: 'Deal',  repId: 'r1' }, // chargeback
  { status: 'Paid',    date: '2026-05-01', amount: 900,  type: 'Deal',  repId: 'r1' }, // future-dated
  { status: 'Pending', date: '2026-04-18', amount: 800,  type: 'Deal',  repId: 'r2' },
  { status: 'Draft',   date: '2026-04-18', amount: 400,  type: 'Deal',  repId: 'r3' },
  { status: 'Pending', date: '2026-04-18', amount: -150, type: 'Deal',  repId: 'r1' }, // pending chargeback
  { status: 'Draft',   date: '2026-04-18', amount: -50,  type: 'Deal',  repId: 'r2' }, // draft chargeback
];

describe('sumPaid — canonical net paid-out', () => {
  it('sums paid entries (incl. chargebacks), excludes future-dated', () => {
    // 1000 + 2000 + 500 + 300 + (-200) = 3600. The future-dated 900 is
    // excluded because date > asOf.
    expect(sumPaid(entries, { asOf: today })).toBe(3600);
  });

  it('defaults asOf to today local', () => {
    // Without asOf, we still get a number — the future-date gating is
    // active by default.
    const result = sumPaid(entries);
    expect(typeof result).toBe('number');
  });

  it('respects type filter', () => {
    // Deal only: 1000 + 2000 + (-200) = 2800. Bonus 500 and Trainer 300 excluded.
    expect(sumPaid(entries, { asOf: today, types: ['Deal'] })).toBe(2800);
  });

  it('respects rep filter', () => {
    // r1 only: 1000 + 500 + (-200) = 1300.
    expect(sumPaid(entries, { asOf: today, repId: 'r1' })).toBe(1300);
  });

  it('combined type and rep filter', () => {
    // r1 + Deal: 1000 + (-200) = 800.
    expect(sumPaid(entries, { asOf: today, types: ['Deal'], repId: 'r1' })).toBe(800);
  });
});

describe('sumGrossPaid — excludes chargebacks (monthly-rate use only)', () => {
  it('sums positive Paid amounts only', () => {
    // 1000 + 2000 + 500 + 300 = 3800. The -200 chargeback is excluded.
    expect(sumGrossPaid(entries, { asOf: today })).toBe(3800);
  });

  it('diverges from sumPaid only when chargebacks present', () => {
    const noChargebacks = entries.filter((e) => e.amount > 0);
    expect(sumGrossPaid(noChargebacks, { asOf: today })).toBe(
      sumPaid(noChargebacks, { asOf: today }),
    );
  });
});

describe('sumPending / sumDraft', () => {
  it('pending includes negative (pending chargebacks)', () => {
    // 800 + (-150) = 650.
    expect(sumPending(entries, { asOf: today })).toBe(650);
  });

  it('draft includes negative (draft chargebacks)', () => {
    // 400 + (-50) = 350.
    expect(sumDraft(entries, { asOf: today })).toBe(350);
  });

  it('respects rep filter on pending', () => {
    // r1 pending: -150 only.
    expect(sumPending(entries, { asOf: today, repId: 'r1' })).toBe(-150);
  });
});

describe('sumPendingChargebacks — forward-looking clawback view', () => {
  it('includes Draft + Pending with amount < 0', () => {
    // -150 (Pending) + -50 (Draft) = -200.
    expect(sumPendingChargebacks(entries)).toBe(-200);
  });

  it('excludes already-Paid chargebacks', () => {
    // The -200 Paid chargeback is already deducted in sumPaid — don't
    // double-count it as pending.
    const paidChargebacks = entries.filter((e) => e.status === 'Paid' && e.amount < 0);
    expect(paidChargebacks.length).toBe(1);
    // sumPendingChargebacks should NOT touch these.
    expect(sumPendingChargebacks(entries)).toBe(-200);
  });

  it('excludes positive entries', () => {
    // Only negative amounts count as chargebacks.
    const positiveOnly = entries.filter((e) => e.amount > 0 && (e.status === 'Draft' || e.status === 'Pending'));
    expect(sumPendingChargebacks(positiveOnly)).toBe(0);
  });

  it('counts them', () => {
    expect(countPendingChargebacks(entries)).toBe(2);
  });

  it('INCLUDES future-dated pending chargebacks (regression: tile was going blank)', () => {
    // Pending chargebacks scheduled for a future deduction date ARE
    // "yet to be charged" by definition — they should surface on the
    // tile even though their date is after asOf. The old inline
    // filter on the dashboard had no date clause; the first pass of
    // this helper wrongly inherited the asOf filter from sumPaid and
    // silently dropped these. Paul Tupou's chargeback tile went blank
    // for exactly this reason on 2026-04-19.
    const futureDated: PayrollAggregable[] = [
      { status: 'Pending', date: '2026-05-15', amount: -300, type: 'Deal', repId: 'r1' },
      { status: 'Draft',   date: '2026-06-01', amount: -75,  type: 'Deal', repId: 'r1' },
    ];
    expect(sumPendingChargebacks(futureDated)).toBe(-375);
    expect(countPendingChargebacks(futureDated)).toBe(2);
  });
});

describe('consistency — dashboard aggregator = payroll-tab "All types" total', () => {
  it('sumPaid with no type filter matches sum of per-type sumPaid calls', () => {
    const asOf = today;
    const combined = sumPaid(entries, { asOf });
    const byType =
      sumPaid(entries, { asOf, types: ['Deal'] }) +
      sumPaid(entries, { asOf, types: ['Bonus'] }) +
      sumPaid(entries, { asOf, types: ['Trainer'] });
    expect(combined).toBe(byType);
  });

  it('splitting by rep adds back up to the whole', () => {
    const asOf = today;
    const combined = sumPaid(entries, { asOf });
    const byRep =
      sumPaid(entries, { asOf, repId: 'r1' }) +
      sumPaid(entries, { asOf, repId: 'r2' }) +
      sumPaid(entries, { asOf, repId: 'r3' });
    expect(combined).toBe(byRep);
  });
});
