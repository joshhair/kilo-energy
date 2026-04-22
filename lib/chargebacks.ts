/**
 * chargebacks.ts — Chargeback status resolution for project detail views.
 *
 * Centralizes the "given a Paid milestone on a cancelled project, what
 * chargeback state is it in?" decision so every render surface (admin
 * Commission Breakdown, rep "My Commission", mobile equivalents) agrees.
 *
 * The explicit isChargeback flag landed in Batch 0 (2026-04-21). Legacy
 * negative-amount Paid entries that predate the migration still resolve
 * correctly because isChargebackEntry() in aggregators.ts falls back
 * to the amount<0 heuristic when the flag is undefined.
 */

import { isChargebackEntry, type PayrollAggregable } from './aggregators';

export type MilestoneChargebackStatus =
  | 'paid'                       // Paid and the deal is not cancelled
  | 'paid-charged-back'          // Paid + a Paid chargeback entry exists linked to it
  | 'paid-chargeback-pending'    // Paid + a Draft/Pending chargeback entry exists
  | 'paid-needs-chargeback'      // Paid on a cancelled deal, NO chargeback entry yet
  | 'pending'                    // Not yet Paid, deal is live
  | 'wont-pay-out';              // Not Paid on a cancelled deal — milestone will never fire

export interface ResolveInput {
  /** The milestone PayrollEntry being rendered (may be absent if never drafted). */
  entry?: { id: string; status: string; isChargeback?: boolean; amount: number } | null;
  /** All payroll entries for this project, so we can find a linked chargeback. */
  allEntries: ReadonlyArray<PayrollAggregable & { id: string; chargebackOfId?: string | null; projectId?: string | null; paymentStage?: string; repId?: string }>;
  /** Whether the project's phase is Cancelled. */
  isProjectCancelled: boolean;
}

/**
 * Resolve the display state for one rep's milestone on a project.
 * Returns a status string that render code maps to a badge + treatment.
 */
export function resolveMilestoneStatus(input: ResolveInput): MilestoneChargebackStatus {
  const { entry, allEntries, isProjectCancelled } = input;

  // Milestone never got drafted (common for M2/M3 on deals cancelled
  // before the phase transition that would generate them).
  if (!entry) {
    return isProjectCancelled ? 'wont-pay-out' : 'pending';
  }

  if (entry.status !== 'Paid') {
    return isProjectCancelled ? 'wont-pay-out' : 'pending';
  }

  // Paid — check for linked chargeback.
  const linked = allEntries.find((e) => e.chargebackOfId === entry.id && isChargebackEntry(e));
  if (linked) {
    return linked.status === 'Paid' ? 'paid-charged-back' : 'paid-chargeback-pending';
  }

  // Paid without a chargeback. On a cancelled deal, flag it as needing one.
  return isProjectCancelled ? 'paid-needs-chargeback' : 'paid';
}

/**
 * Find the chargeback entry linked to a given Paid entry (if any).
 * Used to display the chargeback date/amount inline.
 */
export function findChargebackForEntry<T extends PayrollAggregable & { id: string; chargebackOfId?: string | null }>(
  entryId: string,
  allEntries: ReadonlyArray<T>,
): T | null {
  return allEntries.find((e) => e.chargebackOfId === entryId && isChargebackEntry(e)) ?? null;
}

/**
 * Human-readable label for a chargeback status, for screen-reader and
 * non-visual tooltip purposes. UI renders its own visual treatment per
 * status; this is the plain English.
 */
export function chargebackStatusLabel(status: MilestoneChargebackStatus): string {
  switch (status) {
    case 'paid': return 'Paid';
    case 'paid-charged-back': return 'Charged back';
    case 'paid-chargeback-pending': return 'Chargeback pending';
    case 'paid-needs-chargeback': return 'Paid — chargeback not recorded';
    case 'pending': return 'Pending';
    case 'wont-pay-out': return "Won't pay out — deal cancelled";
  }
}
