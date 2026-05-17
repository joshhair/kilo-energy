/**
 * period.test.ts — coverage for lib/period.ts.
 *
 * Locks in the period classification + membership + time-bounds
 * behavior that the mobile dashboard's period-adaptive cards depend
 * on. A `now` injection point on every helper makes these tests
 * deterministic regardless of the wall clock that runs them.
 */

import { describe, it, expect } from 'vitest';
import {
  getPeriodCategory,
  isCurrentPeriod,
  isHistoricalPeriod,
  isAllTime,
  isInPeriod,
  isInPreviousPeriod,
  getPeriodBounds,
  getPeriodDaysRemaining,
  getPeriodLabel,
  type Period,
} from '@/lib/period';

// A fixed reference instant — picked mid-quarter, mid-month, mid-year so
// every period boundary check has both "in" and "out" cases available.
// May 15, 2026 at 12:00 local = month index 4 (May), quarter index 1
// (Apr-Jun), year 2026.
const NOW = new Date(2026, 4, 15, 12, 0, 0);

describe('getPeriodCategory', () => {
  const cases: [Period, ReturnType<typeof getPeriodCategory>][] = [
    ['all', 'all_time'],
    ['this-month', 'current'],
    ['this-quarter', 'current'],
    ['this-year', 'current'],
    ['last-month', 'historical'],
    ['last-year', 'historical'],
  ];
  for (const [period, expected] of cases) {
    it(`${period} → ${expected}`, () => {
      expect(getPeriodCategory(period)).toBe(expected);
    });
  }
});

describe('isCurrentPeriod / isHistoricalPeriod / isAllTime', () => {
  it('every Period belongs to exactly one category', () => {
    const all: Period[] = ['all', 'this-month', 'last-month', 'this-quarter', 'this-year', 'last-year'];
    for (const p of all) {
      const flags = [isCurrentPeriod(p), isHistoricalPeriod(p), isAllTime(p)];
      const trueCount = flags.filter(Boolean).length;
      expect(trueCount, `expected exactly 1 category for ${p}, got ${trueCount}`).toBe(1);
    }
  });
});

describe('isInPeriod', () => {
  it('all → every date passes', () => {
    expect(isInPeriod('2024-01-01', 'all', NOW)).toBe(true);
    expect(isInPeriod('2030-12-31', 'all', NOW)).toBe(true);
    expect(isInPeriod(null, 'all', NOW)).toBe(true);
  });

  it('this-month → only May 2026 dates pass', () => {
    expect(isInPeriod('2026-05-01', 'this-month', NOW)).toBe(true);
    expect(isInPeriod('2026-05-15', 'this-month', NOW)).toBe(true);
    expect(isInPeriod('2026-05-31', 'this-month', NOW)).toBe(true);
    expect(isInPeriod('2026-04-30', 'this-month', NOW)).toBe(false);
    expect(isInPeriod('2026-06-01', 'this-month', NOW)).toBe(false);
    expect(isInPeriod('2025-05-15', 'this-month', NOW)).toBe(false);
  });

  it('last-month → only April 2026 dates pass', () => {
    expect(isInPeriod('2026-04-01', 'last-month', NOW)).toBe(true);
    expect(isInPeriod('2026-04-30', 'last-month', NOW)).toBe(true);
    expect(isInPeriod('2026-03-31', 'last-month', NOW)).toBe(false);
    expect(isInPeriod('2026-05-01', 'last-month', NOW)).toBe(false);
  });

  it('this-quarter (Q2 2026, Apr-Jun) → those three months pass', () => {
    expect(isInPeriod('2026-04-01', 'this-quarter', NOW)).toBe(true);
    expect(isInPeriod('2026-05-15', 'this-quarter', NOW)).toBe(true);
    expect(isInPeriod('2026-06-30', 'this-quarter', NOW)).toBe(true);
    expect(isInPeriod('2026-03-31', 'this-quarter', NOW)).toBe(false);
    expect(isInPeriod('2026-07-01', 'this-quarter', NOW)).toBe(false);
  });

  it('this-year → only 2026 dates pass', () => {
    expect(isInPeriod('2026-01-01', 'this-year', NOW)).toBe(true);
    expect(isInPeriod('2026-12-31', 'this-year', NOW)).toBe(true);
    expect(isInPeriod('2025-12-31', 'this-year', NOW)).toBe(false);
    expect(isInPeriod('2027-01-01', 'this-year', NOW)).toBe(false);
  });

  it('last-year → only 2025 dates pass', () => {
    expect(isInPeriod('2025-01-01', 'last-year', NOW)).toBe(true);
    expect(isInPeriod('2025-12-31', 'last-year', NOW)).toBe(true);
    expect(isInPeriod('2024-12-31', 'last-year', NOW)).toBe(false);
    expect(isInPeriod('2026-01-01', 'last-year', NOW)).toBe(false);
  });

  it('handles year-boundary edge case for last-month when current is January', () => {
    const JAN = new Date(2026, 0, 15, 12, 0, 0);
    // January 2026 → last month is December 2025
    expect(isInPeriod('2025-12-15', 'last-month', JAN)).toBe(true);
    expect(isInPeriod('2025-12-31', 'last-month', JAN)).toBe(true);
    expect(isInPeriod('2026-01-01', 'last-month', JAN)).toBe(false);
    expect(isInPeriod('2025-11-30', 'last-month', JAN)).toBe(false);
  });

  it('handles year-boundary edge case for this-quarter when current is Q1', () => {
    const FEB = new Date(2026, 1, 15, 12, 0, 0);
    // Q1 2026 = Jan-Mar
    expect(isInPeriod('2026-01-15', 'this-quarter', FEB)).toBe(true);
    expect(isInPeriod('2026-03-31', 'this-quarter', FEB)).toBe(true);
    expect(isInPeriod('2025-12-31', 'this-quarter', FEB)).toBe(false);
    expect(isInPeriod('2026-04-01', 'this-quarter', FEB)).toBe(false);
  });
});

