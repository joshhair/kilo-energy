/**
 * Project transition handlers — extracted from updateProject in context.tsx.
 *
 * Each function is a pure-ish helper that returns payroll mutations (entries to
 * add, ids to delete) without touching React state directly.  The orchestrator
 * in context.tsx applies the results via setPayrollEntries / setProjects.
 */

import type { Project, PayrollEntry, Phase, Rep, TrainerAssignment, InstallerPayConfig } from '../data';
import { resolveTrainerLegs, DEFAULT_INSTALL_PAY_PCT } from '../data';
import type { TrainerLeg, TrainerPartyInput } from '../data';
import { getM1PayDate, getM2PayDate, getM3PayDate, localDateString } from '../utils';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface ProjectTransitionDeps {
  repsRef: React.MutableRefObject<Rep[]>;
  trainerAssignmentsRef: React.MutableRefObject<TrainerAssignment[]>;
  projectsRef: React.MutableRefObject<Project[]>;
  installerPayConfigs: Record<string, InstallerPayConfig>;
  persistPayrollEntry: (entry: PayrollEntry) => void;
  deletePayrollEntriesFromDb: (ids: string[]) => void;
  logProjectActivity: (projectId: string, type: string, detail: string, meta?: string) => void;
}

const PIPELINE: string[] = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];

// ─── Multi-party trainer-leg aggregation ────────────────────────────────────
//
// Added 2026-05-23 for the multi-setter/multi-trainer scenario (Bryce/Patrick/
// Tyson with separate trainers Hunter + Paul, splitting the deal 50/50).
//
// Wraps `resolveTrainerLegs` for use in createMilestonePayroll + createM3Payroll.
// Returns per-party deductions AND deduped trainer-entry data, applying the
// preserved historical behaviors:
//
//   * Self-trainer-with-setter guard: a closer-side leg whose trainer IS the
//     closer (self) is suppressed when ANY setter party exists. Preserves the
//     pre-multi-party rule that a self-loop closer-trainer with a setter
//     present has its override owned by the setter leg.
//
//   * Cross-side trainer cap: when the same trainer is reached via BOTH a
//     closer-side and a setter-side leg (or via multiple legs whose shares
//     sum > 1.0), the trainer's total share is capped at 1.0 — they get
//     paid the override ONCE per deal per milestone, never more.
//
//   * Per-party deductions: each party pays its leg's amount, scaled down
//     proportionally if the cross-side cap reduces the trainer's total
//     payout. Sum of party deductions for a given trainer == trainer's
//     emitted amount.
//
//   * M2-rate-lock for M3: pass `rateLockByTrainerId` so the M3 pass uses
//     the same per-watt rate that was emitted at M2, even if tier
//     progression has since changed the chain's current rate. Matches
//     existing single-trainer M3 behavior at line ~686.

interface TrainerLegMilestoneInput {
  project: { id: string; trainerId?: string | null; trainerRate?: number | null; noChainTrainer?: boolean | null };
  closerParties: TrainerPartyInput[];
  setterParties: TrainerPartyInput[];
  trainerAssignments: readonly TrainerAssignment[];
  prevEntries: readonly PayrollEntry[];
  repsRef: React.MutableRefObject<Rep[]>;
  kW: number;
  /** Fraction of the deal paid at this milestone — installPct/100 for M2,
   *  (100-installPct)/100 for M3. */
  milestonePct: number;
  /** Optional: lock the rate for trainers that already have an entry on
   *  this project (M3 path reads from M2's entry to keep rates stable
   *  even when the trainer's tier has stepped). */
  rateLockByTrainerId?: Map<string, number>;
}

interface TrainerLegEntry {
  trainerId: string;
  trainerName: string;
  amount: number;
  ratePerW: number;
  /** Distinct trainee display names credited for this trainer on this deal. */
  traineeNames: string[];
  /** True if this entry came from the per-project override path (single
   *  trainer for the whole deal). */
  isOverride: boolean;
}

interface TrainerLegResult {
  /** Per-party deductions keyed by traineeId. Apply to that party's M2 entry. */
  deductionsByUserId: Map<string, number>;
  /** Deduplicated per-trainer entries to emit (after dedup checks). */
  entries: TrainerLegEntry[];
}

function computeTrainerLegsForMilestone(input: TrainerLegMilestoneInput): TrainerLegResult {
  const repName = (id: string): string | undefined =>
    input.repsRef.current.find((r) => r.id === id)?.name;

  const rawLegs = resolveTrainerLegs(
    {
      project: input.project,
      closerParties: input.closerParties,
      setterParties: input.setterParties,
      trainerAssignments: input.trainerAssignments,
      payrollEntries: input.prevEntries,
    },
    repName,
  );

  // Self-trainer-with-setter guard: drop closer-side legs where the trainer
  // is themselves AND any setter party exists. The setter-side legs (or
  // the override) own the trainer payment in that case.
  const anySetter = input.setterParties.some((p) => !!p.userId);
  const legs = rawLegs.filter((leg) => {
    if (leg.side === 'closer' && anySetter && leg.trainerId === leg.traineeId) {
      return false;
    }
    return true;
  });

  // Apply rate lock (M3 path) — if a trainer already emitted at M2, reuse
  // that rate so M3 doesn't drift to a stepped tier mid-deal.
  const adjusted = legs.map((leg) => {
    const locked = input.rateLockByTrainerId?.get(leg.trainerId);
    return locked != null ? { ...leg, ratePerW: locked } : leg;
  });

  // Group by trainerId. Within each group: pick the rate from the highest-
  // share leg (handles the rare edge where the same trainer appears at
  // different tier positions for different trainees — we accept a slight
  // bias toward the largest-stake leg's rate to preserve the "one rate per
  // trainer per deal" invariant the existing system relies on).
  interface TrainerGroup {
    trainerId: string;
    legs: TrainerLeg[];
    totalShare: number;
    chosenRate: number;
    chosenShareForRate: number;
    isOverride: boolean;
  }
  const byTrainer = new Map<string, TrainerGroup>();
  for (const leg of adjusted) {
    const existing = byTrainer.get(leg.trainerId);
    if (existing) {
      existing.legs.push(leg);
      existing.totalShare += leg.share;
      if (leg.share > existing.chosenShareForRate) {
        existing.chosenRate = leg.ratePerW;
        existing.chosenShareForRate = leg.share;
      }
    } else {
      byTrainer.set(leg.trainerId, {
        trainerId: leg.trainerId,
        legs: [leg],
        totalShare: leg.share,
        chosenRate: leg.ratePerW,
        chosenShareForRate: leg.share,
        isOverride: leg.side === 'override',
      });
    }
  }

  const entries: TrainerLegEntry[] = [];
  const deductionsByUserId = new Map<string, number>();

  for (const group of byTrainer.values()) {
    const cappedShare = Math.min(1.0, group.totalShare);
    const totalAmount = Math.round(
      group.chosenRate * input.kW * 1000 * input.milestonePct * cappedShare * 100,
    ) / 100;
    if (totalAmount <= 0) continue;

    const traineeNames = Array.from(
      new Set(group.legs.map((l) => l.traineeName).filter((n) => !!n)),
    );

    entries.push({
      trainerId: group.trainerId,
      trainerName: repName(group.trainerId) ?? '',
      amount: totalAmount,
      ratePerW: group.chosenRate,
      traineeNames,
      isOverride: group.isOverride,
    });

    // Allocate deductions. Each leg's share is scaled down by the cap
    // ratio so the sum of party deductions equals the trainer's total
    // amount.
    if (group.totalShare > 0) {
      const scale = cappedShare / group.totalShare;
      for (const leg of group.legs) {
        if (!leg.traineeId) continue; // override leg has no party attribution
        const partyAmount = Math.round(
          group.chosenRate * input.kW * 1000 * input.milestonePct * leg.share * scale * 100,
        ) / 100;
        if (partyAmount <= 0) continue;
        const prev = deductionsByUserId.get(leg.traineeId) ?? 0;
        deductionsByUserId.set(leg.traineeId, prev + partyAmount);
      }
    }
  }

  return { deductionsByUserId, entries };
}

