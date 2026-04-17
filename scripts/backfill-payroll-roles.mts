/**
 * Backfill PayrollEntry role tags for the Glide import.
 *
 * Problem: the import script set notes=<Glide note text> and paymentStage=M1/M2/M3
 * for every entry, so Kilo's Commission-by-Role card (which tags role via
 * notes='Setter' / paymentStage='Trainer') buckets everything into Closer.
 *
 * Fix: re-read the Commission CSV to build (glideDealId, glideUserId) → role,
 * then match each PayrollEntry via (project row-id mapping, user row-id
 * mapping) and update:
 *   - setter rows → notes = 'Setter'
 *   - trainer rows → paymentStage = 'Trainer'
 *   - closer/self rows → leave alone (default)
 *
 * The mappings from Glide IDs to Kilo IDs must match what the import used.
 * We reproduce them by re-reading Reps.csv (email → Kilo user) and by
 * matching Deals.csv rows (Customer Name + Sold Date → Kilo project).
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL + TURSO_AUTH_TOKEN required');
  process.exit(1);
}
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
const findRowIdKey = (r: Record<string, unknown>): string | null => {
  for (const k of Object.keys(r)) if (k === '🔒 Row ID' || k.endsWith(' Row ID') || k === 'Row ID') return k;
  return null;
};

// ─── Load CSVs ──────────────────────────────────────────────────────────
const deals = load(`${DIR}/8991f4.Deals (1).csv`);
const reps = load(`${DIR}/Reps.csv`);
const commission = load(`${DIR}/358220.Deal  Commission.csv`);
const payments = load(`${DIR}/e64b45.Deal  Commission  Payments.csv`);

// ─── Rebuild glideUserId → kiloUserId ───────────────────────────────────
const EMAIL_MERGES: Record<string, string> = {
  'jd.marketing83@gmail.com': 'josh@kiloenergies.com',
  'rebekahc@jdmsolarpros.com': 'rebekah@kiloenergies.com',
};
const SKIP_EMAILS = new Set(['jens@v88.co.uk']);
const users = await prisma.user.findMany({ select: { id: true, email: true } });
const emailToKiloId = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

const glideUserIdToKiloId = new Map<string, string>();
for (const row of reps) {
  const k = findRowIdKey(row);
  if (!k) continue;
  const glideId = get(row, k);
  const email = get(row, 'Email').toLowerCase();
  if (SKIP_EMAILS.has(email)) continue;
  const mergedTo = EMAIL_MERGES[email] ?? email;
  const kiloId = emailToKiloId.get(mergedTo);
  if (kiloId) glideUserIdToKiloId.set(glideId, kiloId);
}
console.log(`glideUserId → kiloUserId: ${glideUserIdToKiloId.size} entries`);

// ─── Rebuild glideDealId → kiloProjectId via customerName + soldDate ────
const projects = await prisma.project.findMany({ select: { id: true, customerName: true, soldDate: true } });
const projKey = (name: string, date: string) => `${name.toLowerCase().trim()}::${date}`;
const projLookup = new Map(projects.map((p) => [projKey(p.customerName, p.soldDate), p.id]));

const glideDealIdToKiloId = new Map<string, string>();
let dealsMatched = 0, dealsMissed = 0;
for (const row of deals) {
  const k = findRowIdKey(row);
  if (!k) continue;
  const glideDealId = get(row, k);
  const customer = get(row, 'Customer Name');
  if (!customer) continue;
  const soldRaw = get(row, 'Sold Date');
  const m = soldRaw.match(/^(\d{4}-\d{2}-\d{2})/);
  const soldDate = m ? m[1] : '2023-01-01';
  const kiloId = projLookup.get(projKey(customer, soldDate));
  if (kiloId) {
    glideDealIdToKiloId.set(glideDealId, kiloId);
    dealsMatched++;
  } else {
    dealsMissed++;
  }
}
console.log(`glideDealId → kiloProjectId: ${dealsMatched} matched, ${dealsMissed} missed`);

// ─── Build (glideDealId, glideUserId) → role from Commission CSV ────────
type Role = 'closer' | 'setter' | 'trainer';
const roleMap = new Map<string, Role>();
for (const row of commission) {
  const dealId = get(row, 'Deal / ID');
  const userId = get(row, 'User / ID');
  const rawType = get(row, 'Rep Type').toLowerCase();
  if (!dealId || !userId) continue;
  let role: Role;
  if (rawType === 'closer' || rawType === 'self') role = 'closer';
  else if (rawType === 'setter') role = 'setter';
  else if (rawType === 'trainer') role = 'trainer';
  else continue;
  roleMap.set(`${dealId}::${userId}`, role);
}
console.log(`Role map: ${roleMap.size} (dealId, userId) → role entries`);

// ─── Walk Payments CSV, determine role per payment, stage updates ───────
const PAYMENT_TYPE_TO_STAGE: Record<string, string> = {
  'up front': 'M1', 'final': 'M2', 'extra': 'Bonus',
};

// We don't have PayrollEntry IDs in the CSV; match by (projectId, repId, amountCents, paymentStage, date)
// Load all imported PayrollEntry rows so we can match efficiently.
const entries = await prisma.payrollEntry.findMany({
  select: { id: true, repId: true, projectId: true, amountCents: true, paymentStage: true, date: true, notes: true, type: true },
});
console.log(`Loaded ${entries.length} PayrollEntry rows from DB`);

interface UpdatePlan { id: string; notes?: string; paymentStage?: string; reason: string; }
const plans: UpdatePlan[] = [];
let unmatched = 0;

// Index DB entries for fast lookup
const entryKey = (repId: string, projectId: string | null, stage: string, cents: number, date: string) =>
  `${repId}::${projectId ?? ''}::${stage}::${cents}::${date}`;
const dbByKey = new Map<string, typeof entries[0]>();
for (const e of entries) {
  const k = entryKey(e.repId, e.projectId, e.paymentStage, e.amountCents, e.date);
  dbByKey.set(k, e);
}

const alreadyFine: Record<Role, number> = { closer: 0, setter: 0, trainer: 0 };
const newPlans: Record<Role, number> = { closer: 0, setter: 0, trainer: 0 };

for (const pay of payments) {
  const glideDealId = get(pay, 'Deal / ID');
  const glideUserId = get(pay, 'User / ID');
  const statusRaw = get(pay, 'Status / ID').toLowerCase();
  if (statusRaw !== 'paid') continue; // only Paid rows were imported
  const paymentType = get(pay, 'Payment Type / ID').toLowerCase();
  const stage = PAYMENT_TYPE_TO_STAGE[paymentType];
  if (!stage) continue;
  const amount = parseFloat(get(pay, 'Amount').replace(/[$,]/g, '')) || 0;
  if (amount === 0) continue;
  const dateRaw = get(pay, 'Date');
  const m = dateRaw.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = m ? m[1] : '';
  if (!date) continue;

  const kiloProjectId = glideDealIdToKiloId.get(glideDealId);
  const kiloUserId = glideUserIdToKiloId.get(glideUserId);
  if (!kiloProjectId || !kiloUserId) { unmatched++; continue; }

  const role = roleMap.get(`${glideDealId}::${glideUserId}`) ?? 'closer';

  const cents = Math.round(amount * 100);
  const dbKey = entryKey(kiloUserId, kiloProjectId, stage, cents, date);
  const entry = dbByKey.get(dbKey);
  if (!entry) { unmatched++; continue; }

  // Determine desired state
  const shouldBeNotes = role === 'setter' ? 'Setter' : null;
  const shouldBeStage = role === 'trainer' ? 'Trainer' : entry.paymentStage;

  const notesWrong = role === 'setter' && entry.notes !== 'Setter';
  const stageWrong = role === 'trainer' && entry.paymentStage !== 'Trainer';

  if (!notesWrong && !stageWrong) {
    alreadyFine[role]++;
    continue;
  }

  const plan: UpdatePlan = { id: entry.id, reason: `${role} retag` };
  if (notesWrong) plan.notes = 'Setter';
  if (stageWrong) plan.paymentStage = 'Trainer';
  plans.push(plan);
  newPlans[role]++;
}

console.log(`\nAlready correct: closer=${alreadyFine.closer} setter=${alreadyFine.setter} trainer=${alreadyFine.trainer}`);
console.log(`Planned updates: closer=${newPlans.closer} setter=${newPlans.setter} trainer=${newPlans.trainer}`);
console.log(`Unmatched payment rows: ${unmatched}`);
console.log(`Total updates to apply: ${plans.length}`);

if (!COMMIT) {
  console.log('\n(dry-run — no writes. Rerun with --commit to apply.)');
  await prisma.$disconnect();
  process.exit(0);
}

// ─── Apply ──────────────────────────────────────────────────────────────
console.log('\nApplying updates…');
let applied = 0;
for (const plan of plans) {
  const data: Record<string, unknown> = {};
  if (plan.notes !== undefined) data.notes = plan.notes;
  if (plan.paymentStage !== undefined) data.paymentStage = plan.paymentStage;
  await prisma.payrollEntry.update({ where: { id: plan.id }, data });
  applied++;
  if (applied % 100 === 0) console.log(`  ${applied}/${plans.length}`);
}
console.log(`\n✓ Applied ${applied} updates.`);
await prisma.$disconnect();
