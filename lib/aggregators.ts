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
  /** Optional — explicit chargeback flag (schema Batch 0, 2026-04-21).
   *  When present, isChargeback is the source of truth. When absent
   *  (legacy rows predating the schema change), callers fall back to
   *  the "amount < 0" heuristic for backward compatibility. */
  isChargeback?: boolean;
  paymentStage?: string;
  /** Standalone one-off charge category (equipment_damage, etc.). When
   *  non-null, the entry is a non-milestone charge and consumers should
   *  classify it as type 'Charge' (separate from milestone-attached
   *  chargebacks). The breakdown still rolls the negative amount into
   *  the chargebacks bucket — Charges ARE chargebacks for math purposes. */
  chargeCategory?: string | null;
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
  skipDateFilter = false,
): T[] {
  const asOf = opts?.asOf ?? todayLocal();
  const typeSet = opts?.types ? new Set(opts.types) : null;
  const repId = opts?.repId;
  const out: T[] = [];
  for (const e of entries) {
    if (!statusFilter(e.status)) continue;
    if (!skipDateFilter && e.date > asOf) continue;
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

/** Pending = status 'Pending', respects type + rep filters. Date filter skipped:
 *  milestone entries get future pay dates and must still appear in the total. */
export function sumPending<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Pending', true)
    .reduce((s, e) => s + e.amount, 0);
}

/** Draft = status 'Draft', respects type + rep filters. Date filter skipped:
 *  milestone entries get future pay dates and must still appear in the total. */
export function sumDraft<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Draft', true)
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
    // Chargeback detection: prefer explicit flag (Batch 0+); fall back
    // to "amount < 0" for legacy rows where isChargeback is undefined.
    if (!isChargebackEntry(e)) continue;
    if (typeSet && e.type != null && !typeSet.has(e.type)) continue;
    if (repId && e.repId !== repId) continue;
    out.push(e);
  }
  return out;
}

/**
 * Unified chargeback detection. Explicit flag wins; legacy rows without
 * the flag fall back to the "negative Paid amount" heuristic so reports
 * keep working during/after the schema migration.
 */
export function isChargebackEntry<T extends PayrollAggregable>(e: T): boolean {
  if (e.isChargeback === true) return true;
  if (e.isChargeback === false) return false; // explicitly not a chargeback
  return e.amount < 0; // legacy fallback
}

/**
 * Sum of chargebacks — explicit isChargeback flag preferred, legacy
 * negative-amount heuristic as fallback. Used for reporting when
 * callers want "chargebacks only" as a distinct bucket.
 *
 * Returns a negative number (sum of chargeback amounts).
 */
export function sumChargebacks<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  opts?: PaidOutOptions,
): number {
  return applyCommonFilters(entries, opts, (s) => s === 'Paid')
    .filter(isChargebackEntry)
    .reduce((s, e) => s + e.amount, 0);
}

/**
 * Breakdown of a status bucket (Paid / Pending / Draft) by PayrollEntry
 * type. Single pass, one call site — used by the payroll summary cards
 * that show combined total + per-type sub-line. `chargebacks` is the net
 * of isChargeback entries in the same bucket (negative number) so the UI
 * can surface "Deals $X (−$Y chargebacks)" inline when non-zero.
 */
// ─── Pipeline-added aggregator (historical period dashboards) ──────────────

/**
 * Shape a project needs to expose for `sumAddedToPipeline` to compute
 * a viewer's expected commission. The dashboard's `myProjects` array
 * already matches this shape (Project type from lib/data with the
 * additionalClosers/Setters arrays role-resolved into m1/m2/m3
 * amounts), but defining the contract here keeps this aggregator
 * decoupled from the heavier Project DTO.
 */
