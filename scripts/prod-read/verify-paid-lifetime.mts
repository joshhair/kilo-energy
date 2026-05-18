/** verify-paid-lifetime.mts — what equals 394k? Read-only. */
import { readDb, logQuery } from './index.mts';

async function main() {
  const all = await readDb.payrollEntry.findMany({
    where: { repId: 'admin_josh' },
    select: { amountCents: true, status: true, date: true, type: true },
  });
  logQuery('all josh payroll', { repId: 'admin_josh' }, all.length);

  const total = (arr: typeof all) => arr.reduce((s, e) => s + e.amountCents, 0) / 100;
  const gross = (arr: typeof all) => arr.filter(e => e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0) / 100;

  console.log(`\nLifetime totals (any year):`);
  console.log(`  Sum of ALL entries:                     $${total(all).toFixed(0)}`);
  console.log(`  Sum of Paid entries (net):              $${total(all.filter(e => e.status === 'Paid')).toFixed(0)}`);
  console.log(`  Sum of Paid entries (gross/positive):   $${gross(all.filter(e => e.status === 'Paid')).toFixed(0)}`);
  console.log(`  Total commission earnings (Paid+Draft+Pending, all positive types): $${gross(all.filter(e => e.status !== 'Cancelled'))}`);

  // Group by year
  const byYear = new Map<string, number>();
  for (const e of all) {
    if (e.status !== 'Paid') continue;
    const y = e.date.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + e.amountCents);
  }
  console.log(`\nPaid by year:`);
  for (const [y, c] of [...byYear.entries()].sort()) {
    console.log(`  ${y}: $${(c / 100).toFixed(0)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
