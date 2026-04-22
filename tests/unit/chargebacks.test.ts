import { describe, it, expect } from 'vitest';
import { resolveMilestoneStatus, findChargebackForEntry, chargebackStatusLabel } from '@/lib/chargebacks';
import { sumChargebacks, isChargebackEntry } from '@/lib/aggregators';

type Entry = {
  id: string;
  status: 'Draft' | 'Pending' | 'Paid';
  amount: number;
  date: string;
  isChargeback?: boolean;
  chargebackOfId?: string | null;
  projectId?: string | null;
  paymentStage?: string;
  repId?: string;
};

function paid(id: string, amount: number, over: Partial<Entry> = {}): Entry {
  return { id, status: 'Paid', amount, date: '2026-01-01', ...over };
}
function chargeback(id: string, amount: number, ofId: string, over: Partial<Entry> = {}): Entry {
  return { id, status: 'Paid', amount, date: '2026-01-15', isChargeback: true, chargebackOfId: ofId, ...over };
}

describe('resolveMilestoneStatus', () => {
  it('returns "pending" for a missing entry on a live deal', () => {
    expect(resolveMilestoneStatus({ entry: null, allEntries: [], isProjectCancelled: false })).toBe('pending');
  });

  it('returns "wont-pay-out" for a missing entry on a cancelled deal', () => {
    expect(resolveMilestoneStatus({ entry: null, allEntries: [], isProjectCancelled: true })).toBe('wont-pay-out');
  });

  it('returns "pending" for a non-Paid entry on a live deal', () => {
    const entry = { id: 'e1', status: 'Pending', amount: 1000 };
    expect(resolveMilestoneStatus({ entry, allEntries: [], isProjectCancelled: false })).toBe('pending');
  });

  it('returns "wont-pay-out" for a non-Paid entry on a cancelled deal', () => {
    const entry = { id: 'e1', status: 'Draft', amount: 1000 };
    expect(resolveMilestoneStatus({ entry, allEntries: [], isProjectCancelled: true })).toBe('wont-pay-out');
  });

  it('returns "paid" for a Paid entry on a live deal with no chargeback', () => {
    const entry = paid('e1', 1000);
    expect(resolveMilestoneStatus({ entry, allEntries: [entry], isProjectCancelled: false })).toBe('paid');
  });

  it('returns "paid-needs-chargeback" for a Paid entry on a cancelled deal with no chargeback', () => {
    const entry = paid('e1', 1000);
    expect(resolveMilestoneStatus({ entry, allEntries: [entry], isProjectCancelled: true })).toBe('paid-needs-chargeback');
  });

  it('returns "paid-charged-back" when a Paid chargeback is linked', () => {
    const orig = paid('e1', 1000);
    const cb = chargeback('cb1', -1000, 'e1');
    expect(resolveMilestoneStatus({ entry: orig, allEntries: [orig, cb], isProjectCancelled: true })).toBe('paid-charged-back');
  });

  it('returns "paid-chargeback-pending" when a Draft chargeback is linked', () => {
    const orig = paid('e1', 1000);
    const cb: Entry = { id: 'cb1', status: 'Draft', amount: -1000, date: '2026-01-15', isChargeback: true, chargebackOfId: 'e1' };
    expect(resolveMilestoneStatus({ entry: orig, allEntries: [orig, cb], isProjectCancelled: true })).toBe('paid-chargeback-pending');
  });

  it('legacy fallback: negative Paid entry without isChargeback flag is treated as chargeback', () => {
    const orig = paid('e1', 1000);
    const legacyChargeback: Entry = { id: 'cb1', status: 'Paid', amount: -1000, date: '2026-01-15', chargebackOfId: 'e1' /* no isChargeback */ };
    expect(resolveMilestoneStatus({ entry: orig, allEntries: [orig, legacyChargeback], isProjectCancelled: true })).toBe('paid-charged-back');
  });

  it('explicit isChargeback=false overrides legacy heuristic', () => {
    const orig = paid('e1', 1000);
    const notChargeback: Entry = { id: 'cb1', status: 'Paid', amount: -1000, date: '2026-01-15', isChargeback: false, chargebackOfId: 'e1' };
    // chargebackOfId alone isn't enough — isChargebackEntry returns false
    expect(resolveMilestoneStatus({ entry: orig, allEntries: [orig, notChargeback], isProjectCancelled: true })).toBe('paid-needs-chargeback');
  });
});

