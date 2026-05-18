/**
 * verify-paid-ytd.mts — debug what "paid YTD" should equal for Josh.
 * Read-only.
 */

import { readDb, logQuery } from './index.mts';

const JOSH_ID = 'admin_josh';
const YEAR_START = `${new Date().getFullYear()}-01-01`;

async function main() {
  console.log(`\n=== Paid YTD investigation for ${JOSH_ID} (${YEAR_START} onward) ===\n`);

  // (A) ALL payroll entries for Josh dated this year (any status).
  const all = await readDb.payrollEntry.findMany({
    where: { repId: JOSH_ID, date: { gte: YEAR_START } },
    select: { id: true, amountCents: true, status: true, type: true, paymentStage: true, date: true, paidAt: true },
    orderBy: { date: 'asc' },
  });
  logQuery('payrollEntry.findMany all 2026', { repId: JOSH_ID, since: YEAR_START }, all.length);

  // Aggregations:
  const total = (arr: typeof all) => arr.reduce((s, e) => s + e.amountCents, 0) / 100;
  const positive = (arr: typeof all) => arr.filter((e) => e.amountCents > 0);
  const negative = (arr: typeof all) => arr.filter((e) => e.amountCents < 0);

  const paid = all.filter((e) => e.status === 'Paid');
  const paidPos = positive(paid);
  const paidNeg = negative(paid);

  console.log(`Total entries dated 2026:           ${all.length}`);
  console.log(`  by status:`);
  const byStatus = new Map<string, number>();
  for (const e of all) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
  for (const [s, c] of byStatus) console.log(`    ${s}: ${c}`);
  console.log('');
  console.log(`Sum of ALL entries dated 2026:                $${total(all).toFixed(0)}`);
  console.log(`Sum of Paid entries (incl. chargebacks):      $${total(paid).toFixed(0)}  <-- This is what sumPaid() returns`);
  console.log(`Sum of Paid entries (gross / positive only):  $${total(paidPos).toFixed(0)}`);
  console.log(`Chargebacks / clawbacks among Paid:           $${total(paidNeg).toFixed(0)} (${paidNeg.length} entries)`);

  // Also break down by date used — the dashboard's filter uses entry.date,
  // but maybe the user is thinking about paidAt (the timestamp the status
  // flipped to Paid). Let's check both.
  const paidByPaidAt = all.filter((e) => e.status === 'Paid' && e.paidAt && new Date(e.paidAt) >= new Date(YEAR_START));
  console.log('');
  console.log(`Comparison — filter by paidAt vs date:`);
  console.log(`  Sum of Paid where date >= 2026-01-01:    $${total(paid).toFixed(0)}  (current dashboard formula)`);
  console.log(`  Sum of Paid where paidAt >= 2026-01-01:  $${total(paidByPaidAt).toFixed(0)}  (alt: when cash actually fired)`);

  // Recent entries — last 10
  console.log('');
  console.log(`Last 10 paid entries:`);
  const lastPaid = paid.slice(-10);
  for (const e of lastPaid) {
    console.log(`  ${e.date}  ${e.status.padEnd(8)} ${e.paymentStage?.padEnd(8) ?? '       '} $${(e.amountCents / 100).toFixed(0).padStart(8)}  paidAt=${e.paidAt ? new Date(e.paidAt).toISOString().slice(0, 10) : '—'}`);
  }

  // What if the user is also considering trainer entries that aren't repId=JOSH but are trainerId=JOSH? Cross-check.
  console.log('');
  console.log(`Trainer-attributed entries this year (where repId is set to Josh):`);
  const trainerLike = all.filter((e) => e.paymentStage === 'Trainer');
  console.log(`  count: ${trainerLike.length}, sum: $${total(trainerLike).toFixed(0)}`);

  process.exit(0);
}

main().catch((err) => { console.error('verify-paid-ytd failed:', err); process.exit(1); });
