/**
 * fix-trainer-double-pay.mts — one-shot cleanup for the projects where
 * the M2/M3 engine emitted duplicate Trainer-stage entries before the
 * single-trainer dedup landed (commit 6a89113).
 *
 * Per cluster, this script:
 *   1. Lists the duplicate Trainer entries on a project + trainer + milestone
 *   2. Identifies which to KEEP (oldest by createdAt — deterministic)
 *   3. Identifies which to DELETE (the rest)
 *   4. Identifies the closer M2 entry that needs +adjustment to reverse
 *      the over-deduction baked in when the engine fired both legs
 *   5. Prompts the operator: y / n / skip
 *   6. On y: deletes duplicates + bumps closer M2 by the over-deducted amount
 *   7. Writes audit log entries for every mutation
 *
 * Safety:
 *   - Refuses to operate on any non-Draft Trainer entry. Paid + Pending
 *     entries need the paid-correction flow (POST /api/payroll/[id]/
 *     paid-correction), not script-side delete. Skips the whole cluster
 *     with a warning if any entry isn't Draft.
 *   - Refuses to bulk-adjust a non-Draft closer M2 entry for the same
 *     reason — script logs that case but only deletes the trainer
 *     duplicates, leaving closer pay for manual review.
 *   - Re-runnable: re-running with no remaining duplicates is a no-op.
 *   - Audit-logged: every mutation creates an AuditLog row with full
 *     before/after detail. Search by actorId=system_trainer_dedup_cleanup
 *     to review all writes from this run.
 *
 * Run (from kilo-energy/):
 *   npx tsx scripts/fix-trainer-double-pay.mts
 *
 * Re-verify after (read-only):
 *   npx tsx scripts/prod-read/audit-trainer-double-pay.mts
 *   → should report 0 duplicate clusters.
 *
 * Environment: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN must be set
 * (loaded from .env via the standard Next.js convention; if running
 * stand-alone, source .env first).
 */

import readline from 'readline';
import { PrismaLibSql } from '@prisma/adapter-libsql';

// Use the raw generated Prisma client. The audited app wrapper relies on
// the AsyncLocalStorage privacy gate that only makes sense inside a
// request scope. This is a CLI tool with a human operator confirming
// each write — we emit our own AuditLog rows below so the audit trail
// stays intact.
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const prisma = new PrismaClient({ adapter });

const ACTOR_ID = 'system_trainer_dedup_cleanup';
const ACTOR_EMAIL = 'system+trainer-dedup@kiloenergies.com';

const cents = (c: number) => '$' + (c / 100).toLocaleString();

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