describe('isInPreviousPeriod', () => {
  it('this-month previous → last calendar month (April 2026 from May)', () => {
    expect(isInPreviousPeriod('2026-04-15', 'this-month', NOW)).toBe(true);
    expect(isInPreviousPeriod('2026-05-15', 'this-month', NOW)).toBe(false);
    expect(isInPreviousPeriod('2026-03-15', 'this-month', NOW)).toBe(false);
  });

  it('this-quarter previous → Q1 2026 (Jan-Mar) from Q2', () => {
    expect(isInPreviousPeriod('2026-02-15', 'this-quarter', NOW)).toBe(true);
    expect(isInPreviousPeriod('2026-05-15', 'this-quarter', NOW)).toBe(false);
  });

  it('this-year previous → 2025', () => {
    expect(isInPreviousPeriod('2025-06-01', 'this-year', NOW)).toBe(true);
    expect(isInPreviousPeriod('2026-06-01', 'this-year', NOW)).toBe(false);
  });

  it('handles Q1 year-boundary for this-quarter (Q4 of previous year)', () => {
    const FEB = new Date(2026, 1, 15, 12, 0, 0);
    // Q1 2026 → previous quarter is Q4 2025 (Oct-Dec 2025)
    expect(isInPreviousPeriod('2025-11-15', 'this-quarter', FEB)).toBe(true);
    expect(isInPreviousPeriod('2025-09-30', 'this-quarter', FEB)).toBe(false);
    expect(isInPreviousPeriod('2026-01-01', 'this-quarter', FEB)).toBe(false);
  });
});

describe('getPeriodBounds', () => {
  it('all → null (no bounds)', () => {
    expect(getPeriodBounds('all', NOW)).toBeNull();
  });

  it('this-month → May 1 → June 1, 2026', () => {
    const b = getPeriodBounds('this-month', NOW);
    expect(b).not.toBeNull();
    expect(b!.start).toEqual(new Date(2026, 4, 1));
    expect(b!.end).toEqual(new Date(2026, 5, 1));
  });

  it('last-month → April 1 → May 1, 2026', () => {
    const b = getPeriodBounds('last-month', NOW);
    expect(b!.start).toEqual(new Date(2026, 3, 1));
    expect(b!.end).toEqual(new Date(2026, 4, 1));
  });

  it('this-quarter → Apr 1 → Jul 1, 2026 (Q2)', () => {
    const b = getPeriodBounds('this-quarter', NOW);
    expect(b!.start).toEqual(new Date(2026, 3, 1));
    expect(b!.end).toEqual(new Date(2026, 6, 1));
  });

  it('this-year → Jan 1 2026 → Jan 1 2027', () => {
    const b = getPeriodBounds('this-year', NOW);
    expect(b!.start).toEqual(new Date(2026, 0, 1));
    expect(b!.end).toEqual(new Date(2027, 0, 1));
  });

  it('last-year → Jan 1 2025 → Jan 1 2026', () => {
    const b = getPeriodBounds('last-year', NOW);
    expect(b!.start).toEqual(new Date(2025, 0, 1));
    expect(b!.end).toEqual(new Date(2026, 0, 1));
  });
});

describe('getPeriodDaysRemaining', () => {
  it('all → null (no end)', () => {
    expect(getPeriodDaysRemaining('all', NOW)).toBeNull();
  });

  it('this-month from May 15 → ~17 days remaining to June 1', () => {
    const r = getPeriodDaysRemaining('this-month', NOW);
    expect(r).toBeGreaterThan(15);
    expect(r).toBeLessThanOrEqual(17);
  });

  it('last-month → null (period already closed)', () => {
    expect(getPeriodDaysRemaining('last-month', NOW)).toBeNull();
  });

  it('this-year from May 15 → ~231 days remaining to Jan 1 2027', () => {
    const r = getPeriodDaysRemaining('this-year', NOW);
    expect(r).toBeGreaterThan(220);
    expect(r).toBeLessThan(240);
  });

  it('ceilings — even 6 hours remaining returns 1 day', () => {
    // Snap to 6h before the end of this-month
    const lateMay = new Date(2026, 4, 31, 18, 0, 0);
    expect(getPeriodDaysRemaining('this-month', lateMay)).toBe(1);
  });
});

describe('getPeriodLabel', () => {
  it('returns the label from PERIODS', () => {
    // 'all' renders the cash-forecast hero; label is dynamic by year.
    expect(getPeriodLabel('all')).toBe(`${new Date().getFullYear()} Cash`);
    expect(getPeriodLabel('this-month')).toBe('This Month');
    expect(getPeriodLabel('last-month')).toBe('Last Month');
    expect(getPeriodLabel('this-quarter')).toBe('This Quarter');
    expect(getPeriodLabel('this-year')).toBe('This Year');
    expect(getPeriodLabel('last-year')).toBe('Last Year');
  });
});
