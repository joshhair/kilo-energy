/**
 * Backfill Project expected-payment amounts (m1/m2/m3 + setterM1/M2/M3).
 *
 * Problem: the import set Project.m1AmountCents from the Deals CSV's
 * "Received | M1 / Amount" column, which reflects amounts ALREADY PAID, not
 * amounts expected at sale time. For in-flight deals (Site Survey / Design
 * / Permitting, etc.) nothing has been received yet, so the commission-
 * breakdown card shows "Expected M1: $0".
 *
 * Fix: the Commission CSV has per-rep Upfront Pay / Payment 1 / Payment 2
 * columns that represent the expected commission split at sale. Re-populate
 * Project.m1AmountCents/m2AmountCents/m3AmountCents from the primary
 * closer's commission row, and setterM1/M2/M3 from the primary setter's row.
 *
 * The existing Received-column data is preserved as the PayrollEntry
 * history (already imported correctly in Stage 6); only the Project's
 * expected-amount fields need retargeting.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
if (!tursoUrl || !tursoToken) { console.error('TURSO env required'); process.exit(1); }
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes('--commit');
const DIR = 'C:/Users/Jarvis/Downloads';

function load(p: string) {
  const buf = readFileSync(p);
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false }) as Record<string, unknown>[];
}
const get = (r: Record<string, unknown>, k: string) => String(r[k] ?? '').trim();
const getNum = (r: Record<string, unknown>, k: string) => {
  const v = get(r, k).replace(/[$,]/g, '');
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const findRowIdKey = (r: Record<string, unknown>): string | null => {
  for (const k of Object.keys(r)) if (k === '🔒 Row ID' || k.endsWith(' Row ID') || k === 'Row ID') return k;
  return null;
};

const deals = load(`${DIR}/8991f4.Deals (1).csv`);
const commission = load(`${DIR}/358220.Deal  Commission.csv`);

// ─── Rebuild commissionByDeal (primary closer + setter per deal) ─────────
interface CommissionRow {
  glideUserId: string;
  repType: 'closer' | 'setter';
  upfrontPay: number;
  payment1: number;
  payment2: number;
}
const commissionByDeal = new Map<string, CommissionRow[]>();
for (const row of commission) {
  const dealId = get(row, 'Deal / ID');
  const userId = get(row, 'User / ID');
  const rawType = get(row, 'Rep Type').toLowerCase();
  if (!dealId || !userId) continue;
  let repType: 'closer' | 'setter';
  if (rawType === 'closer' || rawType === 'self') repType = 'closer';
  else if (rawType === 'setter') repType = 'setter';
  else continue;
  const list = commissionByDeal.get(dealId) ?? [];
  list.push({
    glideUserId: userId,
    repType,
    upfrontPay:  getNum(row, 'Upfront Pay'),
    payment1:    getNum(row, 'Payments | Payment 1 / Amount'),
    payment2:    getNum(row, 'Payments | Payment 2 / Amount'),
  });
  commissionByDeal.set(dealId, list);
}
console.log(`Indexed commission for ${commissionByDeal.size} deals`);

// ─── Rebuild glideDealId → kiloProjectId via (customer, soldDate) ────────
const projects = await prisma.project.findMany({
  select: {
    id: true, customerName: true, soldDate: true,
    m1AmountCents: true, m2AmountCents: true, m3AmountCents: true,
    setterM1AmountCents: true, setterM2AmountCents: true, setterM3AmountCents: true,
  },
});
const projKey = (name: string, date: string) => `${name.toLowerCase().trim()}::${date}`;
const projLookup = new Map(projects.map((p) => [projKey(p.customerName, p.soldDate), p]));

const glideDealIdToProject = new Map<string, typeof projects[0]>();
for (const row of deals) {
  const k = findRowIdKey(row);
  if (!k) continue;
  const glideDealId = get(row, k);
  const customer = get(row, 'Customer Name');
  if (!customer) continue;
  const soldRaw = get(row, 'Sold Date');
  const m = soldRaw.match(/^(\d{4}-\d{2}-\d{2})/);
  const soldDate = m ? m[1] : '2023-01-01';
  const proj = projLookup.get(projKey(customer, soldDate));
  if (proj) glideDealIdToProject.set(glideDealId, proj);
}
console.log(`Matched ${glideDealIdToProject.size}/${projects.length} projects`);

// ─── Walk Commission data, build per-project update plan ────────────────
interface Update {
  projectId: string;
  customer: string;
  current: { m1: number; m2: number; m3: number | null; sm1: number; sm2: number; sm3: number | null };
  next:    { m1: number; m2: number; m3: number | null; sm1: number; sm2: number; sm3: number | null };
}
const updates: Update[] = [];
let unchanged = 0;
let noCommission = 0;

for (const [glideDealId, proj] of glideDealIdToProject.entries()) {
  const rows = commissionByDeal.get(glideDealId) ?? [];
  const closer = rows.find((r) => r.repType === 'closer');
  const setter = rows.find((r) => r.repType === 'setter');
  if (!closer && !setter) { noCommission++; continue; }

  // Fill-in rule: preserve non-zero current values (paid historical truth),
  // only overwrite zero/null fields from Commission CSV (expected-at-sale).
  const fill = (current: number, fromCsv: number): number =>
    current > 0 ? current : Math.round(fromCsv * 100);
  const fillNullable = (current: number | null, fromCsv: number): number | null =>
    (current ?? 0) > 0 ? current : (fromCsv > 0 ? Math.round(fromCsv * 100) : current);

  const next = {
    m1:  fill(proj.m1AmountCents, closer?.upfrontPay ?? 0),
    m2:  fill(proj.m2AmountCents, closer?.payment1 ?? 0),
    m3:  fillNullable(proj.m3AmountCents, closer?.payment2 ?? 0),
    sm1: fill(proj.setterM1AmountCents, setter?.upfrontPay ?? 0),
    sm2: fill(proj.setterM2AmountCents, setter?.payment1 ?? 0),
    sm3: fillNullable(proj.setterM3AmountCents, setter?.payment2 ?? 0),
  };
  const current = {
    m1: proj.m1AmountCents, m2: proj.m2AmountCents, m3: proj.m3AmountCents,
    sm1: proj.setterM1AmountCents, sm2: proj.setterM2AmountCents, sm3: proj.setterM3AmountCents,
  };
  const changed =
    current.m1 !== next.m1 || current.m2 !== next.m2 || current.m3 !== next.m3 ||
    current.sm1 !== next.sm1 || current.sm2 !== next.sm2 || current.sm3 !== next.sm3;
  if (!changed) { unchanged++; continue; }
  updates.push({ projectId: proj.id, customer: proj.customerName, current, next });
}

console.log(`\nProjects to update:    ${updates.length}`);
console.log(`Already correct:       ${unchanged}`);
console.log(`No commission data:    ${noCommission} (skipped — no change)`);
console.log(`\nSample updates:`);
for (const u of updates.slice(0, 5)) {
  const fmt = (c: typeof u.current) => `M1=$${(c.m1/100).toFixed(2)} M2=$${(c.m2/100).toFixed(2)} M3=$${((c.m3 ?? 0)/100).toFixed(2)} | SM1=$${(c.sm1/100).toFixed(2)} SM2=$${(c.sm2/100).toFixed(2)} SM3=$${((c.sm3 ?? 0)/100).toFixed(2)}`;
  console.log(`  ${u.customer}`);
  console.log(`    before: ${fmt(u.current)}`);
  console.log(`    after:  ${fmt(u.next)}`);
}

if (!COMMIT) {
  console.log('\n(dry-run — rerun with --commit to apply.)');
  await prisma.$disconnect();
  process.exit(0);
}

// ─── Apply ──────────────────────────────────────────────────────────────
console.log('\nApplying updates…');
let applied = 0;
for (const u of updates) {
  await prisma.project.update({
    where: { id: u.projectId },
    data: {
      m1AmountCents: u.next.m1,
      m2AmountCents: u.next.m2,
      m3AmountCents: u.next.m3,
      setterM1AmountCents: u.next.sm1,
      setterM2AmountCents: u.next.sm2,
      setterM3AmountCents: u.next.sm3,
    },
  });
  applied++;
  if (applied % 100 === 0) console.log(`  ${applied}/${updates.length}`);
}
console.log(`\n✓ Applied ${applied} updates.`);
await prisma.$disconnect();