/**
 * Build a PayrollEntry notes string crediting one or more trainees for a
 * trainer override entry. Format kept compatible with the legacy single-
 * trainee + dual-trainee patterns so the M3 rate-lock parser keeps
 * working (it pattern-matches the trainee-name prefix to find the
 * corresponding M2 entry).
 */
function buildTrainerNotes(stage: 'M2' | 'M3', traineeNames: string[], ratePerW: number): string {
  const trainees = traineeNames.length > 0 ? traineeNames.join(' + ') : '';
  const prefix = trainees
    ? `Trainer override ${stage} — ${trainees}`
    : `Trainer override ${stage}`;
  return `${prefix} ($${ratePerW.toFixed(2)}/W)`;
}

// ─── 1. mapProjectUpdateToDb ─────────────────────────────────────────────────

/** Maps the subset of Project update fields that should be persisted to the DB. */
export function mapProjectUpdateToDb(updates: Partial<Project>): Record<string, unknown> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.phase !== undefined) dbUpdates.phase = updates.phase;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
  if (updates.adminNotes !== undefined) dbUpdates.adminNotes = updates.adminNotes;
  if (updates.flagged !== undefined) dbUpdates.flagged = updates.flagged;
  if (updates.m1Paid !== undefined) dbUpdates.m1Paid = updates.m1Paid;
  if (updates.m1Amount !== undefined) dbUpdates.m1Amount = updates.m1Amount;
  if (updates.m2Paid !== undefined) dbUpdates.m2Paid = updates.m2Paid;
  if (updates.m2Amount !== undefined) dbUpdates.m2Amount = updates.m2Amount;
  if (updates.m3Paid !== undefined) dbUpdates.m3Paid = updates.m3Paid;
  if (updates.m3Amount !== undefined) dbUpdates.m3Amount = updates.m3Amount;
  if (updates.setterM1Amount !== undefined) dbUpdates.setterM1Amount = updates.setterM1Amount;
  if (updates.setterM2Amount !== undefined) dbUpdates.setterM2Amount = updates.setterM2Amount;
  if (updates.setterM3Amount !== undefined) dbUpdates.setterM3Amount = updates.setterM3Amount;
  if (updates.cancellationReason !== undefined) dbUpdates.cancellationReason = updates.cancellationReason;
  if (updates.cancellationNotes !== undefined) dbUpdates.cancellationNotes = updates.cancellationNotes;
  if (updates.installer !== undefined) dbUpdates.installer = updates.installer;
  if (updates.financer !== undefined) dbUpdates.financer = updates.financer;
  if (updates.productType !== undefined) dbUpdates.productType = updates.productType;
  // Installer prepaid sub-option. '' flows through — the API maps empty → null
  // (clear). Added 2026-06-10 with edit-modal prepaid support (Rebekah's report).
  if (updates.prepaidSubType !== undefined) dbUpdates.prepaidSubType = updates.prepaidSubType;
  // Equipment (product) change. The client tracks SolarTech vs installer-
  // catalog product as two separate fields, but the DB column is the unified
  // `productId`. Map whichever is present so an admin equipment edit persists
  // (the API gates the change to admins + only acts when it differs).
  if ('solarTechProductId' in updates || 'installerProductId' in updates) {
    dbUpdates.productId = (updates.solarTechProductId || updates.installerProductId) || null;
  }
  if (updates.kWSize !== undefined) dbUpdates.kWSize = updates.kWSize;
  if (updates.netPPW !== undefined) dbUpdates.netPPW = updates.netPPW;
  // Primary closer + setter — server uses `closerId`, client uses `repId`.
  // The rename happens here so the rest of the app can stay in client terms.
  if (updates.repId !== undefined) dbUpdates.closerId = updates.repId;
  if (updates.setterId !== undefined) dbUpdates.setterId = updates.setterId;
  if (updates.soldDate !== undefined) dbUpdates.soldDate = updates.soldDate;
  if (updates.baselineOverride !== undefined) dbUpdates.baselineOverrideJson = updates.baselineOverride ? JSON.stringify(updates.baselineOverride) : null;
  // Tag-team co-parties flow straight through to the API, which treats them
  // as full-replace arrays. Each entry carries wire-format dollars; the API
  // serializer converts to cents.
  if (updates.additionalClosers !== undefined) {
    dbUpdates.additionalClosers = updates.additionalClosers.map((c) => ({
      userId: c.userId,
      m1Amount: c.m1Amount,
      m2Amount: c.m2Amount,
      m3Amount: c.m3Amount ?? undefined,
      position: c.position,
    }));
  }
  if (updates.additionalSetters !== undefined) {
    dbUpdates.additionalSetters = updates.additionalSetters.map((s) => ({
      userId: s.userId,
      m1Amount: s.m1Amount,
      m2Amount: s.m2Amount,
      m3Amount: s.m3Amount ?? undefined,
      position: s.position,
    }));
  }
  // Per-project trainer override — both fields persist together. Empty
  // trainerId clears the override (rate is meaningless without trainer).
  if ('trainerId' in updates) dbUpdates.trainerId = updates.trainerId ?? null;
  if ('trainerRate' in updates) dbUpdates.trainerRate = updates.trainerRate ?? null;
  // Admin's "remove all trainers" flag — suppresses chain trainer
  // visibility + commission. Set true by the project sheet's Clear button.
  if ('noChainTrainer' in updates) dbUpdates.noChainTrainer = updates.noChainTrainer ?? false;
  // Lead-source attribution. Both fields move together — flipping
  // leadSource off 'blitz' should clear blitzId; the Edit Project modal
  // enforces that pairing in the UI before calling updateProject. Empty
  // strings normalize to undefined ('not set' → leave field unchanged).
  if ('leadSource' in updates) dbUpdates.leadSource = updates.leadSource || null;
  if ('blitzId' in updates) dbUpdates.blitzId = updates.blitzId || null;
  return dbUpdates;
}

