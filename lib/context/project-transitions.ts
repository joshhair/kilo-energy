/**
 * Project transition handlers — extracted from updateProject in context.tsx.
 *
 * Each function is a pure-ish helper that returns payroll mutations (entries to
 * add, ids to delete) without touching React state directly.  The orchestrator
 * in context.tsx applies the results via setPayrollEntries / setProjects.
 */

import type { Project, PayrollEntry, Phase, Rep, TrainerAssignment, InstallerPayConfig } from '../data';
import { getTrainerOverrideRate, DEFAULT_INSTALL_PAY_PCT } from '../data';
import { getM1PayDate, getM2PayDate, localDateString } from '../utils';

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

// ─── 1. mapProjectUpdateToDb ─────────────────────────────────────────────────

/** Maps the subset of Project update fields that should be persisted to the DB. */
export function mapProjectUpdateToDb(updates: Partial<Project>): Record<string, unknown> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.phase !== undefined) dbUpdates.phase = updates.phase;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
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
  if (updates.kWSize !== undefined) dbUpdates.kWSize = updates.kWSize;
  if (updates.netPPW !== undefined) dbUpdates.netPPW = updates.netPPW;
  if (updates.setterId !== undefined) dbUpdates.setterId = updates.setterId;
  if (updates.soldDate !== undefined) dbUpdates.soldDate = updates.soldDate;
  if (updates.baselineOverride !== undefined) dbUpdates.baselineOverrideJson = updates.baselineOverride ? JSON.stringify(updates.baselineOverride) : null;
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
  return (old.m3Amount ?? 0) > 0
    ? old.m3Amount!
    : installPayPct > 0
      ? Math.round(fullAmount * ((100 - installPayPct) / installPayPct) * 100) / 100
      : 0;
}

/**
 * Repair m3Amount at PTO — if Installed-time persist failed and left m3Amount null.
 * Returns the repaired value, or null if no repair is needed.
 */
