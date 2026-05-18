import { readDb, logQuery } from './index.mts';

const JOSH_ID = 'admin_josh';

async function main() {
  // Entries with date < 2026-01-01 but paidAt >= 2026-01-01 — these would
  // count as "paid IN 2026" by paidAt semantics but not by date semantics.
  const lateFirers = await readDb.payrollEntry.findMany({
    where: {
      repId: JOSH_ID,
      status: 'Paid',
      date: { lt: '2026-01-01' },
      paidAt: { gte: new Date('2026-01-01T00:00:00Z') },
    },
    select: { id: true, amountCents: true, paymentStage: true, date: true, paidAt: true },
    orderBy: { paidAt: 'asc' },
  });
  logQuery('payrollEntry.findMany lateFirers', { repId: JOSH_ID }, lateFirers.length);

  const sum = lateFirers.reduce((s, e) => s + e.amountCents, 0) / 100;
  console.log(`\nPre-2026-dated entries paid IN 2026 (paidAt >= 2026-01-01):`);
  console.log(`  count: ${lateFirers.length}, sum: $${sum.toFixed(0)}`);
  console.log('');

  // Same but with paidAt null and date >= 2026 — legacy paid entries.
  const legacyPaidIn2026 = await readDb.payrollEntry.findMany({
    where: {
      repId: JOSH_ID,
      status: 'Paid',
      date: { gte: '2026-01-01' },
      paidAt: null,
    },
    select: { id: true, amountCents: true, paymentStage: true, date: true },
  });
  logQuery('legacy paid in 2026', { repId: JOSH_ID }, legacyPaidIn2026.length);
  const sumLegacy = legacyPaidIn2026.reduce((s, e) => s + e.amountCents, 0) / 100;
  console.log(`Legacy Paid entries dated 2026 (paidAt=null):`);
  console.log(`  count: ${legacyPaidIn2026.length}, sum: $${sumLegacy.toFixed(0)}`);

  // What WOULD a more user-friendly "paid in 2026" formula return?
  // = entries where (paidAt in 2026) OR (paidAt is null AND date in 2026)
  console.log('');
  console.log('Proposed "actually paid in 2026" formula:');
  console.log(`  paidAt-driven (recent + lateFirers):  $${(sum + 11152).toFixed(0)}`);
  console.log(`  + legacy paidAt-null date-2026:        $${sumLegacy.toFixed(0)}`);
  console.log(`  = combined:                            $${(sum + 11152 + sumLegacy).toFixed(0)}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
