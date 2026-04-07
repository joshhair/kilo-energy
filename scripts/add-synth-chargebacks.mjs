// scripts/add-synth-chargebacks.mjs
//
// Phase A.5 patch — the synthetic dataset has zero chargebacks because
// the extras generator only produced positive-amount PayrollEntry rows.
// Real chargebacks in Kilo Energy are represented as PayrollEntry rows
// with negative amounts (see app/dashboard/page.tsx:963:
// `totalChargebacks = Math.abs(myPayroll.filter(p => p.amount < 0)...)`).
//
// Chargebacks happen when a deal was paid out then the customer
// cancelled, or an admin reversed a commission for a policy violation.
// This script simulates realistic chargeback activity:
//   - 25 single-milestone chargebacks (one M1 reversal each)
//   - 10 multi-milestone chargebacks (M1 + M2 both clawed back)
//
// Target rows are picked from synth reps who currently have at least 3
// paid PayrollEntry rows — giving a realistic subset of reps whose
// profile "Total Paid" vs "Chargebacks" will now differ.
//
// Idempotent: skips if any synth_cb_* rows already exist.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/add-synth-chargebacks.mjs           (dry-run)
//   set -a && . ./.env && set +a && node scripts/add-synth-chargebacks.mjs --commit  (write)

import { createClient } from "@libsql/client";

const commit = process.argv.includes("--commit");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}
const client = createClient({ url, authToken });

// ─── Deterministic RNG ─────────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(7777);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randChoice = (arr) => arr[Math.floor(rand() * arr.length)];
function randSubset(arr, count) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}
function round2(n) { return Math.round(n * 100) / 100; }

function addDays(d, days) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
function formatDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const CHARGEBACK_REASONS = [
  "Customer cancelled post-install",
  "Funding fell through",
  "Customer credit denied",
  "Installation quality dispute",
  "Contract fraud — commission reversed",
  "Buyer's remorse within grace period",
  "Permit denied, deal voided",
];