describe('findChargebackForEntry', () => {
  it('finds a linked chargeback by chargebackOfId', () => {
    const orig = paid('e1', 1000);
    const cb = chargeback('cb1', -1000, 'e1');
    expect(findChargebackForEntry('e1', [orig, cb])).toEqual(cb);
  });

  it('returns null when none exists', () => {
    const orig = paid('e1', 1000);
    expect(findChargebackForEntry('e1', [orig])).toBeNull();
  });

  it('legacy: finds a negative-amount Paid entry linked via chargebackOfId even without isChargeback flag', () => {
    const orig = paid('e1', 1000);
    const legacy: Entry = { id: 'cb1', status: 'Paid', amount: -1000, date: '2026-01-15', chargebackOfId: 'e1' };
    expect(findChargebackForEntry('e1', [orig, legacy])).toEqual(legacy);
  });

  it('does not match a negative entry with no chargebackOfId', () => {
    const orig = paid('e1', 1000);
    const orphan: Entry = { id: 'cb1', status: 'Paid', amount: -1000, date: '2026-01-15' };
    expect(findChargebackForEntry('e1', [orig, orphan])).toBeNull();
  });
});

describe('chargebackStatusLabel', () => {
  it('returns English for every status', () => {
    expect(chargebackStatusLabel('paid')).toBe('Paid');
    expect(chargebackStatusLabel('paid-charged-back')).toBe('Charged back');
    expect(chargebackStatusLabel('paid-chargeback-pending')).toBe('Chargeback pending');
    expect(chargebackStatusLabel('paid-needs-chargeback')).toBe('Paid — chargeback not recorded');
    expect(chargebackStatusLabel('pending')).toBe('Pending');
    expect(chargebackStatusLabel('wont-pay-out')).toBe("Won't pay out — deal cancelled");
  });
});

describe('sumChargebacks aggregator', () => {
  it('sums Paid chargebacks only (explicit flag)', () => {
    const entries: Entry[] = [
      paid('a', 1000, { repId: 'r1' }),
      chargeback('cb', -1000, 'a', { repId: 'r1' }),
      paid('b', 500, { repId: 'r1' }), // positive
    ];
    expect(sumChargebacks(entries, { asOf: '2026-12-31' })).toBe(-1000);
  });

  it('legacy: sums negative Paid entries without isChargeback flag', () => {
    const entries: Entry[] = [
      paid('a', 1000),
      { id: 'cb', status: 'Paid', amount: -1000, date: '2026-01-15' }, // legacy chargeback
    ];
    expect(sumChargebacks(entries, { asOf: '2026-12-31' })).toBe(-1000);
  });

  it('respects asOf date filter', () => {
    const entries: Entry[] = [
      chargeback('cb', -1000, 'a', { date: '2026-06-01' }),
    ];
    expect(sumChargebacks(entries, { asOf: '2026-05-31' })).toBe(0);
    expect(sumChargebacks(entries, { asOf: '2026-06-01' })).toBe(-1000);
  });

  it('respects rep filter', () => {
    const entries: Entry[] = [
      chargeback('cb1', -500, 'a', { repId: 'r1' }),
      chargeback('cb2', -300, 'b', { repId: 'r2' }),
    ];
    expect(sumChargebacks(entries, { asOf: '2026-12-31', repId: 'r1' })).toBe(-500);
  });

  it('ignores Pending/Draft chargebacks (those go through sumPendingChargebacks)', () => {
    const entries: Entry[] = [
      { id: 'cb', status: 'Pending', amount: -1000, date: '2026-01-15', isChargeback: true, chargebackOfId: 'a' },
    ];
    expect(sumChargebacks(entries, { asOf: '2026-12-31' })).toBe(0);
  });
});

describe('isChargebackEntry', () => {
  it('returns true for explicit flag', () => {
    expect(isChargebackEntry({ status: 'Paid', date: '2026-01-01', amount: -500, isChargeback: true })).toBe(true);
  });

  it('returns false for explicit false', () => {
    expect(isChargebackEntry({ status: 'Paid', date: '2026-01-01', amount: -500, isChargeback: false })).toBe(false);
  });

  it('legacy fallback: undefined flag + negative amount', () => {
    expect(isChargebackEntry({ status: 'Paid', date: '2026-01-01', amount: -500 })).toBe(true);
  });

  it('legacy fallback: undefined flag + positive amount', () => {
    expect(isChargebackEntry({ status: 'Paid', date: '2026-01-01', amount: 500 })).toBe(false);
  });
});
