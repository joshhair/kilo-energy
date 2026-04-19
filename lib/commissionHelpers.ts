/**
 * commissionHelpers.ts — Shared helpers for computing and displaying
 * "my commission on a project" consistently across the mobile app.
 *
 * Used by the Projects list tile (compact pill) and the Project detail
 * page (YOUR COMMISSION header block).
 */

import type { Project, PayrollEntry } from "./data";

export type CommissionStatus =
  | "paid" // all applicable milestones paid
  | "partial" // at least one milestone paid, not all
  | "projected"; // nothing paid yet

export interface MyCommission {
  total: number;
  status: CommissionStatus;
  /** Which stages are applicable for this viewer on this deal */
  stages: {
    m1: { applicable: boolean; amount: number; paid: boolean };
    m2: { applicable: boolean; amount: number; paid: boolean };
    m3: { applicable: boolean; amount: number; paid: boolean };
  };
}

/**
 * Compute the current viewer's total commission on a project.
 *
 * Strategy:
 * - First prefer authoritative payroll entries filtered to (projectId, repId).
 *   These are drafted as soon as a milestone is hit and are the source of
 *   truth for setters, trainers, and anyone whose amount isn't stored
 *   directly on the Project row.
 * - If no payroll entries exist yet (common for brand-new "New"-phase
 *   deals), fall back to the amounts stored on the Project itself, which
 *   are the closer's projected amounts — correct for the closer and for
 *   sub-dealers (whose amounts were stored at deal creation time).
 *
 * For sub-dealers: M1 is always 0 (SDs don't get an M1), so the total
 * is effectively m2 + m3. The math still works out when summing m1+m2+m3.
 */