async function main() {
  // ── Idempotency check ───────────────────────────────────────────────
  const existing = await client.execute("SELECT COUNT(*) as c FROM \"PayrollEntry\" WHERE id LIKE 'synth_cb_%'");
  if (Number(existing.rows[0].c) > 0) {
    console.error("✗ Synthetic chargebacks already exist (synth_cb_*). Refusing to add more.");
    console.error("  Wipe with: DELETE FROM \"PayrollEntry\" WHERE id LIKE 'synth_cb_%';");
    process.exit(1);
  }

  // ── Load candidate reps — synth reps with enough paid payroll to make
  //    a chargeback realistic (at least 3 paid entries) ──────────────────
  const candidates = (await client.execute(`
    SELECT repId, COUNT(*) as paidCount
    FROM "PayrollEntry"
    WHERE id LIKE 'synth_pay_%'
      AND status = 'Paid'
      AND amount > 0
    GROUP BY repId
    HAVING COUNT(*) >= 3
  `)).rows;
  if (candidates.length === 0) {
    console.error("✗ No synth reps with 3+ paid payroll entries. Run generate-synthetic-extras.mjs first.");
    process.exit(1);
  }
  console.log(`  ${candidates.length} candidate reps with 3+ paid entries`);

  // For each chargeback entry we generate, we'll pick a random paid row
  // from a random candidate rep and mirror it with a negative amount.
  // Fetch a pool of paid rows to pick from — limit to 500 for variety.
  const paidPool = (await client.execute(`
    SELECT id, repId, projectId, amount, paymentStage, date
    FROM "PayrollEntry"
    WHERE id LIKE 'synth_pay_%'
      AND status = 'Paid'
      AND amount > 0
    ORDER BY amount DESC
    LIMIT 500
  `)).rows;

  // ── Generate 25 single-milestone chargebacks ──────────────────────────
  const chargebacks = [];
  let cbIdx = 1;

  // Pick 25 random paid entries, reverse them
  const singlePicks = randSubset(paidPool, 25);
  for (const source of singlePicks) {
    // Chargeback date: 30-180 days AFTER the original payment
    const origDate = new Date(source.date);
    const clawbackDate = formatDate(addDays(origDate, randInt(30, 180)));
    chargebacks.push({
      id: `synth_cb_${String(cbIdx).padStart(4, "0")}`,
      repId: source.repId,
      projectId: source.projectId,
      amount: -Math.abs(source.amount), // negative amount = chargeback
      type: "Deal",
      paymentStage: source.paymentStage, // keep the original stage label
      status: "Paid", // chargeback is a completed reversal
      date: clawbackDate,
      notes: `Chargeback: ${randChoice(CHARGEBACK_REASONS)}`,
    });
    cbIdx++;
  }

  // ── Generate 10 multi-milestone chargebacks ───────────────────────────
  // (customer cancelled after install — M1 + M2 both clawed back)
  // Load a dedicated pool of projects that have BOTH M1 and M2 paid.
  // Can't reuse paidPool because it's ORDER BY amount DESC LIMIT 500,
  // which biases toward M2 (larger amounts) and excludes most M1 rows,
  // so very few projects in paidPool have both stages present.
  const multiCandidateProjects = (await client.execute(`
    SELECT projectId
    FROM "PayrollEntry"
    WHERE id LIKE 'synth_pay_%'
      AND status = 'Paid'
      AND amount > 0
      AND projectId IS NOT NULL
    GROUP BY projectId
    HAVING SUM(CASE WHEN paymentStage = 'M1' THEN 1 ELSE 0 END) > 0
       AND SUM(CASE WHEN paymentStage = 'M2' THEN 1 ELSE 0 END) > 0
    LIMIT 100
  `)).rows;

  const multiProjectIds = randSubset(multiCandidateProjects.map((r) => r.projectId), 10);
  // Now fetch the actual M1 + M2 rows for those 10 projects
  const multiEntries = [];
  for (const pid of multiProjectIds) {
    const rows = (await client.execute({
      sql: `SELECT id, repId, projectId, amount, paymentStage, date
            FROM "PayrollEntry"
            WHERE projectId = ?
              AND id LIKE 'synth_pay_%'
              AND status = 'Paid'
              AND amount > 0
              AND paymentStage IN ('M1', 'M2')`,
      args: [pid],
    })).rows;
    const m1 = rows.find((r) => r.paymentStage === "M1");
    const m2 = rows.find((r) => r.paymentStage === "M2");
    if (m1 && m2) multiEntries.push([pid, [m1, m2]]);
  }
  const multiPicks = multiEntries;

  for (const [, entries] of multiPicks) {
    const m1 = entries.find((e) => e.paymentStage === "M1");
    const m2 = entries.find((e) => e.paymentStage === "M2");
    if (!m1 || !m2) continue;
    // Shared clawback date
    const latestSource = new Date(m2.date > m1.date ? m2.date : m1.date);
    const clawbackDate = formatDate(addDays(latestSource, randInt(30, 120)));
    const reason = randChoice(CHARGEBACK_REASONS);

    chargebacks.push({
      id: `synth_cb_${String(cbIdx).padStart(4, "0")}`,
      repId: m1.repId,
      projectId: m1.projectId,
      amount: -Math.abs(m1.amount),
      type: "Deal",
      paymentStage: "M1",
      status: "Paid",
      date: clawbackDate,
      notes: `Chargeback (M1+M2): ${reason}`,
    });
    cbIdx++;
    chargebacks.push({
      id: `synth_cb_${String(cbIdx).padStart(4, "0")}`,
      repId: m2.repId,
      projectId: m2.projectId,
      amount: -Math.abs(m2.amount),
      type: "Deal",
      paymentStage: "M2",
      status: "Paid",
      date: clawbackDate,
      notes: `Chargeback (M1+M2): ${reason}`,
    });
    cbIdx++;
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const totalCb = chargebacks.reduce((s, c) => s + Math.abs(c.amount), 0);
  const distinctReps = new Set(chargebacks.map((c) => c.repId)).size;
  const distinctProjects = new Set(chargebacks.map((c) => c.projectId).filter(Boolean)).size;

  console.log();
  console.log(`Will generate:`);
  console.log(`  Chargeback rows:       ${chargebacks.length}`);
  console.log(`    Single-milestone:    ${singlePicks.length}`);
  console.log(`    Multi-milestone:     ${multiPicks.length * 2}`);
  console.log(`  Affected reps:         ${distinctReps}`);
  console.log(`  Affected projects:     ${distinctProjects}`);
  console.log(`  Total clawed back:     $${Math.round(totalCb).toLocaleString()}`);
  console.log();

  if (!commit) {
    console.log("  (dry-run — no inserts. Pass --commit to write.)");
    return;
  }

  // ── Insert ───────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  let inserted = 0;
  for (const cb of chargebacks) {
    await client.execute({
      sql: `INSERT INTO "PayrollEntry" (id, repId, projectId, amount, type, paymentStage, status, date, notes, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [cb.id, cb.repId, cb.projectId, round2(cb.amount), cb.type, cb.paymentStage, cb.status, cb.date, cb.notes, now, now],
    });
    inserted++;
  }
  console.log(`  inserted ${inserted} chargeback rows`);

  // ── Verify ───────────────────────────────────────────────────────────
  const r = await client.execute("SELECT COUNT(*) as c, SUM(amount) as s FROM \"PayrollEntry\" WHERE id LIKE 'synth_cb_%'");
  console.log();
  console.log(`Post-insert: ${r.rows[0].c} rows, sum = $${Math.round(Number(r.rows[0].s)).toLocaleString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