export interface PipelineProject {
  soldDate: string; // YYYY-MM-DD
  phase: string;
  // Identity fields are intentionally optional + nullable. The
  // client-side Project type uses `string | undefined` for optional
  // FKs (repId is present, setterId may be omitted), while the Prisma
  // DTO can serialize absent FKs as null. The === comparison against
  // repId resolves "not on this deal" correctly for null, undefined,
  // OR missing field.
  repId?: string | null;
  setterId?: string | null;
  m1Amount?: number | null;
  m2Amount?: number | null;
  m3Amount?: number | null;
  setterM1Amount?: number | null;
  setterM2Amount?: number | null;
  setterM3Amount?: number | null;
  additionalClosers?: ReadonlyArray<{ userId: string; m1Amount: number; m2Amount: number; m3Amount?: number | null }>;
  additionalSetters?: ReadonlyArray<{ userId: string; m1Amount: number; m2Amount: number; m3Amount?: number | null }>;
}

/**
 * Sum the expected commission (M1 + M2 + M3, role-aware) on deals
 * whose `soldDate` falls within the given period AND whose phase
 * is not Cancelled. This is the **"added to pipeline in this
 * period"** metric — the value a rep brought into the pipeline by
 * submitting deals during that window, regardless of whether those
 * deals have paid out yet.
 *
 * Used on the mobile dashboard's historical period cards (Last
 * Month / Last Year) — answers *"what did I produce in that
 * window?"* in a way that's complementary to *"what did I get paid
 * in that window?"* (`sumPaid`):
 *
 *   - `sumPaid(payroll, { asOf: periodEnd })` → cash collected
 *   - `sumAddedToPipeline(projects, repId, period)` → value created
 *
 * Two different stories, both interesting for reps reviewing their
 * historical output.
 *
 * Role resolution follows the same shape as the on-pace calculation
 * (MobileDashboard.tsx:414-422) and the user-detail Expected Pay
 * column: closer → m1+m2+m3, setter → setterM1+M2+M3, co-party →
 * that party row's m1+m2+m3.
 */
export function sumAddedToPipeline(
  projects: ReadonlyArray<PipelineProject>,
  repId: string | null,
  isInPeriodFn: (dateStr: string) => boolean,
): number {
  if (!repId) return 0;
  let total = 0;
  for (const p of projects) {
    if (p.phase === 'Cancelled') continue;
    if (!isInPeriodFn(p.soldDate)) continue;

    // Role-aware commission for this viewer. Mirrors the established
    // resolution logic in commissionHelpers + the dashboard on-pace memo:
    // primary closer → m1+m2+m3; primary setter → setter milestones;
    // co-closer/co-setter → that party row's milestones; not on deal → 0.
    let commission = 0;
    if (p.repId === repId) {
      commission = (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
    } else if (p.setterId === repId) {
      commission = (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
    } else {
      const cc = p.additionalClosers?.find((c) => c.userId === repId);
      if (cc) {
        commission = cc.m1Amount + cc.m2Amount + (cc.m3Amount ?? 0);
      } else {
        const cs = p.additionalSetters?.find((s) => s.userId === repId);
        if (cs) {
          commission = cs.m1Amount + cs.m2Amount + (cs.m3Amount ?? 0);
        }
      }
    }
    total += commission;
  }
  return total;
}

export interface StatusBreakdown {
  total: number;
  deal: number;
  bonus: number;
  trainer: number;
  chargebacks: number;
}

export function breakdownByType<T extends PayrollAggregable>(
  entries: ReadonlyArray<T>,
  status: 'Draft' | 'Pending' | 'Paid',
  opts?: PaidOutOptions,
): StatusBreakdown {
  // Date-filter applies only to Paid (matches sumPaid); Draft/Pending
  // are intentionally date-unbounded so future-dated milestones still
  // show in the total.
  const skipDate = status !== 'Paid';
  const filtered = applyCommonFilters(entries, opts, (s) => s === status, skipDate);
  let total = 0, deal = 0, bonus = 0, trainer = 0, chargebacks = 0;
  for (const e of filtered) {
    total += e.amount;
    if (isChargebackEntry(e)) chargebacks += e.amount;
    else if (e.type === 'Bonus') bonus += e.amount;
    else if (e.paymentStage === 'Trainer') trainer += e.amount;
    else deal += e.amount; // 'Deal' or null/undefined
  }
  return { total, deal, bonus, trainer, chargebacks };
}
