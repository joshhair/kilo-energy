import { describe, it, expect } from 'vitest';
import { getM1PayDate, getM2PayDate, formatDate, formatCurrency, fmt$, formatKW, isInDateRange } from '@/lib/utils';

/** Parse YYYY-MM-DD into local date day-of-week (avoids UTC timezone shift). */
function dayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ─── M1 Pay Date Logic ─────────────────────────────────────────────────────
// Cutoff: Sunday 11:59 PM. Paid on the following Friday.

describe('getM1PayDate', () => {
  it('Monday milestone → paid Friday of that same week', () => {
    // Mon 2026-03-30 → next Sunday is Apr 5 → Friday Apr 10
    const payDate = getM1PayDate(new Date(2026, 2, 30)); // Mar 30 is Mon
    expect(payDate).toBe('2026-04-10');
  });

  it('Wednesday milestone → paid Friday of the following week', () => {
    // Wed 2026-04-01 → next Sunday is Apr 5 → Friday Apr 10
    const payDate = getM1PayDate(new Date(2026, 3, 1)); // Apr 1 is Wed
    expect(payDate).toBe('2026-04-10');
  });

  it('Sunday milestone → cutoff is tonight → paid that coming Friday', () => {
    // Sun 2026-04-05 → cutoff is tonight → Friday Apr 10
    const payDate = getM1PayDate(new Date(2026, 3, 5)); // Apr 5 is Sun
    expect(payDate).toBe('2026-04-10');
  });

  it('Friday milestone → paid the following Friday (not same day)', () => {
    // Fri 2026-04-03 → next Sunday is Apr 5 → Friday Apr 10
    const payDate = getM1PayDate(new Date(2026, 3, 3)); // Apr 3 is Fri
    expect(payDate).toBe('2026-04-10');
  });

  it('Saturday milestone → paid the following Friday', () => {
    // Sat 2026-04-04 → next Sunday is Apr 5 → Friday Apr 10
    const payDate = getM1PayDate(new Date(2026, 3, 4)); // Apr 4 is Sat
    expect(payDate).toBe('2026-04-10');
  });

  it('pay date is always a Friday', () => {
    for (let d = 1; d <= 28; d++) {
      const payDate = getM1PayDate(new Date(2026, 2, d));
      const payDay = dayOfWeek(payDate);
      expect(payDay).toBe(5); // Friday
    }
  });
});

// ─── M2 Pay Date Logic ─────────────────────────────────────────────────────
// Cutoff: Saturday 11:59 PM. Paid on the following Friday.

describe('getM2PayDate', () => {
  it('Monday milestone → paid Friday after next Saturday', () => {
    // Mon 2026-03-30 → next Saturday is Apr 4 → Friday Apr 10
    const payDate = getM2PayDate(new Date(2026, 2, 30)); // Mar 30 is Mon
    expect(payDate).toBe('2026-04-10');
  });

  it('Saturday milestone → cutoff is tonight → paid next Friday', () => {
    // Sat 2026-04-04 → cutoff tonight → Friday Apr 10
    const payDate = getM2PayDate(new Date(2026, 3, 4)); // Apr 4 is Sat
    expect(payDate).toBe('2026-04-10');
  });

  it('Sunday milestone → paid Friday after the NEXT Saturday', () => {
    // Sun 2026-04-05 → next Saturday is Apr 11 → Friday Apr 17
    const payDate = getM2PayDate(new Date(2026, 3, 5)); // Apr 5 is Sun
    expect(payDate).toBe('2026-04-17');
  });

  it('Friday milestone → paid Friday after next Saturday', () => {
    // Fri 2026-04-03 → next Saturday is Apr 4 → Friday Apr 10
    const payDate = getM2PayDate(new Date(2026, 3, 3)); // Apr 3 is Fri
    expect(payDate).toBe('2026-04-10');
  });

  it('pay date is always a Friday', () => {
    for (let d = 1; d <= 28; d++) {
      const payDate = getM2PayDate(new Date(2026, 2, d));
      const payDay = dayOfWeek(payDate);
      expect(payDay).toBe(5); // Friday
    }
  });
});

// ─── Formatting Utils ───────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats YYYY-MM-DD to human readable', () => {
    const result = formatDate('2026-03-15');
    expect(result).toBe('Mar 15, 2026');
  });

  it('returns dash for empty string', () => {
    expect(formatDate('')).toBe('—');
  });
});

describe('formatCurrency', () => {
  it('formats whole numbers with dollar sign', () => {
    expect(formatCurrency(1500)).toBe('$1,500');
  });

  it('rounds to nearest dollar', () => {
    expect(formatCurrency(1500.75)).toBe('$1,501');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('fmt$', () => {
  it('formats with Intl currency style', () => {
    const result = fmt$(1500);
    expect(result).toContain('1,500');
  });

  it('handles zero/falsy', () => {
    expect(fmt$(0)).toContain('0');
  });
});

describe('formatKW', () => {
  it('formats with one decimal place', () => {
    expect(formatKW(8.4)).toBe('8.4 kW');
  });

  it('adds trailing zero for whole numbers', () => {
    expect(formatKW(10)).toBe('10.0 kW');
  });
});

describe('isInDateRange', () => {
  it('returns true when date is in range', () => {
    expect(isInDateRange('2026-03-15', '2026-01-01', '2026-12-31')).toBe(true);
  });

  it('returns true when endDate is null (open-ended)', () => {
    expect(isInDateRange('2026-03-15', '2026-01-01', null)).toBe(true);
  });

  it('returns false when date is before start', () => {
    expect(isInDateRange('2025-12-31', '2026-01-01', '2026-12-31')).toBe(false);
  });

  it('returns false when date is after end', () => {
    expect(isInDateRange('2027-01-01', '2026-01-01', '2026-12-31')).toBe(false);
  });

  it('includes boundary dates', () => {
    expect(isInDateRange('2026-01-01', '2026-01-01', '2026-12-31')).toBe(true);
    expect(isInDateRange('2026-12-31', '2026-01-01', '2026-12-31')).toBe(true);
  });
});
