/**
 * aggregators.ts — Canonical payroll aggregators.
 *
 * ONE place to compute "paid out", "pending", "draft" totals across
 * the app. Previously each surface (dashboard, payroll tab, my-pay,
 * earnings, users/[id], admin dashboards) had its own inline
 * `.filter().reduce()` with slightly different semantics — date
 * comparator direction, chargeback handling, type filter, etc. —
 * which caused the "paid-out on dashboard ≠ paid-out on payroll tab"
 * bug that prompted this helper.
 *
 * # Semantics
 *
 * A PayrollEntry is considered "paid" when:
 *   - `status === 'Paid'`, AND
 *   - `date <= asOf` (default: today local)
 *
 * That second clause is important: an entry can be marked Paid with
 * a future date (pre-staged for the next pay date). Until that date
 * arrives, it is not yet in a real paycheck and shouldn't count toward
 * cumulative paid-out. The old inline aggregators were inconsistent
 * about this; all call sites now go through this helper.
 *
 * # Chargebacks (negative amounts)
 *
 * A chargeback is a negative-amount PayrollEntry. Semantics:
 *   - `sumPaid` (DEFAULT, canonical): includes chargebacks. Net
 *     paid-out. Dashboard tiles and payroll-tab totals use this.
 *   - `sumGrossPaid`: excludes chargebacks (`amount > 0`). Used
 *     only for monthly-rate averaging (My Pay) where we want the
 *     gross earning rate, not the net.
 *
 * Mixing these accidentally is the other mismatch source. The names
 * make the distinction explicit at every call site.
 *
 * # Type filter
 *
 * PayrollEntry.type is one of 'Deal' | 'Bonus' | 'Trainer'.
 *   - Dashboard/my-pay/earnings tiles: no type filter → all types.
 *   - Payroll-tab per-tab totals: filtered to the active tab.
 *   - Payroll-tab combined total (new): no type filter → matches
 *     dashboard, eliminates the "wait why don't these match" bug.
 */

export interface PayrollAggregable {
  status: string;
  date: string;          // YYYY-MM-DD (or ISO-prefixed)
  amount: number;
  type?: string;
  repId?: string;
}

export interface PaidOutOptions {
  /** YYYY-MM-DD cutoff. Entries with date > asOf are excluded. Default: today local. */
  asOf?: string;
  /** Restrict to entries of these types. Default: all types. */
  types?: ReadonlyArray<string>;
  /** Restrict to a single rep's entries. Default: all reps. */
  repId?: string;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function applyCommonFilters<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts: PaidOutOptions | undefined,
  statusFilter: (s: string) => boolean,
): T[] {
  const asOf = opts?.asOf ?? todayLocal();
  const typeSet = opts?.types ? new Set(opts.types) : null;
  const repId = opts?.repId;
  const out: T[] = [];
  for (const e of entries) {
    if (!statusFilter(e.status)) continue;
    if (e.date > asOf) continue;
    if (typeSet && e.type != null && !typeSet.has(e.type)) continue;
    if (repId && e.repId !== repId) continue;
    out.push(e);
  }
  return out;
}

/**
 * Canonical "paid out" total. Sums amounts (including chargebacks) of
 * entries with status='Paid' and date <= asOf.
 *
 * Match this with the payroll-tab's combined total or the dashboard
 * tile and numbers will agree.
 */
export function sumPaid<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Paid')
    .reduce((s, e) => s + e.amount, 0);
}

/**
 * Gross paid-out — excludes chargebacks. Used for monthly-rate
 * averaging where the negative-entry claw-back would distort the
 * "how fast is this rep earning" view. Do NOT use for any cumulative
 * total that the rep or admin compares against payroll tab.
 */
export function sumGrossPaid<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Paid')
    .filter((e) => e.amount > 0)
    .reduce((s, e) => s + e.amount, 0);
}

/** Pending = status 'Pending', date <= asOf, respects type + rep filters. */
export function sumPending<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Pending')
    .reduce((s, e) => s + e.amount, 0);
}

/** Draft = status 'Draft', date <= asOf, respects type + rep filters. */
export function sumDraft<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Draft')
    .reduce((s, e) => s + e.amount, 0);
}

/**
 * Pending chargebacks — entries with status Draft or Pending AND
 * amount < 0. Used by the Chargebacks dashboard tile: shows
 * negative balances still owed back, not yet deducted from a
 * paycheck. Paid chargebacks already flowed through past paycheck
 * history and aren't owed.
 *
 * Importantly: this helper does NOT apply the asOf date filter that
 * sumPaid/sumPending use. A pending chargeback dated in the future
 * is still "yet to be charged back" (by definition — it hasn't been
 * deducted yet). Filtering by date would silently drop scheduled-
 * future chargebacks from the tile, even though those are exactly
 * the things the tile is supposed to surface.
 *
 * Type + rep filters still apply if passed.
 */
export function sumPendingChargebacks<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: Pick<PaidOutOptions, 'types' | 'repId'>,
): number {
  return filterPendingChargebacks(entries, opts).reduce((s, e) => s + e.amount, 0);
}

/**
 * Count of pending chargebacks (for the tile's "N to be charged back" display).
 * Shares the no-date-filter semantic with sumPendingChargebacks.
 */
export function countPendingChargebacks<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: Pick<PaidOutOptions, 'types' | 'repId'>,
): number {
  return filterPendingChargebacks(entries, opts).length;
}

function filterPendingChargebacks<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts: Pick<PaidOutOptions, 'types' | 'repId'> | undefined,
): T[] {
  const typeSet = opts?.types ? new Set(opts.types) : null;
  const repId = opts?.repId;
  const out: T[] = [];
  for (const e of entries) {
    if (e.status !== 'Draft' && e.status !== 'Pending') continue;
    if (e.amount >= 0) continue;
    if (typeSet && e.type != null && !typeSet.has(e.type)) continue;
    if (repId && e.repId !== repId) continue;
    out.push(e);
  }
  return out;
}
