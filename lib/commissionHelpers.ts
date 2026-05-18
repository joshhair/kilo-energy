/**
 * commissionHelpers.ts — Shared helpers for computing and displaying
 * "my commission on a project" consistently across the mobile app.
 *
 * Used by the Projects list tile (compact pill) and the Project detail
 * page (YOUR COMMISSION header block).
 */

import type { Project, PayrollEntry, TrainerAssignment } from "./data";
import {
  computeProjectedTrainerLegs,
  sumProjectedTrainerPayForRep,
} from "./trainer-projection";

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
  /**
   * Projected trainer pay for this viewer on this deal, in addition to
   * any closer/setter role they have. Populated when the viewer
   * resolves as the chain trainer (or per-project override target)
   * for the deal's closer and/or setter. Always 0 when
   * `trainerAssignments` is not passed to `myCommissionOnProject`.
   *
   * This is summed into `total` so the "YOUR COMMISSION" header card
   * reflects combined closer + trainer pay in a single number, per the
   * Hunter-on-McMorrow case where the rep is both.
   */
  trainerProjection: number;
}

/**
 * Compute the current viewer's total commission on a project.
 *
 * Strategy: the TOTAL is always the full projected commission from
 * the rep's role on this deal (closer m1/m2/m3, setter m1/m2/m3,
 * sub-dealer m2/m3, co-closer m1/m2/m3, co-setter m1/m2/m3). Payroll
 * entries are used to detect WHICH stages are marked paid — they
 * are NOT used as the source-of-truth for the total.
 *
 * Why: payroll entries are drafted progressively as milestones are
 * hit. An early-phase deal (only M1 drafted) would otherwise report
 * only the M1 amount as total, hiding the M2 and M3 the rep will
 * earn as the deal progresses — which is exactly what reps need to
 * see ("what is this deal worth to me?").
 *
 * For sub-dealers: M1 is always 0 (SDs don't get an M1), so the
 * total is effectively m2 + m3.
 */
