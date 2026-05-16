/**
 * Project transition handlers — extracted from updateProject in context.tsx.
 *
 * Each function is a pure-ish helper that returns payroll mutations (entries to
 * add, ids to delete) without touching React state directly.  The orchestrator
 * in context.tsx applies the results via setPayrollEntries / setProjects.
 */

import type { Project, PayrollEntry, Phase, Rep, TrainerAssignment, InstallerPayConfig } from '../data';
import { resolveTrainerRate, DEFAULT_INSTALL_PAY_PCT } from '../data';
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
  if (updates.kWSize !== undefined) dbUpdates.kWSize = updates.kWSize;
  if (updates.netPPW !== undefined) dbUpdates.netPPW = updates.netPPW;
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
  const closerRep = deps.repsRef.current.find((r) => r.id === old.repId);

  // Per-rep dedup helper: skip if this rep already has an entry for this project+stage.
  const repAlreadyExists = (repId: string) =>
    prevEntries.some((e) => e.projectId === projectId && e.paymentStage === stage && e.repId === repId);

  // Pre-compute closer trainer deduction for M2 so the trainer's cut comes out of
  // the closer's share rather than being paid on top (mirrors setter's splitPoint logic).
  // Self-trainer-with-setter guard: when the resolved trainer is the closer
  // themselves AND a setter exists, the setter-trainer leg owns this override
  // (deducted from setter pay via splitPoint). Deducting again from closer
  // pay would double-debit the closer. Self-gen (no setter) still applies
  // the deduction — that's a literal self-loop the dropdown filter prevented
  // historically; preserved here for backward compatibility.
  let closerM2TrainerDeduction = 0;
  if (isInstalled) {
    const res = resolveTrainerRate(
      { id: projectId, trainerId: freshProject.trainerId, trainerRate: freshProject.trainerRate },
      old.repId,
      deps.trainerAssignmentsRef.current,
      prevEntries,
    );
    const selfTrainerWithSetter = res.trainerId === old.repId && !!freshProject.setterId;
    if (res.rate > 0 && !selfTrainerWithSetter) {
      closerM2TrainerDeduction = Math.round(res.rate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
    }
  }

  // Closer entry (skip M1 only when a setter exists AND will receive an M1 entry — M1 goes entirely to the setter)
  // Use freshProject.setterId (post-update) so a simultaneously-added setter suppresses the closer M1.
  if ((fullAmount ?? 0) > 0 && !(isAcceptance && freshProject.setterId && (freshProject.setterM1Amount ?? 0) > 0) && !repAlreadyExists(old.repId)) {
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_c`,
      repId: old.repId,
      repName: closerRep?.name ?? old.repName,
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

  // Pre-compute setter trainer deduction for M2 so the trainer's cut comes out of
  // the setter's share rather than being paid on top (mirrors closerM2TrainerDeduction).
  // Mirrors the override-aware logic used for the setter trainer ENTRY below (lines ~504-517):
  // resolve via tier chain first, then apply the project override if it targets the same trainer.
  let setterM2TrainerDeduction = 0;
  if (isInstalled && freshProject.setterId) {
    const setterDeductRaw = resolveTrainerRate(
      { id: projectId, trainerId: null, trainerRate: null },
      freshProject.setterId,
      deps.trainerAssignmentsRef.current,
      prevEntries,
    );
    const overrideMatchesSetter =
      freshProject.trainerId &&
      freshProject.trainerRate != null &&
      setterDeductRaw.trainerId === freshProject.trainerId;
    const effectiveSetterDeductRate = overrideMatchesSetter
      ? freshProject.trainerRate!
      : setterDeductRaw.rate;
    if (effectiveSetterDeductRate > 0) {
      setterM2TrainerDeduction = Math.round(effectiveSetterDeductRate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
    }
  }

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
  for (const co of freshProject.additionalClosers ?? []) {
    const amount = isAcceptance ? (co.m1Amount ?? 0) : (co.m2Amount ?? 0);
    if (amount <= 0) continue;
    if (isAcceptance && freshProject.setterId && (freshProject.setterM1Amount ?? 0) > 0) continue;
    if (repAlreadyExists(co.userId)) continue;
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_cc${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount,
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: `Co-closer #${co.position}`,
    });
  }

  // ── Co-setter entries ── Additional setters get M1 at Acceptance and
  // M2 at Installed, mirroring the primary setter's cadence. No
  // trainer-deduction logic applied (co-parties don't stack with trainer
  // overrides in the current design — revisit if business needs it).
  for (const co of freshProject.additionalSetters ?? []) {
    const amount = isAcceptance ? (co.m1Amount ?? 0) : (co.m2Amount ?? 0);
    if (amount <= 0) continue;
    if (repAlreadyExists(co.userId)) continue;
    newEntries.push({
      id: `pay_${ts}_${stage.toLowerCase()}_cs${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount,
      type: 'Deal',
      paymentStage: stage,
      status: 'Draft',
      date: payDate,
      notes: `Co-setter #${co.position}`,
    });
  }

  // ── Trainer override M2 entries (installPayPct% of override at Installed) ──
  if (isInstalled) {
    // Closer's trainer — honors the per-project override (project.trainerId +
    // project.trainerRate) before falling back to the tier chain.
    const closerRes = resolveTrainerRate(
      { id: projectId, trainerId: freshProject.trainerId, trainerRate: freshProject.trainerRate },
      old.repId,
      deps.trainerAssignmentsRef.current,
      prevEntries,
    );
    // Self-trainer-with-setter guard: same rule as the M2 deduction
    // above — if the trainer IS the closer AND a setter is present,
    // the setter-trainer leg (below) emits the entry that pays this
    // person. Emitting here too would double-pay.
    const closerSelfTrainerWithSetter = closerRes.trainerId === old.repId && !!freshProject.setterId;
    if (closerRes.rate > 0 && closerRes.trainerId && !closerSelfTrainerWithSetter) {
      const trainerRep = deps.repsRef.current.find(r => r.id === closerRes.trainerId);
      const m2TrainerAmount = Math.round(closerRes.rate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
      const closerTraineeNotesPrefix = `Trainer override M2 — ${closerRep?.name ?? old.repName ?? ''}`;
      const closerTrainerAlreadyExists = [...prevEntries, ...newEntries].some(
        (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith(closerTraineeNotesPrefix) && e.repId === closerRes.trainerId
      );
      if (m2TrainerAmount > 0 && !closerTrainerAlreadyExists) {
        newEntries.push({
          id: `pay_${ts}_m2_trainer_c`,
          repId: closerRes.trainerId,
          repName: trainerRep?.name ?? '',
          projectId,
          customerName: old.customerName,
          amount: m2TrainerAmount,
          type: 'Deal',
          paymentStage: 'Trainer',
          status: 'Draft',
          date: payDate,
          notes: `Trainer override M2 — ${closerRep?.name ?? old.repName} ($${closerRes.rate.toFixed(2)}/W)`,
        });
      }
    }

    // Setter's trainer — first resolve via tier chain, then apply the
    // per-project override if it targets the same trainer. Previously
    // this slot ignored the project override entirely, so a manual
    // $0.10/W override on Hunter was shadowed by Hunter's $0.20/W
    // tier rate when Hunter was resolved for the setter slot.
    // Fixed 2026-04-24 (Josh's Chris Abbott / Hunter Helton case).
    if (freshProject.setterId) {
      const setterResRaw = resolveTrainerRate(
        { id: projectId, trainerId: null, trainerRate: null },
        freshProject.setterId,
        deps.trainerAssignmentsRef.current,
        prevEntries,
      );
      const overrideAppliesToSetter =
        freshProject.trainerId &&
        freshProject.trainerRate != null &&
        setterResRaw.trainerId === freshProject.trainerId;
      const setterRes = overrideAppliesToSetter
        ? { rate: freshProject.trainerRate!, trainerId: freshProject.trainerId!, reason: 'project-override' as const }
        : setterResRaw;
      if (setterRes.rate > 0 && setterRes.trainerId) {
        const setterTrainerRep = deps.repsRef.current.find(r => r.id === setterRes.trainerId);
        const m2SetterTrainerAmount = Math.round(setterRes.rate * old.kWSize * 1000 * (installPayPct / 100) * 100) / 100;
        const setterRep = deps.repsRef.current.find(r => r.id === freshProject.setterId);
        const setterTraineeNotesPrefix = `Trainer override M2 — ${setterRep?.name ?? freshProject.setterName ?? ''}`;
        const setterTrainerAlreadyExists = [...prevEntries, ...newEntries].some(
          (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith(setterTraineeNotesPrefix) && e.repId === setterRes.trainerId
        );
        if (m2SetterTrainerAmount > 0 && !setterTrainerAlreadyExists) {
          newEntries.push({
            id: `pay_${ts}_m2_trainer_s`,
            repId: setterRes.trainerId,
            repName: setterTrainerRep?.name ?? '',
            projectId,
            customerName: old.customerName,
            amount: m2SetterTrainerAmount,
            type: 'Deal',
            paymentStage: 'Trainer',
            status: 'Draft',
            date: payDate,
            notes: `Trainer override M2 — ${setterRep?.name ?? freshProject.setterName ?? ''} ($${setterRes.rate.toFixed(2)}/W)`,
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

  // Role-specific guard: track which repIds already have an M3 entry so a
  // partial network failure (e.g. setter M3 persisted but closer M3 did not)
  // doesn't permanently block re-generating the missing closer entry.
  const existingM3RepIds = new Set(
    prevEntries
      .filter((e) => e.projectId === projectId && e.paymentStage === 'M3')
      .map((e) => e.repId)
  );

  // Guard: only draft M3 if M2 was previously created for this project.
  const hasM2Entry = prevEntries.some(
    (e) => e.projectId === projectId && e.paymentStage === 'M2'
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

  // Pre-compute closer M3 trainer deduction so trainer's cut comes out of
  // the closer's share rather than being paid on top (mirrors M2 deduction logic).
  // Lock to the M2 entry's rate when one exists so M2+M3 use the same per-watt
  // tier for this project; otherwise delegate to the resolver.
  let closerM3TrainerDeduction = 0;
  if (m3 > 0) {
    const closerResM3 = resolveTrainerRate(
      { id: projectId, trainerId: old.trainerId, trainerRate: old.trainerRate },
      old.repId,
      deps.trainerAssignmentsRef.current,
      prevEntries,
    );
    // Self-trainer-with-setter guard mirrors the M2 deduction rule.
    const closerSelfTrainerWithSetterM3 = closerResM3.trainerId === old.repId && !!proj?.setterId;
    if (closerResM3.rate > 0 && closerResM3.trainerId && !closerSelfTrainerWithSetterM3) {
      const m2CloserTrainerEntryForM3 = prevEntries.find(e => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === closerResM3.trainerId);
      const m2RateMatchForM3 = m2CloserTrainerEntryForM3?.notes?.match(/\(\$([0-9.]+)\/W\)/);
      const m2ParsedForM3 = m2RateMatchForM3 ? parseFloat(m2RateMatchForM3[1]) : NaN;
      const m3OverrideRate = !isNaN(m2ParsedForM3) ? m2ParsedForM3 : closerResM3.rate;
      closerM3TrainerDeduction = Math.round(m3OverrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
    }
  }

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

  // Pre-compute setter M3 trainer deduction so the trainer's cut comes from the
  // setter's share rather than being paid on top (mirrors closerM3TrainerDeduction).
  // Lock to the M2 entry's rate when one exists; fall back to the override-aware rate
  // (mirrors the setter M2 deduction logic above).
  let setterM3TrainerDeduction = 0;
  if (proj?.setterId) {
    const setterResM3Raw = resolveTrainerRate(
      { id: projectId, trainerId: null, trainerRate: null },
      proj.setterId,
      deps.trainerAssignmentsRef.current,
      prevEntries,
    );
    if (setterResM3Raw.rate > 0 && setterResM3Raw.trainerId) {
      const m2SetterTrainerEntryForM3 = prevEntries.find(e => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === setterResM3Raw.trainerId);
      const m2SetterRateMatchForM3 = m2SetterTrainerEntryForM3?.notes?.match(/\(\$([0-9.]+)\/W\)/);
      const m2SetterParsedForM3 = m2SetterRateMatchForM3 ? parseFloat(m2SetterRateMatchForM3[1]) : NaN;
      const overrideMatchesSetterM3 =
        old.trainerId &&
        old.trainerRate != null &&
        setterResM3Raw.trainerId === old.trainerId;
      const fallbackRate = overrideMatchesSetterM3 ? old.trainerRate! : setterResM3Raw.rate;
      const setterM3OverrideRate = !isNaN(m2SetterParsedForM3) ? m2SetterParsedForM3 : fallbackRate;
      setterM3TrainerDeduction = Math.round(setterM3OverrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
    }
  }

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

  // ── Co-closer M3 entries ──
  for (const co of proj?.additionalClosers ?? []) {
    const amount = co.m3Amount != null && installPayPct < 100
      ? co.m3Amount
      : installPayPct > 0 && installPayPct < 100
        ? Math.round(co.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
    if (amount <= 0) continue;
    newEntries.push({
      id: `pay_${ts}_m3_cc${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount,
      type: 'Deal',
      paymentStage: 'M3',
      status: 'Draft',
      date: payDate,
      notes: `Co-closer #${co.position}`,
    });
  }

  // ── Co-setter M3 entries ──
  for (const co of proj?.additionalSetters ?? []) {
    const amount = co.m3Amount != null && installPayPct < 100
      ? co.m3Amount
      : installPayPct > 0 && installPayPct < 100
        ? Math.round(co.m2Amount * ((100 - installPayPct) / installPayPct) * 100) / 100
        : 0;
    if (amount <= 0) continue;
    newEntries.push({
      id: `pay_${ts}_m3_cs${co.position}`,
      repId: co.userId,
      repName: co.userName,
      projectId,
      customerName: old.customerName,
      amount,
      type: 'Deal',
      paymentStage: 'M3',
      status: 'Draft',
      date: payDate,
      notes: `Co-setter #${co.position}`,
    });
  }

  // ── Trainer override M3 entries ((100 - installPayPct)% of override at PTO) ──
  // Closer's trainer — gated by m3 > 0, which is 0 for sub-dealer deals.
  // Honors the per-project override before falling back to the tier chain.
  const closerResM3Entry = resolveTrainerRate(
    { id: projectId, trainerId: old.trainerId, trainerRate: old.trainerRate },
    old.repId,
    deps.trainerAssignmentsRef.current,
    prevEntries,
  );
  const closerTrainerM3AlreadyExists = closerResM3Entry.trainerId ? [...prevEntries, ...newEntries].some(
    (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M3') && e.repId === closerResM3Entry.trainerId
  ) : false;
  const closerSelfTrainerWithSetterM3Entry = closerResM3Entry.trainerId === old.repId && !!proj?.setterId;
  if (closerResM3Entry.rate > 0 && closerResM3Entry.trainerId && m3 > 0 && !old.subDealerId && !closerTrainerM3AlreadyExists && !closerSelfTrainerWithSetterM3Entry) {
    const trainerRep = deps.repsRef.current.find(r => r.id === closerResM3Entry.trainerId);
    // Lock to the M2 rate so M2+M3 use the same per-watt tier for this project
    const m2CloserTrainerEntry = prevEntries.find(e => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === closerResM3Entry.trainerId);
    const m2CloserRateMatch = m2CloserTrainerEntry?.notes?.match(/\(\$([0-9.]+)\/W\)/);
    const m2CloserParsed = m2CloserRateMatch ? parseFloat(m2CloserRateMatch[1]) : NaN;
    const overrideRate = !isNaN(m2CloserParsed) ? m2CloserParsed : closerResM3Entry.rate;
    const m3TrainerAmount = Math.round(overrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
    if (m3TrainerAmount > 0) {
      newEntries.push({
        id: `pay_${ts}_m3_trainer_c`,
        repId: closerResM3Entry.trainerId,
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

  // Setter's trainer — guarded by !old.subDealerId to match closer's trainer.
  // Project-level override applies when it targets the same trainer the
  // tier chain resolves to. Fixed 2026-04-24 in parallel with the M2
  // path (see earlier block) so setter-side override behavior matches.
  if (proj?.setterId && !old.subDealerId) {
    const setterResM3EntryRaw = resolveTrainerRate(
      { id: projectId, trainerId: null, trainerRate: null },
      proj.setterId,
      deps.trainerAssignmentsRef.current,
      prevEntries,
    );
    const m3OverrideAppliesToSetter =
      proj.trainerId &&
      proj.trainerRate != null &&
      setterResM3EntryRaw.trainerId === proj.trainerId;
    const setterResM3Entry = m3OverrideAppliesToSetter
      ? { rate: proj.trainerRate!, trainerId: proj.trainerId!, reason: 'project-override' as const }
      : setterResM3EntryRaw;
    const setterTraineeName = deps.repsRef.current.find(r => r.id === proj.setterId)?.name ?? proj.setterName ?? '';
    const setterTraineeNotesPrefix = `Trainer override M3 — ${setterTraineeName}`;
    const setterTrainerM3AlreadyExists = setterResM3Entry.trainerId ? [...prevEntries, ...newEntries].some(
      (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith(setterTraineeNotesPrefix) && e.repId === setterResM3Entry.trainerId
    ) : false;
    if (setterResM3Entry.rate > 0 && setterResM3Entry.trainerId && setterM3 > 0 && !setterTrainerM3AlreadyExists) {
      const setterTrainerRep = deps.repsRef.current.find(r => r.id === setterResM3Entry.trainerId);
      // Lock to the M2 rate so M2+M3 use the same per-watt tier for this project
      const m2SetterTrainerEntry = prevEntries.find(e => e.projectId === projectId && e.paymentStage === 'Trainer' && e.notes?.startsWith('Trainer override M2') && e.repId === setterResM3Entry.trainerId && (setterTraineeName ? e.notes?.includes(`— ${setterTraineeName} (`) : true));
      const m2SetterRateMatch = m2SetterTrainerEntry?.notes?.match(/\(\$([0-9.]+)\/W\)/);
      const m2SetterParsed = m2SetterRateMatch ? parseFloat(m2SetterRateMatch[1]) : NaN;
      const setterOverrideRate = !isNaN(m2SetterParsed) ? m2SetterParsed : setterResM3Entry.rate;
      const m3SetterTrainerAmount = Math.round(setterOverrideRate * old.kWSize * 1000 * ((100 - installPayPct) / 100) * 100) / 100;
      if (m3SetterTrainerAmount > 0) {
        const setterRep = deps.repsRef.current.find(r => r.id === proj.setterId);
        newEntries.push({
          id: `pay_${ts}_m3_trainer_s`,
          repId: setterResM3Entry.trainerId,
          repName: setterTrainerRep?.name ?? '',
          projectId,
          customerName: old.customerName,
          amount: m3SetterTrainerAmount,
          type: 'Deal',
          paymentStage: 'Trainer',
          status: 'Draft',
          date: payDate,
          notes: `Trainer override M3 — ${setterRep?.name ?? proj.setterName ?? ''} ($${setterOverrideRate.toFixed(2)}/W)`,
        });
      }
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