type Cluster = {
  projectId: string;
  customerName: string;
  trainerId: string;
  trainerName: string;
  milestone: 'M2' | 'M3';
  entries: Array<{
    id: string;
    amountCents: number;
    status: string;
    notes: string | null;
    date: string;
    createdAt: Date;
  }>;
};

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TRAINER DOUBLE-PAY CLEANUP');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Prereq: engine fix (commit 6a89113) is deployed.');
  console.log('  This mutates Turso. Each project confirmed individually.');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Pull every Trainer-stage payroll entry with project + rep metadata.
  const trainerEntries = await prisma.payrollEntry.findMany({
    where: { paymentStage: 'Trainer', projectId: { not: null } },
    select: {
      id: true,
      projectId: true,
      repId: true,
      amountCents: true,
      status: true,
      notes: true,
      date: true,
      createdAt: true,
      project: { select: { customerName: true, phase: true } },
      rep: { select: { firstName: true, lastName: true } },
    },
  });

  // Cluster by (projectId, trainerId, milestone). Milestone derived from
  // the notes prefix written by the phase-transition generator.
  const groups = new Map<string, typeof trainerEntries>();
  for (const e of trainerEntries) {
    if (!e.projectId) continue;
    if (e.project?.phase === 'Cancelled') continue;
    const notes = e.notes ?? '';
    let milestone: 'M2' | 'M3' | null = null;
    if (notes.startsWith('Trainer override M2')) milestone = 'M2';
    else if (notes.startsWith('Trainer override M3')) milestone = 'M3';
    if (!milestone) continue;
    const key = `${e.projectId}::${e.repId}::${milestone}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const clusters: Cluster[] = [];
  for (const [key, entries] of groups.entries()) {
    if (entries.length < 2) continue;
    const [projectId, repId, milestone] = key.split('::');
    const first = entries[0];
    clusters.push({
      projectId,
      customerName: first.project?.customerName ?? '(unknown)',
      trainerId: repId,
      trainerName: `${first.rep?.firstName ?? ''} ${first.rep?.lastName ?? ''}`.trim(),
      milestone: milestone as 'M2' | 'M3',
      entries: entries.map((e) => ({
        id: e.id,
        amountCents: e.amountCents,
        status: e.status,
        notes: e.notes,
        date: e.date,
        createdAt: e.createdAt,
      })),
    });
  }

  if (clusters.length === 0) {
    console.log('  ✓ No duplicate trainer clusters. Nothing to clean up.');
    await prisma.$disconnect();
    process.exit(0);
  }

  const affectedProjectIds = [...new Set(clusters.map((c) => c.projectId))];
  console.log(`Found ${clusters.length} duplicate cluster(s) across ${affectedProjectIds.length} project(s).\n`);

  // Pull closer M2 entries for these projects so we can adjust them too.
  const projects = await prisma.project.findMany({
    where: { id: { in: affectedProjectIds } },
    select: { id: true, closerId: true, setterId: true, customerName: true },
  });
  const projById = new Map(projects.map((p) => [p.id, p]));

  const m2Entries = await prisma.payrollEntry.findMany({
    where: { projectId: { in: affectedProjectIds }, paymentStage: 'M2' },
    select: { id: true, projectId: true, repId: true, amountCents: true, status: true, notes: true },
  });
  const m2ByProjectAndRep = new Map<string, typeof m2Entries[number]>();
  for (const e of m2Entries) {
    if (!e.projectId) continue;
    m2ByProjectAndRep.set(`${e.projectId}::${e.repId}`, e);
  }

  let totalDeleted = 0;
  let totalCloserAdjustedCents = 0;
  let projectsTouched = 0;
  let projectsSkipped = 0;

  for (const c of clusters) {
    console.log('');
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`  ${c.customerName}   trainer: ${c.trainerName}   ${c.milestone}`);
    console.log('──────────────────────────────────────────────────────────────');

    // Safety: every entry in the cluster must be Draft. If any are Paid or
    // Pending, skip the cluster and tell the operator to use paid-correction.
    const nonDraft = c.entries.filter((e) => e.status !== 'Draft');
    if (nonDraft.length > 0) {
      console.log(`  ⚠  Cluster contains non-Draft entries (${nonDraft.map((e) => e.status).join(', ')}).`);
      console.log(`     Skipping — use the paid-correction flow on the Payroll page for these.`);
      projectsSkipped++;
      continue;
    }

    // Sort by createdAt ascending; keep the oldest, delete the rest.
    const sorted = [...c.entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keep = sorted[0];
    const remove = sorted.slice(1);

    console.log(`  KEEP:   ${keep.id}  ${cents(keep.amountCents).padStart(10)}  "${(keep.notes ?? '').slice(0, 50)}"`);
    for (const e of remove) {
      console.log(`  DELETE: ${e.id}  ${cents(e.amountCents).padStart(10)}  "${(e.notes ?? '').slice(0, 50)}"`);
    }

    const overDeductedCents = remove.reduce((s, e) => s + e.amountCents, 0);

    const proj = projById.get(c.projectId);
    const closerM2 = proj?.closerId ? m2ByProjectAndRep.get(`${c.projectId}::${proj.closerId}`) : null;
    let willAdjustCloser = false;
    if (!closerM2) {
      console.log(`  ⚠  No closer M2 entry found on project. Will delete duplicates only.`);
      console.log(`     Closer pay may need manual review.`);
    } else if (closerM2.status !== 'Draft') {
      console.log(`  ⚠  Closer M2 entry is ${closerM2.status}, not Draft. Will delete duplicates only.`);
      console.log(`     Closer pay reversal must go through paid-correction.`);
    } else {
      willAdjustCloser = true;
      console.log(`  CLOSER M2 ADJUST: ${closerM2.id}  ${cents(closerM2.amountCents)} → ${cents(closerM2.amountCents + overDeductedCents)} (+${cents(overDeductedCents)})`);
    }

    const ans = await ask('  Apply? (y/n): ');
    if (ans !== 'y' && ans !== 'yes') {
      console.log(`  Skipped.`);
      projectsSkipped++;
      continue;
    }

    // ─── Apply the mutations ─────────────────────────────────────────
    for (const e of remove) {
      await prisma.payrollEntry.delete({ where: { id: e.id } });
      await prisma.auditLog.create({
        data: {
          actorUserId: ACTOR_ID,
          actorEmail: ACTOR_EMAIL,
          action: 'payroll_entry_delete',
          entityType: 'PayrollEntry',
          entityId: e.id,
          oldValue: JSON.stringify({
            amountCents: e.amountCents,
            status: e.status,
            notes: e.notes,
            paymentStage: 'Trainer',
            projectId: c.projectId,
            repId: c.trainerId,
          }),
          newValue: JSON.stringify({
            reason: 'trainer-double-pay cleanup (one-shot post-engine-fix 6a89113)',
            milestone: c.milestone,
            keptEntryId: keep.id,
          }),
        },
      });
      totalDeleted++;
    }

    if (willAdjustCloser && closerM2) {
      const beforeCents = closerM2.amountCents;
      const afterCents = beforeCents + overDeductedCents;
      await prisma.payrollEntry.update({
        where: { id: closerM2.id },
        data: { amountCents: afterCents },
      });
      await prisma.auditLog.create({
        data: {
          actorUserId: ACTOR_ID,
          actorEmail: ACTOR_EMAIL,
          action: 'payroll_entry_update',
          entityType: 'PayrollEntry',
          entityId: closerM2.id,
          oldValue: JSON.stringify({ amountCents: beforeCents, status: closerM2.status, projectId: c.projectId }),
          newValue: JSON.stringify({
            amountCents: afterCents,
            adjustmentCents: overDeductedCents,
            reason: 'closer M2 over-deduction reversal (trainer double-pay cleanup)',
          }),
        },
      });
      totalCloserAdjustedCents += overDeductedCents;
    }

    projectsTouched++;
    console.log(`  ✓ Cluster cleaned.`);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  CLEANUP COMPLETE');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Projects touched:               ${projectsTouched}`);
  console.log(`  Projects skipped:               ${projectsSkipped}`);
  console.log(`  Duplicate entries deleted:      ${totalDeleted}`);
  console.log(`  Closer M2 upward adjustments:   ${cents(totalCloserAdjustedCents)}`);
  console.log('');
  console.log('  Now re-run scripts/prod-read/audit-trainer-double-pay.mts');
  console.log('  to verify 0 duplicate clusters remain.');
  console.log('');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
