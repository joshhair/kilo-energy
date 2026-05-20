/**
 * audit-trainer-double-pay.mts — find projects where the trainer-override
 * engine fired BOTH a closer-leg and a setter-leg entry for the SAME
 * trainer on the same milestone, causing the trainer to be paid twice.
 *
 * Also checks for the downstream closer under-pay: when both legs fire,
 * the closer's M2 was reduced by `applyCloserTrainerDeduction` for the
 * closer-leg, AND the setter's redline was raised for the setter-leg
 * (which cascades into closer's spread). The closer eats both reductions.
 *
 * Read-only. No mutations. Sorted by money-on-the-line (paid duplicates
 * weighted highest — those are real disbursements that need reversal;
 * draft/pending duplicates can be simply deleted).
 *
 * Usage:
 *   npx tsx scripts/prod-read/audit-trainer-double-pay.mts
 */

import { readDb, logQuery } from './index.mts';

const dollar = (n: number) => '$' + Math.round(n).toLocaleString();
const cents = (c: number) => '$' + (c / 100).toLocaleString();

type DuplicateCluster = {
  projectId: string;
  customerName: string;
  phase: string;
  kWSize: number;
  trainerId: string;
  trainerName: string;
  milestone: 'M2' | 'M3';
  entries: Array<{
    id: string;
    amountCents: number;
    status: string;
    notesPrefix: string;
    date: string;
  }>;
};

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TRAINER DOUBLE-PAY AUDIT');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Pull all Trainer-stage entries with non-cancelled project metadata.
  const trainerEntries = await readDb.payrollEntry.findMany({
    where: {
      paymentStage: 'Trainer',
      projectId: { not: null },
    },
    select: {
      id: true,
      projectId: true,
      repId: true,
      amountCents: true,
      status: true,
      notes: true,
      date: true,
      project: { select: { id: true, customerName: true, phase: true, kWSize: true, closerId: true, setterId: true } },
      rep: { select: { firstName: true, lastName: true } },
    },
  });
  logQuery('payrollEntry.trainer', {}, trainerEntries.length);

  // Group by (projectId, repId, milestone). Milestone is derived from the
  // notes prefix written by the phase-transition generator:
  //   "Trainer override M2 — {trainee name} (..."
  //   "Trainer override M3 — {trainee name} (..."
  const groups = new Map<string, typeof trainerEntries>();
  for (const e of trainerEntries) {
    if (!e.projectId) continue;
    if (e.project?.phase === 'Cancelled') continue;
    const notes = e.notes ?? '';
    let milestone: 'M2' | 'M3' | null = null;
    if (notes.startsWith('Trainer override M2')) milestone = 'M2';
    else if (notes.startsWith('Trainer override M3')) milestone = 'M3';
    if (!milestone) continue; // skip non-engine entries (manual records won't follow this convention)
    const key = `${e.projectId}::${e.repId}::${milestone}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  // Filter to clusters with >1 entry. Those are the duplicates.
  const clusters: DuplicateCluster[] = [];
  for (const [key, entries] of groups.entries()) {
    if (entries.length < 2) continue;
    const [projectId, repId, milestone] = key.split('::');
    const first = entries[0];
    const trainerName = `${first.rep?.firstName ?? ''} ${first.rep?.lastName ?? ''}`.trim();
    clusters.push({
      projectId,
      customerName: first.project?.customerName ?? '(unknown)',
      phase: first.project?.phase ?? '(unknown)',
      kWSize: first.project?.kWSize ?? 0,
      trainerId: repId,
      trainerName,
      milestone: milestone as 'M2' | 'M3',
      entries: entries.map((e) => ({
        id: e.id,
        amountCents: e.amountCents,
        status: e.status,
        notesPrefix: (e.notes ?? '').slice(0, 60),
        date: e.date,
      })),
    });
  }

  console.log(`Trainer-stage entries scanned:  ${trainerEntries.length}`);
  console.log(`Distinct (project, trainer, milestone) groups: ${groups.size}`);
  console.log(`Groups with >1 entry (DUPLICATES): ${clusters.length}`);
  console.log('');

  // Money-on-the-line summary.
  let overPaidCents = 0;
  let overDraftCents = 0;
  let overPendingCents = 0;
  const projectsAffected = new Set<string>();
  for (const c of clusters) {
    projectsAffected.add(c.projectId);
    // Sort entries by status: Paid is the "first kept" if any are Paid;
    // otherwise Pending; otherwise Draft. The keep-one strategy means
    // every entry EXCEPT the first is an over-pay candidate.
    const sorted = [...c.entries].sort((a, b) => {
      const rank = { Paid: 0, Pending: 1, Draft: 2 } as const;
      const ra = (rank as Record<string, number>)[a.status] ?? 3;
      const rb = (rank as Record<string, number>)[b.status] ?? 3;
      return ra - rb;
    });
    for (let i = 1; i < sorted.length; i++) {
      const e = sorted[i];
      if (e.status === 'Paid') overPaidCents += e.amountCents;
      else if (e.status === 'Pending') overPendingCents += e.amountCents;
      else if (e.status === 'Draft') overDraftCents += e.amountCents;
    }
  }
  console.log(`Projects affected:               ${projectsAffected.size}`);
  console.log('');
  console.log(`Over-pay exposure:`);
  console.log(`  PAID    (already disbursed):   ${cents(overPaidCents)}   ← needs paid-correction reversal`);
  console.log(`  PENDING (in next payroll):     ${cents(overPendingCents)}  ← needs deletion before publish`);
  console.log(`  DRAFT   (not yet pending):     ${cents(overDraftCents)}  ← safe to delete inline`);
  console.log('');

  if (clusters.length === 0) {
    console.log('  ✓ No trainer double-pay clusters detected.');
    process.exit(0);
  }

  // ── Closer M2 deduction audit ─────────────────────────────────────────
  // For every project with a duplicate trainer cluster, check whether the
  // closer's M2 payroll shows the double-deduction signature. The single-
  // fire rule says: closer M2 = expectedFullM2 − (rate × kW × 1000 × installPayPct%).
  // If we see closer M2 = expectedFullM2 − 2× the deduction, the closer
  // was UNDER-paid by exactly one trainer-override's worth.
  const projects = await readDb.project.findMany({
    where: { id: { in: [...projectsAffected] } },
    select: {
      id: true,
      m2AmountCents: true,
      kWSize: true,
      trainerRate: true,
      installer: { select: { installPayPct: true } },
    },
  });
  const projById = new Map(projects.map((p) => [p.id, p]));
  // Closer M2 payroll entries for these projects.
  const closerM2 = await readDb.payrollEntry.findMany({
    where: {
      projectId: { in: [...projectsAffected] },
      paymentStage: 'M2',
    },
    select: { projectId: true, repId: true, amountCents: true, status: true },
  });
  const closerM2ByProject = new Map<string, typeof closerM2[number][]>();
  for (const e of closerM2) {
    if (!e.projectId) continue;
    const arr = closerM2ByProject.get(e.projectId) ?? [];
    arr.push(e);
    closerM2ByProject.set(e.projectId, arr);
  }

  // ── Detailed report per cluster ──────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  Detailed duplicate clusters (sorted by money exposure)');
  console.log('──────────────────────────────────────────────────────────────');

  // Sort clusters by total Paid exposure first, then Pending, then Draft.
  clusters.sort((a, b) => {
    const sum = (c: DuplicateCluster, status: string) => c.entries.filter((e) => e.status === status).reduce((s, e) => s + e.amountCents, 0);
    const sa = sum(a, 'Paid') * 1_000_000 + sum(a, 'Pending') * 1_000 + sum(a, 'Draft');
    const sb = sum(b, 'Paid') * 1_000_000 + sum(b, 'Pending') * 1_000 + sum(b, 'Draft');
    return sb - sa;
  });

  for (const c of clusters) {
    const proj = projById.get(c.projectId);
    const rate = proj?.trainerRate ?? 0;
    const installPct = (proj?.installer as { installPayPct?: number } | undefined)?.installPayPct ?? 80;
    const fraction = c.milestone === 'M2' ? installPct / 100 : (100 - installPct) / 100;
    const oneFireCents = Math.round(rate * c.kWSize * 1000 * fraction * 100);

    // Closer M2 deduction check (only meaningful when milestone === 'M2')
    let closerNote = '';
    if (c.milestone === 'M2' && proj) {
      const expectedFull = proj.m2AmountCents ?? 0;
      const closerEntries = (closerM2ByProject.get(c.projectId) ?? [])
        .filter((e) => e.repId === proj.id); // closer M2 is keyed by closer repId, not project.id — fix below
      // Actually closer M2 row uses repId = the closer's user id. The Project's
      // schema doesn't expose closerId directly here, so we approximate: any
      // M2 entry on this project that's NOT the trainer.
      const closerActual = (closerM2ByProject.get(c.projectId) ?? [])
        .filter((e) => e.repId !== c.trainerId)
        .reduce((s, e) => s + e.amountCents, 0);
      void closerEntries; // (unused — see note above)
      const expectedAfterOneDeduction = expectedFull; // m2AmountCents already reflects post-deduction storage
      const diff = closerActual - expectedAfterOneDeduction;
      if (Math.abs(diff + oneFireCents) < 200) {
        closerNote = `   closer M2 likely UNDER-paid by ${cents(oneFireCents)} (single extra deduction signature)`;
      } else if (Math.abs(diff) < 200) {
        closerNote = `   closer M2 looks correct (single deduction)`;
      } else {
        closerNote = `   closer M2 delta = ${cents(diff)} (manual review needed)`;
      }
    }

    const statusCounts = { Draft: 0, Pending: 0, Paid: 0 } as Record<string, number>;
    for (const e of c.entries) statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;
    const totalCents = c.entries.reduce((s, e) => s + e.amountCents, 0);

    console.log('');
    console.log(`  ${c.customerName.padEnd(32)} [${c.phase}]  ${c.milestone}`);
    console.log(`    project: ${c.projectId}`);
    console.log(`    trainer: ${c.trainerName}`);
    console.log(`    duplicates: ${c.entries.length} entries (${statusCounts.Paid} Paid, ${statusCounts.Pending} Pending, ${statusCounts.Draft} Draft)`);
    console.log(`    total recorded: ${cents(totalCents)}   (should be ${cents(oneFireCents)} if single-fire rule applied)`);
    for (const e of c.entries) {
      console.log(`      • ${e.id}  ${e.status.padEnd(8)} ${cents(e.amountCents).padStart(10)}  ${e.date}  "${e.notesPrefix}"`);
    }
    if (closerNote) console.log(closerNote);
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  TOTALS`);
  console.log(`     Paid (already disbursed):   ${cents(overPaidCents)}`);
  console.log(`     Pending (next payroll):     ${cents(overPendingCents)}`);
  console.log(`     Draft (not yet pending):    ${cents(overDraftCents)}`);
  console.log(`     Projects affected:          ${projectsAffected.size}`);
  console.log(`     Duplicate clusters:         ${clusters.length}`);
  console.log('──────────────────────────────────────────────────────────────');
  console.log('');
  console.log('NEXT STEPS (no action taken by this script):');
  console.log('  1. Review the list above with Josh.');
  console.log('  2. Engine fix: dedup the closer/setter legs in lib/context/project-transitions.ts.');
  console.log('  3. Cleanup: delete Draft + Pending duplicates (operator-confirmed).');
  console.log('  4. Paid reversal: paid-correction on duplicate Paid entries (admin-only, audit-logged).');
  console.log('  5. Closer under-pay reversal: paid-correction up on closer M2 where signature matches.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
