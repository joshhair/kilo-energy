/**
 * period.ts — Canonical period model + classification + time-bounds helpers.
 *
 * The dashboard period switcher (mobile + desktop) lets a rep view their
 * stats scoped to: All Time / This Month / Last Month / This Quarter /
 * This Year / Last Year. Different period categories warrant different
 * card content on the dashboard:
 *
 *   - "current" periods (this-month, this-quarter, this-year) are
 *     forward-looking → "on pace" projections make sense
 *   - "historical" periods (last-month, last-year) are backward-looking
 *     → totals + post-mortem context make sense, projections do not
 *   - "all_time" is the lifetime view
 *
 * Previously the dashboard pinned the "On Pace" hero card to all-time
 * data regardless of period — switching to "Last Month" left the big
 * projection number unchanged, which felt broken (the small stats DID
 * update, but the headline didn't). This module is the foundation for
 * making the hero card period-aware.
 *
 * The Period type and `isInPeriod` / `isInPreviousPeriod` helpers live
 * here as the single source of truth. Older imports from
 * `app/dashboard/components/dashboard-utils` continue to work via
 * re-export, but new code should import from this module directly.
 */

// ─── Type ───────────────────────────────────────────────────────────────────

export type Period =
  | 'all'
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'this-year'
  | 'last-year';

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'this-year', label: 'This Year' },
  { value: 'last-year', label: 'Last Year' },
];

// ─── Period category ────────────────────────────────────────────────────────

/**
 * Time-direction classification for a period. Drives which dashboard
 * card variant renders (current = projection-headline; historical =
 * totals-headline; all_time = lifetime-headline).
 */
export type PeriodCategory = 'current' | 'historical' | 'all_time';

export function getPeriodCategory(period: Period): PeriodCategory {
  if (period === 'all') return 'all_time';
  if (period === 'last-month' || period === 'last-year') return 'historical';
  // this-month, this-quarter, this-year
  return 'current';
}

export function isCurrentPeriod(period: Period): boolean {
  return getPeriodCategory(period) === 'current';
}

export function isHistoricalPeriod(period: Period): boolean {
  return getPeriodCategory(period) === 'historical';
}

export function isAllTime(period: Period): boolean {
  return getPeriodCategory(period) === 'all_time';
}

// ─── Period membership (moved from dashboard-utils for single-source) ───────

/**
 * Does the given ISO date (YYYY-MM-DD) fall within `period`?
 *
 * `now` is injectable for testing. In production, leaving it default
 * (Date.now()) is the right move — period semantics are relative to
 * the current wall clock.
 */
export function isInPeriod(
  dateStr: string | null | undefined,
  period: Period,
  now: Date = new Date(),
): boolean {
  if (period === 'all') return true;
  if (!dateStr) return false;
  const [year, month] = dateStr.split('-').map(Number);
  if (period === 'this-month') {
    return month - 1 === now.getMonth() && year === now.getFullYear();
  }
  if (period === 'last-month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return month - 1 === lastMonth.getMonth() && year === lastMonth.getFullYear();
  }
  if (period === 'this-quarter') {
    if (year !== now.getFullYear()) return false;
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const entryQuarter = Math.floor((month - 1) / 3);
    return entryQuarter === currentQuarter;
  }
  if (period === 'this-year') {
    return year === now.getFullYear();
  }
  if (period === 'last-year') {
    return year === now.getFullYear() - 1;
  }
  return true;
}

/**
 * Does the given ISO date (YYYY-MM-DD) fall within the period
 * IMMEDIATELY preceding `period`? Used by TrendBadge to compute
 * period-over-period deltas.
 */
export function isInPreviousPeriod(
  dateStr: string | null | undefined,
  period: Period,
  now: Date = new Date(),
): boolean {
  if (!dateStr) return false;
  const [year, month] = dateStr.split('-').map(Number);
  if (period === 'this-month') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return month - 1 === lastMonth.getMonth() && year === lastMonth.getFullYear();
  }
  if (period === 'last-month') {
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return month - 1 === twoMonthsAgo.getMonth() && year === twoMonthsAgo.getFullYear();
  }
  if (period === 'this-quarter') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const prevQuarterStartMonth = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
    const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const entryQuarter = Math.floor((month - 1) / 3);
    return year === prevQuarterYear && entryQuarter * 3 === prevQuarterStartMonth;
  }
  if (period === 'this-year') {
    return year === now.getFullYear() - 1;
  }
  if (period === 'last-year') {
    return year === now.getFullYear() - 2;
  }
  return false;
}

// ─── Period time bounds + label ─────────────────────────────────────────────

/**
 * Returns the time bounds of the given period as Date objects.
 * `start` is inclusive (00:00:00 local), `end` is exclusive (00:00:00
 * of the day AFTER the period closes). Returns null for 'all'.
 *
 * Used for projection math (days remaining in this period, days
 * elapsed in this period) and for filtering payroll/project rows by
 * full-precision timestamp where the date-string isInPeriod check
 * is too coarse.
 */
export function getPeriodBounds(period: Period, now: Date = new Date()): { start: Date; end: Date } | null {
  if (period === 'all') return null;
  const year = now.getFullYear();
  const month = now.getMonth();
  if (period === 'this-month') {
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
  }
  if (period === 'last-month') {
    return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
  }
  if (period === 'this-quarter') {
    const q = Math.floor(month / 3);
    return { start: new Date(year, q * 3, 1), end: new Date(year, q * 3 + 3, 1) };
  }
  if (period === 'this-year') {
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  if (period === 'last-year') {
    return { start: new Date(year - 1, 0, 1), end: new Date(year, 0, 1) };
  }
  return null;
}

/**
 * Days remaining in the period from `now` until the period's end.
 * Returns null for 'all' (no end) and for historical periods that
 * have already closed (no remaining time). Ceilinged — a period
 * that ends in 6h returns 1, not 0.
 */
export function getPeriodDaysRemaining(period: Period, now: Date = new Date()): number | null {
  const bounds = getPeriodBounds(period, now);
  if (!bounds) return null;
  const msRemaining = bounds.end.getTime() - now.getTime();
  if (msRemaining <= 0) return null;
  return Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
}

/**
 * Human-readable label for a period — used in dashboard hero copy
 * ("Earned · Last Month" etc). Mirrors the labels in `PERIODS` so
 * UI strings stay consistent across the period selector and
 * downstream cards.
 */
export function getPeriodLabel(period: Period): string {
  const entry = PERIODS.find((p) => p.value === period);
  return entry?.label ?? period;
}