export function myCommissionOnProject(
  project: Project,
  repId: string | null,
  role: string | null,
  payrollEntries: PayrollEntry[],
  trainerAssignments: readonly TrainerAssignment[] = [],
): MyCommission {
  const isSubDealer = role === "sub-dealer";
  const isViewerCloser = project.repId === repId;
  const isViewerSetter = project.setterId === repId;
  const isViewerSubDealer = project.subDealerId === repId;

  // Compute every projected trainer leg on this deal (closer-trainer +
  // setter-trainer), then pull the viewer-targeted total. This makes
  // the chain trainer visible in pay summaries even before phase=Installed
  // generates real PayrollEntry rows. Empty when trainerAssignments isn't
  // passed (backward-compat for the projects-list caller).
  const projectedLegs = computeProjectedTrainerLegs(
    {
      id: project.id,
      trainerId: project.trainerId ?? null,
      trainerRate: project.trainerRate ?? null,
      repId: project.repId,
      setterId: project.setterId ?? null,
      kWSize: project.kWSize ?? 0,
    },
    trainerAssignments,
    payrollEntries,
  );
  const viewerTrainerPay = sumProjectedTrainerPayForRep(projectedLegs, repId);

  // Pull this viewer's payroll entries once — used across branches to
  // surface paid/not-paid status for each stage.
  const myEntries = payrollEntries.filter(
    (e) => e.projectId === project.id && e.repId === repId,
  );
  const paidStage = (stage: "M1" | "M2" | "M3") =>
    myEntries.some((e) => e.paymentStage === stage && e.status === "Paid");

  // ─ Trainer-only path ─
  // Viewer is the trainer on this deal (via project override or chain)
  // and is NOT also the closer/setter/sub-dealer. Pay = trainer projection.
  // For mixed roles (closer + trainer, etc.) the trainer add-on is folded
  // into the role branch below via `trainerProjection`.
  if (viewerTrainerPay > 0 && !isViewerCloser && !isViewerSetter && !isViewerSubDealer) {
    const trainerEntries = payrollEntries.filter(
      (e) => e.projectId === project.id && e.repId === repId && e.paymentStage === "Trainer",
    );
    const paidEntries = trainerEntries.filter((e) => e.status === "Paid");
    const allPaid = trainerEntries.length > 0 && paidEntries.length === trainerEntries.length;
    const anyPaid = paidEntries.length > 0;

    const stages = {
      m1: { applicable: false, amount: 0, paid: false },
      m2: { applicable: true, amount: viewerTrainerPay, paid: allPaid },
      m3: { applicable: false, amount: 0, paid: false },
    };

    const status: CommissionStatus = allPaid ? "paid" : anyPaid ? "partial" : "projected";
    return { total: viewerTrainerPay, status, stages, trainerProjection: viewerTrainerPay };
  }

  // ─ Closer / sub-dealer ─
  // Total is always the full projection from Project fields. Payroll
  // entries only inform the paid/unpaid flag per stage.
  if (isViewerCloser || isViewerSubDealer) {
    const m1Amount = isSubDealer || project.setterId ? 0 : project.m1Amount ?? 0;
    const m2Amount = project.m2Amount ?? 0;
    const m3Amount = project.m3Amount ?? 0;

    const stages = {
      m1: {
        applicable: !isSubDealer && m1Amount > 0,
        amount: m1Amount,
        paid: paidStage("M1") || (project.m1Paid ?? false),
      },
      m2: {
        applicable: true,
        amount: m2Amount,
        paid: paidStage("M2") || (project.m2Paid ?? false),
      },
      m3: {
        applicable: m3Amount > 0,
        amount: m3Amount,
        paid: paidStage("M3") || (project.m3Paid ?? false),
      },
    };

    // viewerTrainerPay folds in the closer-also-trainer case (Hunter on
    // McMorrow): closer total + projected trainer leg = combined pay
    // shown on the YOUR COMMISSION header card. 0 when viewer isn't
    // also the trainer on this deal.
    return {
      total: m1Amount + m2Amount + m3Amount + viewerTrainerPay,
      status: deriveStatus(stages),
      stages,
      trainerProjection: viewerTrainerPay,
    };
  }

  // ─ Setter ─
  if (isViewerSetter) {
    const m1Amount = project.setterM1Amount ?? 0;
    const m2Amount = project.setterM2Amount ?? 0;
    const m3Amount = project.setterM3Amount ?? 0;

    const stages = {
      m1: { applicable: m1Amount > 0, amount: m1Amount, paid: paidStage("M1") },
      m2: { applicable: true, amount: m2Amount, paid: paidStage("M2") },
      m3: { applicable: m3Amount > 0, amount: m3Amount, paid: paidStage("M3") },
    };

    return {
      total: m1Amount + m2Amount + m3Amount + viewerTrainerPay,
      status: deriveStatus(stages),
      stages,
      trainerProjection: viewerTrainerPay,
    };
  }

  // ─ Co-party (additionalClosers / additionalSetters) ─
  const coCloserEntry = project.additionalClosers?.find((p) => p.userId === repId);
  if (coCloserEntry) {
    const m1Amount = coCloserEntry.m1Amount;
    const m2Amount = coCloserEntry.m2Amount;
    const m3Amount = coCloserEntry.m3Amount ?? 0;
    const stages = {
      m1: { applicable: m1Amount > 0, amount: m1Amount, paid: paidStage("M1") },
      m2: { applicable: true, amount: m2Amount, paid: paidStage("M2") },
      m3: { applicable: m3Amount > 0, amount: m3Amount, paid: paidStage("M3") },
    };
    return {
      total: m1Amount + m2Amount + m3Amount + viewerTrainerPay,
      status: deriveStatus(stages),
      stages,
      trainerProjection: viewerTrainerPay,
    };
  }

  const coSetterEntry = project.additionalSetters?.find((p) => p.userId === repId);
  if (coSetterEntry) {
    const m1Amount = coSetterEntry.m1Amount;
    const m2Amount = coSetterEntry.m2Amount;
    const m3Amount = coSetterEntry.m3Amount ?? 0;
    const stages = {
      m1: { applicable: m1Amount > 0, amount: m1Amount, paid: paidStage("M1") },
      m2: { applicable: true, amount: m2Amount, paid: paidStage("M2") },
      m3: { applicable: m3Amount > 0, amount: m3Amount, paid: paidStage("M3") },
    };
    return {
      total: m1Amount + m2Amount + m3Amount + viewerTrainerPay,
      status: deriveStatus(stages),
      stages,
      trainerProjection: viewerTrainerPay,
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
    trainerProjection: 0,
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