export function myCommissionOnProject(
  project: Project,
  repId: string | null,
  role: string | null,
  payrollEntries: PayrollEntry[],
): MyCommission {
  const isSubDealer = role === "sub-dealer";
  const isViewerCloser = project.repId === repId;
  const isViewerSetter = project.setterId === repId;
  const isViewerSubDealer = project.subDealerId === repId;
  const isViewerTrainer = project.trainerId === repId;

  // ─ Trainer path ─
  // A rep who's the per-project trainer (or resolves to it via the
  // assignment chain) gets paid as one lump sum at the Trainer paymentStage,
  // not split into M1/M2/M3. Their total = trainerRate × kW × 1000, paid
  // on the project's phase progression (same trigger as closer M2).
  if (isViewerTrainer && !isViewerCloser && !isViewerSetter) {
    const trainerEntries = payrollEntries.filter(
      (e) => e.projectId === project.id && e.repId === repId && e.paymentStage === "Trainer",
    );
    const paidEntries = trainerEntries.filter((e) => e.status === "Paid");
    const totalFromEntries = trainerEntries.reduce((s, e) => s + e.amount, 0);
    const projected = (project.trainerRate ?? 0) * (project.kWSize ?? 0) * 1000;
    const total = trainerEntries.length > 0 ? totalFromEntries : projected;
    const allPaid = trainerEntries.length > 0 && paidEntries.length === trainerEntries.length;
    const anyPaid = paidEntries.length > 0;

    // Represent trainer payout on the M2 slot since that's the phase
    // it's released on — lets existing UI (which iterates m1/m2/m3)
    // render trainer totals without needing a new code path. M1/M3
    // are N/A for trainers.
    const stages = {
      m1: { applicable: false, amount: 0, paid: false },
      m2: { applicable: true, amount: total, paid: allPaid },
      m3: { applicable: false, amount: 0, paid: false },
    };

    const status: CommissionStatus = allPaid ? "paid" : anyPaid ? "partial" : "projected";
    return { total, status, stages };
  }

  // ─ Try payroll entries first (authoritative) ─
  const myEntries = payrollEntries.filter(
    (e) => e.projectId === project.id && e.repId === repId,
  );

  if (myEntries.length > 0) {
    const byStage = (stage: "M1" | "M2" | "M3") =>
      myEntries.find((e) => e.paymentStage === stage);

    const m1 = byStage("M1");
    const m2 = byStage("M2");
    const m3 = byStage("M3");

    const total =
      (m1?.amount ?? 0) + (m2?.amount ?? 0) + (m3?.amount ?? 0);
    const m1Applicable = !isSubDealer && !!m1;
    const m2Applicable = !!m2;
    const m3Applicable = !!m3;

    const stages = {
      m1: {
        applicable: m1Applicable,
        amount: m1?.amount ?? 0,
        paid: m1?.status === "Paid",
      },
      m2: {
        applicable: m2Applicable,
        amount: m2?.amount ?? 0,
        paid: m2?.status === "Paid",
      },
      m3: {
        applicable: m3Applicable,
        amount: m3?.amount ?? 0,
        paid: m3?.status === "Paid",
      },
    };

    return { total, status: deriveStatus(stages), stages };
  }

  // ─ Fall back to project fields (closer or sub-dealer view) ─
  // For a setter with no entries yet, we don't have their specific numbers
  // stored — total will be 0 and status "projected".
  if (isViewerCloser || isViewerSubDealer) {
    const m1Amount = isSubDealer || project.setterId ? 0 : project.m1Amount ?? 0;
    const m2Amount = project.m2Amount ?? 0;
    const m3Amount = project.m3Amount ?? 0;

    const stages = {
      m1: {
        applicable: !isSubDealer,
        amount: m1Amount,
        paid: project.m1Paid ?? false,
      },
      m2: {
        applicable: true,
        amount: m2Amount,
        paid: project.m2Paid ?? false,
      },
      m3: {
        applicable: m3Amount > 0,
        amount: m3Amount,
        paid: project.m3Paid ?? false,
      },
    };

    return {
      total: m1Amount + m2Amount + m3Amount,
      status: deriveStatus(stages),
      stages,
    };
  }

  // Setter with no drafted payroll yet — fall back to stored setter amounts.
  if (isViewerSetter) {
    const m1Amount = project.setterM1Amount ?? 0;
    const m2Amount = project.setterM2Amount ?? 0;
    const m3Amount = project.setterM3Amount ?? 0;

    const stages = {
      m1: { applicable: true, amount: m1Amount, paid: false },
      m2: { applicable: true, amount: m2Amount, paid: false },
      m3: { applicable: m3Amount > 0, amount: m3Amount, paid: false },
    };

    return {
      total: m1Amount + m2Amount + m3Amount,
      status: deriveStatus(stages),
      stages,
    };
  }

  // Check additionalClosers / additionalSetters (co-party reps).
  const coCloserEntry = project.additionalClosers?.find(
    (p) => p.userId === repId,
  );
  if (coCloserEntry) {
    const m1Amount = coCloserEntry.m1Amount;
    const m2Amount = coCloserEntry.m2Amount;
    const m3Amount = coCloserEntry.m3Amount ?? 0;
    const stages = {
      m1: { applicable: true, amount: m1Amount, paid: false },
      m2: { applicable: true, amount: m2Amount, paid: false },
      m3: { applicable: m3Amount > 0, amount: m3Amount, paid: false },
    };
    return {
      total: m1Amount + m2Amount + m3Amount,
      status: deriveStatus(stages),
      stages,
    };
  }

  const coSetterEntry = project.additionalSetters?.find(
    (p) => p.userId === repId,
  );
  if (coSetterEntry) {
    const m1Amount = coSetterEntry.m1Amount;
    const m2Amount = coSetterEntry.m2Amount;
    const m3Amount = coSetterEntry.m3Amount ?? 0;
    const stages = {
      m1: { applicable: true, amount: m1Amount, paid: false },
      m2: { applicable: true, amount: m2Amount, paid: false },
      m3: { applicable: m3Amount > 0, amount: m3Amount, paid: false },
    };
    return {
      total: m1Amount + m2Amount + m3Amount,
      status: deriveStatus(stages),
      stages,
    };
  }

  // Viewer isn't on this deal — zero everything.
  return {
    total: 0,
    status: "projected",
    stages: {
      m1: { applicable: false, amount: 0, paid: false },
      m2: { applicable: false, amount: 0, paid: false },
      m3: { applicable: false, amount: 0, paid: false },
    },
  };
}

function deriveStatus(stages: MyCommission["stages"]): CommissionStatus {
  const applicable = [stages.m1, stages.m2, stages.m3].filter(
    (s) => s.applicable,
  );
  if (applicable.length === 0) return "projected";
  const paidCount = applicable.filter((s) => s.paid).length;
  if (paidCount === applicable.length) return "paid";
  if (paidCount > 0) return "partial";
  return "projected";
}
