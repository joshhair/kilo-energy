/**
 * audit-orphaned-trainer-deals.mts — find Glide-imported projects that
 * SHOULD have trainer-stage payroll entries but don't.
 *
 * The ops cleanup target. Two kinds of orphans surfaced:
 *
 * 1. "Has rep-level trainer, no project-level trainerId, no Trainer payroll"
 *    The closer or setter is in a TrainerAssignment chain → the engine
 *    should have generated Trainer-stage entries when M2 fired. If the
 *    project is past M2 (Installed/PTO/Completed) and has zero Trainer
 *    entries, it's a Glide-import gap.
 *
 * 2. "Has project-level trainerId, no Trainer payroll"
 *    Admin attached a trainer to the project but the project is past M2
 *    and no Trainer payroll exists yet.
 *
 * Read-only. Reports the list — admin clicks through each one via the
 * project detail page's new Record Trainer Payment modal to backfill.
 *
 * Usage:
 *   npx tsx scripts/prod-read/audit-orphaned-trainer-deals.mts
 */

import { readDb, logQuery } from './index.mts';

const POST_M2_PHASES = ['Installed', 'PTO', 'Completed'];

const dollar = (n: number) => '$' + Math.round(n).toLocaleString();

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ORPHANED TRAINER-DEAL AUDIT (Glide cleanup target)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Projects past M2 (M2 should have fired Trainer payroll if any trainer
  // was attached). Exclude Cancelled / On Hold — those don't get trainer
  // payroll anyway.
  const projects = await readDb.project.findMany({
    where: {
      phase: { in: POST_M2_PHASES },
    },
    select: {
      id: true,
      customerName: true,
      phase: true,
      kWSize: true,
      soldDate: true,
      closerId: true,
      setterId: true,
      trainerId: true,
      trainerRate: true,
      installer: { select: { name: true, installPayPct: true } },
      additionalClosers: { select: { userId: true } },
      additionalSetters: { select: { userId: true } },
    },
  });
  logQuery('projects.post-m2', { POST_M2_PHASES }, projects.length);

  // Pull all Trainer-stage payroll entries up front so we can index by projectId.
  const trainerEntries = await readDb.payrollEntry.findMany({
    where: { paymentStage: 'Trainer' },
    select: { projectId: true, repId: true, amountCents: true, status: true },
  });
  logQuery('payroll.trainer', {}, trainerEntries.length);
  const trainerByProject = new Map<string, typeof trainerEntries>();
  for (const e of trainerEntries) {
    if (!e.projectId) continue;
    const arr = trainerByProject.get(e.projectId) ?? [];
    arr.push(e);
    trainerByProject.set(e.projectId, arr);
  }

  // TrainerAssignments — index by traineeId for fast lookup.
  const assignments = await readDb.trainerAssignment.findMany({
    select: {
      id: true,
      trainerId: true,
      traineeId: true,
      isActiveTraining: true,
      trainer: { select: { firstName: true, lastName: true } },
      tiers: { orderBy: { sortOrder: 'asc' }, select: { upToDeal: true, ratePerW: true } },
    },
  });
  logQuery('trainerAssignments', {}, assignments.length);
  const asgByTrainee = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const arr = asgByTrainee.get(a.traineeId) ?? [];
    arr.push(a);
    asgByTrainee.set(a.traineeId, arr);
  }

  // Friendly user names for reporting.
  const users = await readDb.user.findMany({
    select: { id: true, firstName: true, lastName: true },
  });
  const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  type Orphan = {
    projectId: string;
    customerName: string;
    phase: string;
    kWSize: number;
    soldDate: string;
    installerName: string;
    installPayPct: number;
    cause: 'project-trainer' | 'closer-assignment' | 'setter-assignment' | 'co-party-assignment';
    expectedTrainerId: string;
    expectedTrainerName: string;
    expectedRate: number;
    projectedAmount: number;
  };
  const orphans: Orphan[] = [];

  for (const p of projects) {
    const existing = trainerByProject.get(p.id) ?? [];
    if (existing.length > 0) continue; // already has trainer payroll

    const installerName = (p.installer as { name?: string })?.name ?? 'Unknown';
    const installPayPct = (p.installer as { installPayPct?: number })?.installPayPct ?? 80;

    // Cause 1: project-level trainerId set, no Trainer payroll yet.
    if (p.trainerId && (p.trainerRate ?? 0) > 0) {
      const projected = (p.trainerRate ?? 0) * p.kWSize * 1000;
      orphans.push({
        projectId: p.id,
        customerName: p.customerName,
        phase: p.phase,
        kWSize: p.kWSize,
        soldDate: p.soldDate,
        installerName,
        installPayPct,
        cause: 'project-trainer',
        expectedTrainerId: p.trainerId,
        expectedTrainerName: userName.get(p.trainerId) ?? '(unknown)',
        expectedRate: p.trainerRate ?? 0,
        projectedAmount: projected,
      });
      continue;
    }

    // Cause 2: closer has an active TrainerAssignment.
    const closerAsg = p.closerId ? asgByTrainee.get(p.closerId) : null;
    const activeCloserAsg = closerAsg?.find((a) => a.isActiveTraining !== false);
    if (activeCloserAsg) {
      const rate = activeCloserAsg.tiers[0]?.ratePerW ?? 0;
      const projected = rate * p.kWSize * 1000;
      orphans.push({
        projectId: p.id,
        customerName: p.customerName,
        phase: p.phase,
        kWSize: p.kWSize,
        soldDate: p.soldDate,
        installerName,
        installPayPct,
        cause: 'closer-assignment',
        expectedTrainerId: activeCloserAsg.trainerId,
        expectedTrainerName: `${activeCloserAsg.trainer?.firstName ?? ''} ${activeCloserAsg.trainer?.lastName ?? ''}`.trim(),
        expectedRate: rate,
        projectedAmount: projected,
      });
      continue;
    }

    // Cause 3: setter has an active TrainerAssignment.
    const setterAsg = p.setterId ? asgByTrainee.get(p.setterId) : null;
    const activeSetterAsg = setterAsg?.find((a) => a.isActiveTraining !== false);
    if (activeSetterAsg) {
      const rate = activeSetterAsg.tiers[0]?.ratePerW ?? 0;
      const projected = rate * p.kWSize * 1000;
      orphans.push({
        projectId: p.id,
        customerName: p.customerName,
        phase: p.phase,
        kWSize: p.kWSize,
        soldDate: p.soldDate,
        installerName,
        installPayPct,
        cause: 'setter-assignment',
        expectedTrainerId: activeSetterAsg.trainerId,
        expectedTrainerName: `${activeSetterAsg.trainer?.firstName ?? ''} ${activeSetterAsg.trainer?.lastName ?? ''}`.trim(),
        expectedRate: rate,
        projectedAmount: projected,
      });
      continue;
    }

    // Cause 4: any co-party has an active TrainerAssignment.
    const coParty = [...p.additionalClosers, ...p.additionalSetters].find((c) => {
      const asg = asgByTrainee.get(c.userId)?.find((a) => a.isActiveTraining !== false);
      return !!asg;
    });
    if (coParty) {
      const asg = asgByTrainee.get(coParty.userId)?.find((a) => a.isActiveTraining !== false);
      if (asg) {
        const rate = asg.tiers[0]?.ratePerW ?? 0;
        const projected = rate * p.kWSize * 1000;
        orphans.push({
          projectId: p.id,
          customerName: p.customerName,
          phase: p.phase,
          kWSize: p.kWSize,
          soldDate: p.soldDate,
          installerName,
          installPayPct,
          cause: 'co-party-assignment',
          expectedTrainerId: asg.trainerId,
          expectedTrainerName: `${asg.trainer?.firstName ?? ''} ${asg.trainer?.lastName ?? ''}`.trim(),
          expectedRate: rate,
          projectedAmount: projected,
        });
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log(`Post-M2 projects scanned:        ${projects.length}`);
  console.log(`Projects WITH trainer payroll:   ${projects.length - orphans.length - projects.filter((p) => {
    const hasAsg = p.closerId && asgByTrainee.has(p.closerId);
    return !p.trainerId && !hasAsg && (!p.setterId || !asgByTrainee.has(p.setterId));
  }).length}`);
  console.log(`Orphans found:                   ${orphans.length}`);
  console.log('');

  if (orphans.length === 0) {
    console.log('  ✓ No orphans. Nothing to backfill.');
    process.exit(0);
  }

  const totalProjected = orphans.reduce((s, o) => s + o.projectedAmount, 0);
  console.log(`Total projected backfill amount: ${dollar(totalProjected)} (gross of installPayPct split)`);
  console.log('');

  // Group by cause for the summary
  const byCause = new Map<string, number>();
  for (const o of orphans) byCause.set(o.cause, (byCause.get(o.cause) ?? 0) + 1);
  for (const [cause, n] of byCause.entries()) {
    console.log(`  cause=${cause.padEnd(22)} ${n}`);
  }
  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  Orphans (sorted by projected backfill amount, descending)');
  console.log('──────────────────────────────────────────────────────────────');
  orphans.sort((a, b) => b.projectedAmount - a.projectedAmount);
  for (const o of orphans) {
    console.log('');
    console.log(`  ${o.customerName.padEnd(32)} [${o.phase}]`);
    console.log(`    project: ${o.projectId}`);
    console.log(`    cause: ${o.cause}`);
    console.log(`    expected trainer: ${o.expectedTrainerName} @ $${o.expectedRate}/W`);
    console.log(`    kW: ${o.kWSize}   installer: ${o.installerName} (${o.installPayPct}% at install)`);
    console.log(`    projected total: ${dollar(o.projectedAmount)} (M2: ${dollar(o.projectedAmount * o.installPayPct / 100)}, M3: ${dollar(o.projectedAmount * (100 - o.installPayPct) / 100)})`);
    console.log(`    sold: ${o.soldDate}`);
  }
  console.log('');
  console.log('To backfill: open each project in the app → Trainer section → "Record Payment" button.');
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