export function repairM3AmountAtPTO(
  old: Project,
  updates: Partial<Project>,
  installerPayConfigs: Record<string, InstallerPayConfig>,
): number | null {
  const installPayPct = installerPayConfigs[updates.installer ?? old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  if (installPayPct >= 100) return null;
  const repairedM3 = (old.m3Amount ?? 0) > 0
    ? old.m3Amount!
    : installPayPct > 0
      ? Math.round((old.m2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
      : 0;
  return repairedM3 > 0 ? repairedM3 : null;
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
        && e.status !== 'Paid'
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
  const oldIdx = PIPELINE.indexOf(oldPhase);
  // 'On Hold' is not in PIPELINE; treat it as beyond all milestones
  const effectiveOldIdx = oldIdx >= 0 ? oldIdx : (oldPhase === 'On Hold' ? PIPELINE.length : -1);
  const newIdx = PIPELINE.indexOf(newPhase);
  if (effectiveOldIdx < 0 || newIdx < 0 || newIdx >= effectiveOldIdx) return [];

  const rollBackM1 = effectiveOldIdx >= PIPELINE.indexOf('Acceptance') && newIdx < PIPELINE.indexOf('Acceptance');
  const rollBackM2 = effectiveOldIdx >= PIPELINE.indexOf('Installed') && newIdx < PIPELINE.indexOf('Installed');
  const rollBackM3 = effectiveOldIdx >= PIPELINE.indexOf('PTO') && newIdx < PIPELINE.indexOf('PTO');
  if (!rollBackM1 && !rollBackM2 && !rollBackM3) return [];

  return prevEntries
    .filter((e) => {
      if (e.projectId !== projectId || e.status !== 'Draft') return false;
      if (rollBackM1 && e.paymentStage === 'M1') return true;
      if (rollBackM2 && (e.paymentStage === 'M2' || (e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2')))) return true;
      if (rollBackM3 && (e.paymentStage === 'M3' || (e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M3')))) return true;
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
  const freshProject = updatedProjects.find((p) => p.id === projectId)!;
  const fullAmount = isAcceptance ? old.m1Amount : freshProject.m2Amount;

  // Suppress M1 if M2 entries already exist — project previously reached Installed,
  // so this Acceptance crossing is a re-entry, not a fresh milestone.
  if (stage === 'M1' && prevEntries.some((e) => e.projectId === projectId && e.paymentStage === 'M2')) {
    return [];
  }
  const alreadyExists = prevEntries.some(
    (e) => e.projectId === projectId && e.paymentStage === stage
  );
  if (alreadyExists) return [];

  const ts = Date.now();
  const newEntries: PayrollEntry[] = [];
  const closerRep = deps.repsRef.current.find((r) => r.id === old.repId);

  // Closer entry (skip M1 when a setter exists — M1 goes entirely to the setter)
  if ((fullAmount ?? 0) > 0 && !(isAcceptance && old.setterId)) {
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_c`,
      repId: old.repId,
      repName: closerRep?.name ?? old.repName,
      projectId,
      customerName: old.customerName,
      amount: fullAmount!,
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: '',
    });
  }

  // Setter entry (M1 goes to setter if one exists)
  if (old.setterId && isAcceptance && (old.setterM1Amount ?? 0) > 0) {
    const setterRep = deps.repsRef.current.find((r) => r.id === old.setterId);
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_s`,
      repId: old.setterId,
      repName: setterRep?.name ?? old.setterName ?? '',
      projectId,
      customerName: old.customerName,
      amount: old.setterM1Amount!,
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: 'Setter',
    });
  }

  // Setter entry (M2 at Installed — setterM2Amount is already post-installPayPct)
  if (old.setterId && isInstalled && (freshProject.setterM2Amount ?? 0) > 0) {
    const setterRep = deps.repsRef.current.find((r) => r.id === old.setterId);
    newEntries.push({
      id: `pay_${ts}_m2_s`,
      repId: old.setterId,
      repName: setterRep?.name ?? old.setterName ?? '',
      projectId,
      customerName: old.customerName,
      amount: freshProject.setterM2Amount!,
      type: 'Deal',
      paymentStage: 'M2',
      status: 'Draft',
      date: payDate,
      notes: 'Setter',
    });
  }

  // ── Trainer override M2 entries (installPayPct% of override at Installed) ──
  if (isInstalled) {
    // Closer's trainer
    const closerTrainerAssignment = deps.trainerAssignmentsRef.current.find(a => a.traineeId === old.repId);
    if (closerTrainerAssignment) {
      const trainerRep = deps.repsRef.current.find(r => r.id === closerTrainerAssignment.trainerId);
      const traineeDeals = updatedProjects.filter(p => (p.repId === closerTrainerAssignment.traineeId || p.setterId === closerTrainerAssignment.traineeId) && ((deps.installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length;
      const overrideRate = getTrainerOverrideRate(closerTrainerAssignment, traineeDeals);
      const m2TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
      const closerTrainerAlreadyExists = prevEntries.some(
        (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === closerTrainerAssignment.trainerId && e.status !== 'Draft'
      );
      if (m2TrainerAmount > 0 && !closerTrainerAlreadyExists) {
        newEntries.push({
          id: `pay_${ts}_m2_trainer_c`,
          repId: closerTrainerAssignment.trainerId,
          repName: trainerRep?.name ?? '',
          projectId,
          customerName: old.customerName,
          amount: m2TrainerAmount,
          type: 'Deal',
          paymentStage: 'Trainer',
          status: 'Draft',
          date: payDate,
          notes: `Trainer override M2 — ${closerRep?.name ?? old.repName} ($${overrideRate.toFixed(2)}/W)`,
        });
      }
    }

    // Setter's trainer
    if (old.setterId) {
      const setterTrainerAssignment = deps.trainerAssignmentsRef.current.find(a => a.traineeId === old.setterId);
      if (setterTrainerAssignment) {
        const setterTrainerRep = deps.repsRef.current.find(r => r.id === setterTrainerAssignment.trainerId);
        const setterTraineeDeals = updatedProjects.filter(p => (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) && ((deps.installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length;
        const setterOverrideRate = getTrainerOverrideRate(setterTrainerAssignment, setterTraineeDeals);
        const m2SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
        const setterTrainerAlreadyExists = prevEntries.some(
          (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === setterTrainerAssignment.trainerId && e.status !== 'Draft'
        );
        if (m2SetterTrainerAmount > 0 && !setterTrainerAlreadyExists) {
          const setterRep = deps.repsRef.current.find(r => r.id === old.setterId);
          newEntries.push({
            id: `pay_${ts}_m2_trainer_s`,
            repId: setterTrainerAssignment.trainerId,
            repName: setterTrainerRep?.name ?? '',
            projectId,
            customerName: old.customerName,
            amount: m2SetterTrainerAmount,
            type: 'Deal',
            paymentStage: 'Trainer',
            status: 'Draft',
            date: payDate,
            notes: `Trainer override M2 — ${setterRep?.name ?? old.setterName ?? ''} ($${setterOverrideRate.toFixed(2)}/W)`,
          });
        }
      }
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

  const m3AlreadyExists = prevEntries.some(
    (e) => e.projectId === projectId && e.paymentStage === 'M3'
  );
  if (m3AlreadyExists) return [];

  const trainerM3AlreadyExists = prevEntries.some(
    (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M3')
  );

  // Guard: only draft M3 if M2 was previously created for this project.
  const hasM2Entry = prevEntries.some(
    (e) => e.projectId === projectId && e.paymentStage === 'M2'
  );
  if (!hasM2Entry) return [];

  // Guard against m3Amount being null in DB due to a failed persist at Installed time.
  const installPayPct = installerPayConfigs[old.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const m3 = (proj?.m3Amount ?? 0) > 0 && installPayPct < 100
    ? proj!.m3Amount!
    : installPayPct > 0 && installPayPct < 100
      ? Math.round((proj?.m2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
      : 0;

  const ts = Date.now();
  const payDate = getM2PayDate(); // M3 follows the same Saturday cutoff as M2
  const newEntries: PayrollEntry[] = [];
  const closerRep = deps.repsRef.current.find((r) => r.id === old.repId);

  // Closer M3 entry — only when installPayPct < 100 produces a non-zero amount
  if (m3 > 0) {
    newEntries.push({
      id: `pay_${ts}_m3_c`,
      repId: old.repId,
      repName: closerRep?.name ?? old.repName,
      projectId,
      customerName: old.customerName,
      amount: m3,
      type: 'Deal',
      paymentStage: 'M3',
      status: 'Draft',
      date: payDate,
      notes: '',
    });
  }

  // Setter M3 entry
  if (old.setterId) {
    const setterM3 = (old.setterM3Amount ?? 0) > 0
      ? old.setterM3Amount!
      : installPayPct > 0 && installPayPct < 100
        ? Math.round((proj?.setterM2Amount ?? 0) * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
    if (setterM3 > 0) {
      const setterRep = deps.repsRef.current.find((r) => r.id === old.setterId);
      newEntries.push({
        id: `pay_${ts}_m3_s`,
        repId: old.setterId,
        repName: setterRep?.name ?? old.setterName ?? '',
        projectId,
        customerName: old.customerName,
        amount: setterM3,
        type: 'Deal',
        paymentStage: 'M3',
        status: 'Draft',
        date: payDate,
        notes: 'Setter',
      });
    }
  }

  // ── Trainer override M3 entries ((100 - installPayPct)% of override at PTO) ──
  // Closer's trainer — gated by m3 > 0, which is 0 for sub-dealer deals
  const closerTrainerAssignment = deps.trainerAssignmentsRef.current.find(a => a.traineeId === old.repId);
  if (closerTrainerAssignment && m3 > 0 && !trainerM3AlreadyExists) {
    const trainerRep = deps.repsRef.current.find(r => r.id === closerTrainerAssignment.trainerId);
    // Lock to the M2 rate so M2+M3 use the same per-watt tier for this project
    const m2CloserTrainerEntry = prevEntries.find(e => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === closerTrainerAssignment.trainerId);
    const m2CloserRateMatch = m2CloserTrainerEntry?.notes?.match(/\(\$([0-9.]+)\/W\)/);
    const m2CloserParsed = m2CloserRateMatch ? parseFloat(m2CloserRateMatch[1]) : NaN;
    const overrideRate = !isNaN(m2CloserParsed)
      ? m2CloserParsed
      : getTrainerOverrideRate(closerTrainerAssignment, updatedProjects.filter(p => (p.repId === closerTrainerAssignment.traineeId || p.setterId === closerTrainerAssignment.traineeId) && ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length);
    const m3TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
    if (m3TrainerAmount > 0) {
      newEntries.push({
        id: `pay_${ts}_m3_trainer_c`,
        repId: closerTrainerAssignment.trainerId,
        repName: trainerRep?.name ?? '',
        projectId,
        customerName: old.customerName,
        amount: m3TrainerAmount,
        type: 'Deal',
        paymentStage: 'Trainer',
        status: 'Draft',
        date: payDate,
        notes: `Trainer override M3 — ${closerRep?.name ?? old.repName} ($${overrideRate.toFixed(2)}/W)`,
      });
    }
  }

  // Setter's trainer — guarded by !old.subDealerId to match closer's trainer
  if (old.setterId && !old.subDealerId && !trainerM3AlreadyExists) {
    const setterTrainerAssignment = deps.trainerAssignmentsRef.current.find(a => a.traineeId === old.setterId);
    if (setterTrainerAssignment) {
      const setterTrainerRep = deps.repsRef.current.find(r => r.id === setterTrainerAssignment.trainerId);
      // Lock to the M2 rate so M2+M3 use the same per-watt tier for this project
      const setterTraineeName = deps.repsRef.current.find(r => r.id === old.setterId)?.name ?? old.setterName ?? '';
      const m2SetterTrainerEntry = prevEntries.find(e => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === setterTrainerAssignment.trainerId && (setterTraineeName ? e.notes?.includes(`— ${setterTraineeName} (`) : true));
      const m2SetterRateMatch = m2SetterTrainerEntry?.notes?.match(/\(\$([0-9.]+)\/W\)/);
      const m2SetterParsed = m2SetterRateMatch ? parseFloat(m2SetterRateMatch[1]) : NaN;
      const setterOverrideRate = !isNaN(m2SetterParsed)
        ? m2SetterParsed
        : getTrainerOverrideRate(setterTrainerAssignment, updatedProjects.filter(p => (p.repId === setterTrainerAssignment.traineeId || p.setterId === setterTrainerAssignment.traineeId) && ((installerPayConfigs[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT) < 100 ? p.m3Paid === true : p.m2Paid === true)).length);
      const m3SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
      if (m3SetterTrainerAmount > 0) {
        const setterRep = deps.repsRef.current.find(r => r.id === old.setterId);
        newEntries.push({
          id: `pay_${ts}_m3_trainer_s`,
          repId: setterTrainerAssignment.trainerId,
          repName: setterTrainerRep?.name ?? '',
          projectId,
          customerName: old.customerName,
          amount: m3SetterTrainerAmount,
          type: 'Deal',
          paymentStage: 'Trainer',
          status: 'Draft',
          date: payDate,
          notes: `Trainer override M3 — ${setterRep?.name ?? old.setterName ?? ''} ($${setterOverrideRate.toFixed(2)}/W)`,
        });
      }
    }
  }

  return newEntries.filter((e) => e.amount > 0);
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
): AmountSyncResult {
  const stageAmountUpdates: Array<{ stage: 'M1' | 'M2' | 'M3'; setter: boolean; newAmount: number }> = [];
  if (updates.m1Amount !== undefined) stageAmountUpdates.push({ stage: 'M1', setter: false, newAmount: updates.m1Amount });
  if (updates.m2Amount !== undefined) stageAmountUpdates.push({ stage: 'M2', setter: false, newAmount: updates.m2Amount });
  if (updates.m3Amount !== undefined) stageAmountUpdates.push({ stage: 'M3', setter: false, newAmount: updates.m3Amount });
  if (updates.setterM1Amount !== undefined) stageAmountUpdates.push({ stage: 'M1', setter: true, newAmount: updates.setterM1Amount });
  if (updates.setterM2Amount !== undefined) stageAmountUpdates.push({ stage: 'M2', setter: true, newAmount: updates.setterM2Amount });
  if (updates.setterM3Amount !== undefined) stageAmountUpdates.push({ stage: 'M3', setter: true, newAmount: updates.setterM3Amount });

  if (stageAmountUpdates.length === 0) return { updatedEntries: prevEntries, patches: [] };

  const patches: Array<{ id: string; newAmount: number }> = [];
  const updatedEntries = prevEntries.map((e) => {
    if (e.projectId !== projectId || (e.status !== 'Draft' && e.status !== 'Pending') || e.type !== 'Deal' || (e.notes ?? '').startsWith('Chargeback')) return e;
    const match = stageAmountUpdates.find(
      (u) => u.stage === e.paymentStage && u.setter === (e.notes === 'Setter')
    );
    if (!match || match.newAmount === e.amount) return e;
    patches.push({ id: e.id, newAmount: match.newAmount });
    return { ...e, amount: match.newAmount };
  });

  return { updatedEntries, patches };
}