// ─── 2. computeM3Amount ──────────────────────────────────────────────────────

/**
 * Pure function: calculates the M3 amount at the Installed transition.
 * Returns null when the installer pays 100% at install (no M3 split).
 */
export function computeM3Amount(
  old: Project,
  updates: Partial<Project>,
  installerPayConfigs: Record<string, InstallerPayConfig>,
): number | null {
  const installPayPct = installerPayConfigs[updates.installer ?? old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  if (installPayPct >= 100) return null;
  const fullAmount = updates.m2Amount ?? old.m2Amount ?? 0;
  return installPayPct > 0
    ? Math.round(fullAmount * ((100 - installPayPct) / installPayPct) * 100) / 100
    : 0;
}

/**
 * Repair m3Amount / setterM3Amount at PTO — if Installed-time persist failed and left them null.
 * Returns repaired values for closer and setter; null means no repair needed.
 */
export function repairM3AmountAtPTO(
  old: Project,
  updates: Partial<Project>,
  installerPayConfigs: Record<string, InstallerPayConfig>,
): { closer: number | null; setter: number | null } {
  const installPayPct = installerPayConfigs[updates.installer ?? old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  if (installPayPct >= 100) return { closer: null, setter: null };
  const effectiveM2 = updates.m2Amount ?? old.m2Amount;
  const effectiveSetterM2 = updates.setterM2Amount ?? old.setterM2Amount;
  const repairedM3 = (old.m3Amount ?? 0) > 0 && updates.m2Amount === undefined
    ? old.m3Amount!
    : installPayPct > 0
      ? Math.round((effectiveM2 ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
      : 0;
  const repairedSetterM3 = old.setterId
    ? (old.setterM3Amount ?? 0) > 0 && updates.setterM2Amount === undefined
      ? old.setterM3Amount!
      : installPayPct > 0
        ? Math.round((effectiveSetterM2 ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0
    : 0;
  return {
    closer: repairedM3 > 0 ? repairedM3 : null,
    setter: repairedSetterM3 > 0 ? repairedSetterM3 : null,
  };
}

/**
 * Derive m3Amount from m2Amount when m2 is edited on a project past Installed.
 * Mutates `updates` and `dbUpdates` in place. Returns derived m3 or null.
 */
export function deriveM3FromM2Edit(
  updates: Partial<Project>,
  old: Project,
  installerPayConfigs: Record<string, InstallerPayConfig>,
  dbUpdates: Record<string, unknown>,
): void {
  const PAST_INSTALLED_PHASES: Phase[] = ['Installed', 'PTO', 'Completed'];
  // Closer m2 → m3
  if (updates.m2Amount !== undefined && updates.m3Amount === undefined && !old.subDealerId && PAST_INSTALLED_PHASES.includes(old.phase as Phase)) {
    const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    if (installPayPct > 0 && installPayPct < 100) {
      const derivedM3 = Math.round(updates.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100;
      updates.m3Amount = derivedM3;
      dbUpdates.m3Amount = derivedM3;
    }
  }
  // Setter m2 → m3
  if (updates.setterM2Amount !== undefined && updates.setterM3Amount === undefined && !old.subDealerId && old.setterId && PAST_INSTALLED_PHASES.includes(old.phase as Phase)) {
    const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    if (installPayPct > 0 && installPayPct < 100) {
      const derivedSetterM3 = Math.round(updates.setterM2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100;
      updates.setterM3Amount = derivedSetterM3;
      dbUpdates.setterM3Amount = derivedSetterM3;
    }
  }
}

// ─── 3. handleChargebacks ────────────────────────────────────────────────────

export interface ChargebackResult {
  /** Entries to add (negative chargebacks) */
  toAdd: PayrollEntry[];
  /** Entry IDs to delete (Draft/Pending positives) */
  toDeleteIds: string[];
}

/**
 * When a project is cancelled, creates negative chargeback entries for any Paid
 * entries, and identifies Draft/Pending entries for deletion.
 * Handles deduplication — won't create a chargeback if one already exists.
 *
 * Skips Glide-imported projects (`old.importedFromGlide === true`): those
 * rows carry their own historical reconciliation from Glide and creating
 * new chargebacks would double-charge. Still cleans up any Draft/Pending
 * positives though — a cancelled imported deal shouldn't continue
 * generating future payroll.
 */
export function handleChargebacks(
  projectId: string,
  old: Project,
  prevEntries: PayrollEntry[],
): ChargebackResult {
  // Remove Draft/Pending entries immediately
  const draftOrPendingEntries = prevEntries.filter(
    (e) => e.projectId === projectId && e.amount > 0 && e.type === 'Deal' && (e.status === 'Draft' || e.status === 'Pending')
  );
  const toDeleteIds = draftOrPendingEntries.map((e) => e.id);

  // Imported-from-Glide short-circuit: historical rows carry their own
  // chargeback reconciliation in the imported payroll. Only clean up the
  // forward-looking Draft/Pending positives; don't generate new negatives.
  if (old.importedFromGlide) {
    return { toAdd: [], toDeleteIds };
  }

  const remaining = draftOrPendingEntries.length > 0
    ? prevEntries.filter((e) => !draftOrPendingEntries.includes(e))
    : prevEntries;

  const paidEntries = remaining.filter(
    (e) => e.projectId === projectId && e.amount > 0 && e.type === 'Deal' && e.status === 'Paid'
  );
  if (paidEntries.length === 0) return { toAdd: [], toDeleteIds };

  // Filter out paid entries that already have a matching negative counterpart
  const paidEntriesToChargeback = paidEntries.filter(
    (pe) => !remaining.some(
      (e) => e.projectId === projectId && e.type === 'Deal' && e.amount < 0
        && e.repId === pe.repId && e.paymentStage === pe.paymentStage
    )
  );
  if (paidEntriesToChargeback.length === 0) return { toAdd: [], toDeleteIds };

  const ts = Date.now();
  const chargebacks: PayrollEntry[] = paidEntriesToChargeback.map((e, i) => ({
    id: `pay_${ts}_chargeback_${i}`,
    repId: e.repId,
    repName: e.repName,
    projectId,
    customerName: old.customerName,
    amount: -e.amount,
    type: 'Deal' as const,
    paymentStage: e.paymentStage,
    status: 'Draft' as const,
    date: localDateString(new Date()),
    notes: 'Chargeback — project cancelled',
    isChargeback: true,
  }));

  return { toAdd: chargebacks, toDeleteIds };
}

/**
 * When un-cancelling, identify orphaned chargeback entries to remove.
 */
export function getOrphanedChargebackIds(
  projectId: string,
  prevEntries: PayrollEntry[],
): string[] {
  return prevEntries
    .filter((e) => e.projectId === projectId && e.amount < 0 && e.status !== 'Paid')
    .map((e) => e.id);
}

// ─── 4. handlePhaseRollback ──────────────────────────────────────────────────

/**
 * When phase moves backward past a milestone, returns IDs of Draft entries to delete.
 */
export function handlePhaseRollback(
  projectId: string,
  oldPhase: string,
  newPhase: Phase,
  prevEntries: PayrollEntry[],
): string[] {
  // On Hold is a pause state, not a milestone progression — never roll back from it.
  if (oldPhase === 'On Hold') return [];
  const oldIdx = PIPELINE.indexOf(oldPhase);
  const effectiveOldIdx = oldIdx >= 0 ? oldIdx : -1;
  const newIdx = PIPELINE.indexOf(newPhase);
  if (effectiveOldIdx < 0 || newIdx < 0 || newIdx >= effectiveOldIdx) return [];

  const rollBackM1 = effectiveOldIdx >= PIPELINE.indexOf('Acceptance') && newIdx < PIPELINE.indexOf('Acceptance');
  const rollBackM2 = effectiveOldIdx >= PIPELINE.indexOf('Installed') && newIdx < PIPELINE.indexOf('Installed');
  const rollBackM3 = effectiveOldIdx >= PIPELINE.indexOf('PTO') && newIdx < PIPELINE.indexOf('PTO');
  if (!rollBackM1 && !rollBackM2 && !rollBackM3) return [];

  return prevEntries
    .filter((e) => {
      if (e.projectId !== projectId || (e.status !== 'Draft' && e.status !== 'Pending')) return false;
      if (rollBackM1 && e.paymentStage === 'M1') return true;
      if (rollBackM2 && (e.paymentStage === 'M2' || (e.paymentStage === 'Trainer' && e.notes?.includes('Trainer override M2')))) return true;
      if (rollBackM3 && (e.paymentStage === 'M3' || (e.paymentStage === 'Trainer' && e.notes?.includes('Trainer override M3')))) return true;
      return false;
    })
    .map((e) => e.id);
}

// ─── 5. createMilestonePayroll ───────────────────────────────────────────────

export interface MilestonePayrollParams {
  projectId: string;
  old: Project;
  /** The project list after updates have been applied */
  updatedProjects: Project[];
  stage: 'M1' | 'M2';
  isAcceptance: boolean;
  isInstalled: boolean;
  installPayPct: number;
  computedM3Amount: number | null;
  deps: ProjectTransitionDeps;
}

/**
 * Creates M1 or M2 payroll entries (closer + setter + trainers) when a project
 * reaches Acceptance or Installed.
 * Returns entries to add. Does NOT mutate prevEntries.
 */
export function createMilestonePayroll(
  params: MilestonePayrollParams,
  prevEntries: PayrollEntry[],
): PayrollEntry[] {
  const { projectId, old, updatedProjects, stage, isAcceptance, isInstalled, installPayPct, deps } = params;
  const payDate = isAcceptance ? getM1PayDate() : getM2PayDate();
  const freshProject = updatedProjects.find((p) => p.id === projectId);
  if (!freshProject) {
    console.error(`createMilestonePayroll: project ${projectId} not found in updatedProjects`);
    return [];
  }
  const fullAmount = isAcceptance ? freshProject.m1Amount : freshProject.m2Amount;

  // Suppress M1 if M2 entries already exist — project previously reached Installed,
  // so this Acceptance crossing is a re-entry, not a fresh milestone.
  if (stage === 'M1' && prevEntries.some((e) => e.projectId === projectId && e.paymentStage === 'M2')) {
    return [];
  }
  const ts = Date.now();
  const newEntries: PayrollEntry[] = [];
  const closerRep = deps.repsRef.current.find((r) => r.id === freshProject.repId);

  // Per-rep dedup helper: skip if this rep already has an entry for this project+stage.
  const repAlreadyExists = (repId: string) =>
    prevEntries.some((e) => e.projectId === projectId && e.paymentStage === stage && e.repId === repId);

  // Multi-party trainer-leg resolution. Replaces the single-trainer logic
  // that lived here before 2026-05-23 — now walks every closer + setter
  // party so deals with co-setters who have different trainers (Patrick's
  // Hunter + Tyson's Paul) get each trainer paid proportionally to their
  // setter's share of the deal. See computeTrainerLegsForMilestone for
  // the full semantics including the self-trainer-with-setter guard and
  // cross-side trainer cap.
  const m2CloserParties: TrainerPartyInput[] = [
    {
      userId: freshProject.repId,
      userName: closerRep?.name ?? freshProject.repName,
      m2Amount: freshProject.m2Amount ?? 0,
    },
    ...(freshProject.additionalClosers ?? []).map((c) => ({
      userId: c.userId,
      userName: c.userName,
      m2Amount: c.m2Amount ?? 0,
    })),
  ];
  const m2SetterParties: TrainerPartyInput[] = freshProject.setterId
    ? [
        {
          userId: freshProject.setterId,
          userName: deps.repsRef.current.find((r) => r.id === freshProject.setterId)?.name ?? freshProject.setterName ?? '',
          m2Amount: freshProject.setterM2Amount ?? 0,
        },
        ...(freshProject.additionalSetters ?? []).map((s) => ({
          userId: s.userId,
          userName: s.userName,
          m2Amount: s.m2Amount ?? 0,
        })),
      ]
    : (freshProject.additionalSetters ?? []).map((s) => ({
        userId: s.userId,
        userName: s.userName,
        m2Amount: s.m2Amount ?? 0,
      }));

  const m2TrainerLegs = isInstalled
    ? computeTrainerLegsForMilestone({
        project: { id: projectId, trainerId: freshProject.trainerId, trainerRate: freshProject.trainerRate, noChainTrainer: freshProject.noChainTrainer },
        closerParties: m2CloserParties,
        setterParties: m2SetterParties,
        trainerAssignments: deps.trainerAssignmentsRef.current,
        prevEntries,
        repsRef: deps.repsRef,
        kW: old.kWSize,
        milestonePct: installPayPct / 100,
      })
    : { deductionsByUserId: new Map(), entries: [] };

  // Pre-compute per-party deductions (closer + co-closers + setter + co-setters).
  // Override-path entries (single trainer for whole deal, no traineeId) historically
  // deducted from the primary closer; preserve that by attributing the override
  // amount to old.repId when no per-party deductions were emitted.
  const overrideEntryAmount = m2TrainerLegs.entries.find((e) => e.isOverride)?.amount ?? 0;
  if (overrideEntryAmount > 0 && m2TrainerLegs.deductionsByUserId.size === 0) {
    // Self-trainer-with-setter still suppressed for the override path: if
    // the override trainer is the closer AND a setter exists, the original
    // logic didn't deduct from the closer.
    const overrideTrainerIsCloserSelf =
      freshProject.trainerId === freshProject.repId && !!freshProject.setterId;
    if (!overrideTrainerIsCloserSelf) {
      m2TrainerLegs.deductionsByUserId.set(freshProject.repId, overrideEntryAmount);
    }
  }
  const closerM2TrainerDeduction = m2TrainerLegs.deductionsByUserId.get(freshProject.repId) ?? 0;

  // Closer entry (skip M1 only when a setter exists AND will receive an M1 entry — M1 goes entirely to the setter)
  // Use freshProject.setterId (post-update) so a simultaneously-added setter suppresses the closer M1.
  if ((fullAmount ?? 0) > 0 && !(isAcceptance && freshProject.setterId && (freshProject.setterM1Amount ?? 0) > 0) && !repAlreadyExists(freshProject.repId)) {
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_c`,
      repId: freshProject.repId,
      repName: closerRep?.name ?? freshProject.repName,
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, fullAmount! - closerM2TrainerDeduction),
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: '',
    });
  }

  // Setter entry (M1 goes to setter if one exists)
  // Use freshProject.setterId (post-update) so a simultaneously-added setter is included.
  if (freshProject.setterId && isAcceptance && (freshProject.setterM1Amount ?? 0) > 0 && !repAlreadyExists(freshProject.setterId)) {
    const setterRep = deps.repsRef.current.find((r) => r.id === freshProject.setterId);
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_s`,
      repId: freshProject.setterId!,
      repName: setterRep?.name ?? freshProject.setterName ?? '',
      projectId,
      customerName: old.customerName,
      amount: freshProject.setterM1Amount!,
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: 'Setter',
    });
  }

  // Setter M2 deduction is now driven by the multi-party leg map above.
  const setterM2TrainerDeduction = freshProject.setterId
    ? (m2TrainerLegs.deductionsByUserId.get(freshProject.setterId) ?? 0)
    : 0;

  // Setter entry (M2 at Installed — setterM2Amount is already post-installPayPct)
  if (freshProject.setterId && isInstalled && (freshProject.setterM2Amount ?? 0) > 0 && !repAlreadyExists(freshProject.setterId)) {
    const setterRep = deps.repsRef.current.find((r) => r.id === freshProject.setterId);
    newEntries.push({
      id: `pay_${ts}_m2_s`,
      repId: freshProject.setterId,
      repName: setterRep?.name ?? freshProject.setterName ?? '',
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, freshProject.setterM2Amount! - setterM2TrainerDeduction),
      type: 'Deal',
      paymentStage: 'M2',
      status: 'Draft',
      date: payDate,
      notes: 'Setter',
    });
  }

  // ── Co-closer entries ── Each additional closer gets a payroll entry
  // at the same milestone the primary hits, with THEIR cut. Follow the
  // primary-closer rule about suppressing M1 when a setter exists: a
  // co-closer is still a closer, and the deal's M1 goes to the setter.
  // At M2, co-closers with their own TrainerAssignment now deduct that
  // trainer's per-watt × their share (computed in m2TrainerLegs above).
  for (const co of freshProject.additionalClosers ?? []) {
    const amount = isAcceptance ? (co.m1Amount ?? 0) : (co.m2Amount ?? 0);
    if (amount <= 0) continue;
    if (isAcceptance && freshProject.setterId && (freshProject.setterM1Amount ?? 0) > 0) continue;
    if (repAlreadyExists(co.userId)) continue;
    const coDeduction = isInstalled
      ? (m2TrainerLegs.deductionsByUserId.get(co.userId) ?? 0)
      : 0;
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_cc${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, amount - coDeduction),
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: `Co-closer #${co.position}`,
    });
  }

  // ── Co-setter entries ── Additional setters get M1 at Acceptance and
  // M2 at Installed, mirroring the primary setter's cadence. At M2,
  // co-setters with their own TrainerAssignment now deduct that trainer's
  // per-watt × their share (computed in m2TrainerLegs above) — the
  // Bryce/Tyson scenario from 2026-05-23.
  for (const co of freshProject.additionalSetters ?? []) {
    const amount = isAcceptance ? (co.m1Amount ?? 0) : (co.m2Amount ?? 0);
    if (amount <= 0) continue;
    if (repAlreadyExists(co.userId)) continue;
    const coDeduction = isInstalled
      ? (m2TrainerLegs.deductionsByUserId.get(co.userId) ?? 0)
      : 0;
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_cs${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, amount - coDeduction),
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: `Co-setter #${co.position}`,
    });
  }

  // ── Trainer override M2 entries — emit one entry per dedup'd trainer ──
  //
  // Rewritten 2026-05-23 (multi-setter/multi-trainer fix). Single-trainer
  // dedup rule preserved: one entry per trainer per project per milestone,
  // even when a trainer is reached via multiple legs (cross-side or
  // same-side). Notes string credits every trainee whose chain led to this
  // trainer, so the audit trail reflects the full attribution.
  //
  // History (preserved for context):
  //   - Single-trainer-both-legs over-pay fixed (Paul Tupou case, 2026-Q1).
  //     The new computeTrainerLegsForMilestone keeps this dedup intact —
  //     cross-side same-trainer caps at share=1.0.
  //   - Self-trainer-with-setter guard preserved — see the helper.
  if (isInstalled) {
    for (const entry of m2TrainerLegs.entries) {
      if (entry.amount <= 0 || !entry.trainerId) continue;
      const notesPrefix = `Trainer override M2`;
      // The same-trainer dedup is handled INSIDE computeTrainerLegsForMilestone,
      // but we still need to skip if a prior persisted entry already covers
      // this trainer on this project (idempotency on phase re-entry).
      const alreadyExists = [...prevEntries, ...newEntries].some(
        (e) =>
          e.projectId === projectId &&
          e.paymentStage === 'Trainer' &&
          e.repId === entry.trainerId &&
          e.notes?.startsWith(notesPrefix),
      );
      if (alreadyExists) continue;
      newEntries.push({
        id: `pay_${ts}_m2_trainer_${entry.trainerId.slice(-6)}`,
        repId: entry.trainerId,
        repName: entry.trainerName,
        projectId,
        customerName: old.customerName,
        amount: entry.amount,
        type: 'Deal',
        paymentStage: 'Trainer',
        status: 'Draft',
        date: payDate,
        notes: buildTrainerNotes('M2', entry.traineeNames, entry.ratePerW),
      });
    }
  }

  return newEntries.filter((e) => e.amount > 0);
}

// ─── 6. createM3Payroll ──────────────────────────────────────────────────────

export interface M3PayrollParams {
  projectId: string;
  old: Project;
  updatedProjects: Project[];
  deps: ProjectTransitionDeps;
}

/**
 * Creates M3 entries at PTO — closer, setter, and trainer overrides.
 * Returns entries to add. Does NOT mutate prevEntries.
 */
export function createM3Payroll(
  params: M3PayrollParams,
  prevEntries: PayrollEntry[],
): PayrollEntry[] {
  const { projectId, old, updatedProjects, deps } = params;
  const { installerPayConfigs } = deps;
  const proj = updatedProjects.find((p) => p.id === projectId);

  // Role-specific guard: track which repIds already have an M3 entry so a
  // partial network failure (e.g. setter M3 persisted but closer M3 did not)
  // doesn't permanently block re-generating the missing closer entry.
  const existingM3RepIds = new Set(
    prevEntries
      .filter((e) => e.projectId === projectId && e.paymentStage === 'M3')
      .map((e) => e.repId)
  );

  // Guard: only draft M3 if M2 was previously created for this project.
  // Also accept Trainer-stage entries: a trainer deduction that fully zeroes
  // the closer's gross M2 removes their M2 entry (amount <= 0 is filtered),
  // leaving only a Trainer-stage entry as evidence that M2 was processed.
  const hasM2Entry = prevEntries.some(
    (e) => e.projectId === projectId && (e.paymentStage === 'M2' || e.paymentStage === 'Trainer')
  );
  if (!hasM2Entry) return [];

  // Guard against m3Amount being null in DB due to a failed persist at Installed time.
  const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const m3 = proj?.m3Amount != null && installPayPct < 100
    ? proj.m3Amount
    : installPayPct > 0 && installPayPct < 100
      ? Math.round((proj?.m2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
      : 0;

  const ts = Date.now();
  const payDate = getM3PayDate();
  const newEntries: PayrollEntry[] = [];
  const closerRep = deps.repsRef.current.find((r) => r.id === old.repId);

  // Multi-party trainer-leg resolution for M3 — mirrors the M2 logic in
  // createMilestonePayroll. Shares are derived from M2 amounts (the parties'
  // relative contribution to the deal doesn't change between milestones).
  // The rate lock pulled from prior M2 trainer entries preserves the
  // existing M2-M3 per-watt stability: if a trainer's tier stepped between
  // milestones, M3 still uses the M2 rate.
  const m3CloserParties: TrainerPartyInput[] = [
    {
      userId: old.repId,
      userName: closerRep?.name ?? old.repName,
      m2Amount: proj?.m2Amount ?? 0,
    },
    ...((proj?.additionalClosers ?? []).map((c) => ({
      userId: c.userId,
      userName: c.userName,
      m2Amount: c.m2Amount ?? 0,
    }))),
  ];
  const m3SetterParties: TrainerPartyInput[] = proj?.setterId
    ? [
        {
          userId: proj.setterId,
          userName: deps.repsRef.current.find((r) => r.id === proj.setterId)?.name ?? proj.setterName ?? '',
          m2Amount: proj.setterM2Amount ?? 0,
        },
        ...((proj.additionalSetters ?? []).map((s) => ({
          userId: s.userId,
          userName: s.userName,
          m2Amount: s.m2Amount ?? 0,
        }))),
      ]
    : ((proj?.additionalSetters ?? []).map((s) => ({
        userId: s.userId,
        userName: s.userName,
        m2Amount: s.m2Amount ?? 0,
      })));

  // Rate lock: parse the per-watt rate from each existing M2 trainer entry
  // on this project so M3 reuses it (handles mid-deal tier progression).
  const m3RateLock = new Map<string, number>();
  for (const e of prevEntries) {
    if (e.projectId !== projectId || e.paymentStage !== 'Trainer') continue;
    if (!e.notes?.startsWith('Trainer override M2')) continue;
    const match = e.notes.match(/\(\$([0-9.]+)\/W\)/);
    if (!match) continue;
    const parsed = parseFloat(match[1]);
    if (Number.isFinite(parsed)) m3RateLock.set(e.repId, parsed);
  }

  const m3TrainerLegs = (m3 > 0 && !old.subDealerId)
    ? computeTrainerLegsForMilestone({
        project: { id: projectId, trainerId: proj?.trainerId, trainerRate: proj?.trainerRate, noChainTrainer: proj?.noChainTrainer },
        closerParties: m3CloserParties,
        setterParties: m3SetterParties,
        trainerAssignments: deps.trainerAssignmentsRef.current,
        prevEntries,
        repsRef: deps.repsRef,
        kW: old.kWSize,
        milestonePct: (100 - installPayPct) / 100,
        rateLockByTrainerId: m3RateLock,
      })
    : { deductionsByUserId: new Map(), entries: [] };

  // Override-path deduction attribution (single trainer for whole deal).
  // Preserves the pre-multi-party behavior where the primary closer ate
  // the override deduction, unless self-trainer-with-setter suppressed it.
  const m3OverrideEntryAmount = m3TrainerLegs.entries.find((e) => e.isOverride)?.amount ?? 0;
  if (m3OverrideEntryAmount > 0 && m3TrainerLegs.deductionsByUserId.size === 0) {
    const overrideTrainerIsCloserSelfM3 =
      proj?.trainerId === old.repId && !!proj?.setterId;
    if (!overrideTrainerIsCloserSelfM3) {
      m3TrainerLegs.deductionsByUserId.set(old.repId, m3OverrideEntryAmount);
    }
  }
  const closerM3TrainerDeduction = m3TrainerLegs.deductionsByUserId.get(old.repId) ?? 0;

  // Closer M3 entry — only when installPayPct < 100 produces a non-zero amount
  if (m3 > 0) {
    newEntries.push({
      id: `pay_${ts}_m3_c`,
      repId: old.repId,
      repName: closerRep?.name ?? old.repName,
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, m3 - closerM3TrainerDeduction),
      type: 'Deal',
      paymentStage: 'M3',
      status: 'Draft',
      date: payDate,
      notes: '',
    });
  }

  // Setter M3 deduction is now driven by the multi-party leg map above.
  const setterM3TrainerDeduction = proj?.setterId
    ? (m3TrainerLegs.deductionsByUserId.get(proj.setterId) ?? 0)
    : 0;

  const setterM3 = proj?.setterId
    ? proj?.setterM3Amount != null && installPayPct < 100
      ? proj.setterM3Amount
      : installPayPct > 0 && installPayPct < 100
        ? Math.round((proj?.setterM2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0
    : 0;

  // Setter M3 entry
  if (proj?.setterId) {
    if (setterM3 > 0) {
      const setterRep = deps.repsRef.current.find((r) => r.id === proj.setterId);
      newEntries.push({
        id: `pay_${ts}_m3_s`,
        repId: proj.setterId,
        repName: setterRep?.name ?? proj.setterName ?? '',
        projectId,
        customerName: old.customerName,
        amount: Math.max(0, setterM3 - setterM3TrainerDeduction),
        type: 'Deal',
        paymentStage: 'M3',
        status: 'Draft',
        date: payDate,
        notes: 'Setter',
      });
    }
  }

  // ── Co-closer M3 entries (with per-party trainer deduction) ──
  for (const co of proj?.additionalClosers ?? []) {
    const amount = co.m3Amount != null && installPayPct < 100
      ? co.m3Amount
      : installPayPct > 0 && installPayPct < 100
        ? Math.round(co.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
    if (amount <= 0) continue;
    const coDeductionM3 = m3TrainerLegs.deductionsByUserId.get(co.userId) ?? 0;
    newEntries.push({
      id: `pay_${ts}_m3_cc${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, amount - coDeductionM3),
      type: 'Deal',
      paymentStage: 'M3',
      status: 'Draft',
      date: payDate,
      notes: `Co-closer #${co.position}`,
    });
  }

  // ── Co-setter M3 entries (with per-party trainer deduction) ──
  for (const co of proj?.additionalSetters ?? []) {
    const amount = co.m3Amount != null && installPayPct < 100
      ? co.m3Amount
      : installPayPct > 0 && installPayPct < 100
        ? Math.round(co.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
    if (amount <= 0) continue;
    const coDeductionM3 = m3TrainerLegs.deductionsByUserId.get(co.userId) ?? 0;
    newEntries.push({
      id: `pay_${ts}_m3_cs${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount: Math.max(0, amount - coDeductionM3),
      type: 'Deal',
      paymentStage: 'M3',
      status: 'Draft',
      date: payDate,
      notes: `Co-setter #${co.position}`,
    });
  }

  // ── Trainer override M3 entries — emit one entry per dedup'd trainer ──
  //
  // Rewritten 2026-05-23 (multi-trainer fix). Uses computeTrainerLegsForMilestone
  // with the M2-rate-lock so per-watt rates stay stable across M2 → M3 even
  // when a trainer's tier has stepped between phases.
  if (m3 > 0 && !old.subDealerId) {
    for (const entry of m3TrainerLegs.entries) {
      if (entry.amount <= 0 || !entry.trainerId) continue;
      const notesPrefix = `Trainer override M3`;
      const alreadyExists = [...prevEntries, ...newEntries].some(
        (e) =>
          e.projectId === projectId &&
          e.paymentStage === 'Trainer' &&
          e.repId === entry.trainerId &&
          e.notes?.startsWith(notesPrefix),
      );
      if (alreadyExists) continue;
      newEntries.push({
        id: `pay_${ts}_m3_trainer_${entry.trainerId.slice(-6)}`,
        repId: entry.trainerId,
        repName: entry.trainerName,
        projectId,
        customerName: old.customerName,
        amount: entry.amount,
        type: 'Deal',
        paymentStage: 'Trainer',
        status: 'Draft',
        date: payDate,
        notes: buildTrainerNotes('M3', entry.traineeNames, entry.ratePerW),
      });
    }
  }

  return newEntries.filter((e) => e.amount > 0 && (e.paymentStage === 'Trainer' || !existingM3RepIds.has(e.repId)));
}

// ─── 7. syncPayrollAmounts ───────────────────────────────────────────────────

export interface AmountSyncResult {
  updatedEntries: PayrollEntry[];
  patches: Array<{ id: string; newAmount: number }>;
}

/**
 * When m1/m2/m3 amounts are edited, updates Draft/Pending entry amounts to match.
 * Returns the full updated entries array and a list of patches to persist.
 */
export function syncPayrollAmounts(
  projectId: string,
  updates: Partial<Project>,
  prevEntries: PayrollEntry[],
  closerM2TrainerDeduction = 0,
  closerM3TrainerDeduction = 0,
  kWSize = 0,
  installPayPct = 100,
  setterM2TrainerDeduction = 0,
  setterM3TrainerDeduction = 0,
): AmountSyncResult {
  const stageAmountUpdates: Array<{ stage: 'M1' | 'M2' | 'M3'; setter: boolean; newAmount: number }> = [];
  if (updates.m1Amount !== undefined) stageAmountUpdates.push({ stage: 'M1', setter: false, newAmount: updates.m1Amount });
  if (updates.m2Amount !== undefined) stageAmountUpdates.push({ stage: 'M2', setter: false, newAmount: updates.m2Amount });
  if (updates.m3Amount !== undefined) stageAmountUpdates.push({ stage: 'M3', setter: false, newAmount: updates.m3Amount });
  if (updates.setterM1Amount !== undefined) stageAmountUpdates.push({ stage: 'M1', setter: true, newAmount: updates.setterM1Amount });
  if (updates.setterM2Amount !== undefined) stageAmountUpdates.push({ stage: 'M2', setter: true, newAmount: updates.setterM2Amount });
  if (updates.setterM3Amount !== undefined) stageAmountUpdates.push({ stage: 'M3', setter: true, newAmount: updates.setterM3Amount });

  const hasCoPartyUpdates = updates.additionalClosers !== undefined || updates.additionalSetters !== undefined;
  const hasKWSizeUpdate = updates.kWSize !== undefined;
  if (stageAmountUpdates.length === 0 && !hasCoPartyUpdates && !hasKWSizeUpdate) return { updatedEntries: prevEntries, patches: [] };

  const patches: Array<{ id: string; newAmount: number }> = [];
  const updatedEntries = prevEntries.map((e) => {
    if (e.projectId !== projectId || (e.status !== 'Draft' && e.status !== 'Pending') || e.type !== 'Deal' || (e.notes ?? '').startsWith('Chargeback')) return e;

    // Co-closer entries: match by position embedded in notes ("Co-closer #N")
    const coCloserMatch = (e.notes ?? '').match(/^Co-closer #(\d+)$/);
    if (coCloserMatch) {
      if (!updates.additionalClosers) return e;
      const position = parseInt(coCloserMatch[1], 10);
      const coParty = updates.additionalClosers.find((c) => c.position === position);
      if (!coParty) return e;
      if (e.paymentStage === 'M3' && coParty.m3Amount == null) return e;
      const newAmount = e.paymentStage === 'M2' ? coParty.m2Amount : (e.paymentStage === 'M1' ? coParty.m1Amount : (coParty.m3Amount ?? 0));
      if (newAmount === e.amount) return e;
      patches.push({ id: e.id, newAmount });
      return { ...e, amount: newAmount };
    }

    // Co-setter entries: match by position embedded in notes ("Co-setter #N")
    const coSetterMatch = (e.notes ?? '').match(/^Co-setter #(\d+)$/);
    if (coSetterMatch) {
      if (!updates.additionalSetters) return e;
      const position = parseInt(coSetterMatch[1], 10);
      const coParty = updates.additionalSetters.find((s) => s.position === position);
      if (!coParty) return e;
      if (e.paymentStage === 'M3' && coParty.m3Amount == null) return e;
      const newAmount = e.paymentStage === 'M2' ? coParty.m2Amount : (e.paymentStage === 'M1' ? coParty.m1Amount : (coParty.m3Amount ?? 0));
      if (newAmount === e.amount) return e;
      patches.push({ id: e.id, newAmount });
      return { ...e, amount: newAmount };
    }

    if (stageAmountUpdates.length === 0) return e;

    // Trainer override entries have paymentStage === 'Trainer' and never match the
    // M1/M2/M3 stageAmountUpdates. Recompute from the rate embedded in their notes.
    if (e.paymentStage === 'Trainer' && kWSize > 0) {
      const notes = e.notes ?? '';
      const isM2 = notes.startsWith('Trainer override M2') && (updates.m2Amount !== undefined || updates.setterM2Amount !== undefined || hasKWSizeUpdate);
      const isM3 = notes.startsWith('Trainer override M3') && (updates.m3Amount !== undefined || updates.setterM3Amount !== undefined || hasKWSizeUpdate);
      if (!isM2 && !isM3) return e;
      const rateMatch = notes.match(/\(\$([0-9.]+)\/W\)/);
      if (!rateMatch) return e;
      const rate = parseFloat(rateMatch[1]);
      const pct = isM2 ? (installPayPct / 100) : ((100 - installPayPct) / 100);
      const newAmount = Math.round(rate * kWSize * 1000 * pct * 100) / 100;
      if (newAmount === e.amount) return e;
      patches.push({ id: e.id, newAmount });
      return { ...e, amount: newAmount };
    }

    const match = stageAmountUpdates.find(
      (u) => u.stage === e.paymentStage && u.setter === ((e.notes ?? '').startsWith('Setter') || (e.notes ?? '').startsWith('Co-setter'))
    );
    if (!match) return e;
    const deduction = match.setter
      ? (match.stage === 'M2' ? setterM2TrainerDeduction : match.stage === 'M3' ? setterM3TrainerDeduction : 0)
      : (match.stage === 'M2' ? closerM2TrainerDeduction : match.stage === 'M3' ? closerM3TrainerDeduction : 0);
    const adjustedAmount = deduction > 0 ? Math.max(0, match.newAmount - deduction) : match.newAmount;
    if (adjustedAmount === e.amount) return e;
    patches.push({ id: e.id, newAmount: adjustedAmount });
    return { ...e, amount: adjustedAmount };
  });

  return { updatedEntries, patches };
}
