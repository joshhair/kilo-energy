// scripts/add-synth-trainer-commissions.mjs
//
// Phase A.5 patch — the synthetic extras generator created 25
// TrainerAssignment rows (trainer → trainee relationships with tier
// override configs) but never generated any PayrollEntry rows with
// paymentStage='Trainer'. Result: the /dashboard/training page shows
// all 25 trainers with $0 earnings from their trainees, making it
// look like the trainer feature is broken when it's really just
// missing data.
//
// Trainer override commission model (from lib/context.tsx:830-877):
//   - Paid per deal that reaches Installed/PTO/Completed phase
//   - At M2 milestone:  overrideRate × kW × 1000 × (installPayPct/100)
//   - At M3 milestone:  overrideRate × kW × 1000 × ((100-installPayPct)/100)
//     (skipped when installPayPct === 100, e.g. SolarTech flat-pay)
//   - No override on M1 — M1 is a flat fee, trainer only gets a cut of
//     the $/W portion
//   - Rate comes from getTrainerOverrideRate(assignment, dealCount),
//     which walks the assignment.tiers array. Rate typically decreases
//     as trainee closes more deals (more senior trainee = less override)
//
// Both closer AND setter can have trainers — if Alice is the closer
// and Bob is the setter and both have trainer overrides configured,
// the deal generates TWO trainer entries (one for Alice's trainer,
// one for Bob's trainer). This script handles both sides.
//
// Idempotent via synth_tr_ prefix on every row's id. Refuses to run
// if any synth_tr_% rows already exist.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/add-synth-trainer-commissions.mjs           (dry-run)
//   set -a && . ./.env && set +a && node scripts/add-synth-trainer-commissions.mjs --commit  (write)

import { createClient } from "@libsql/client";

const commit = process.argv.includes("--commit");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}
const client = createClient({ url, authToken });

function round2(n) { return Math.round(n * 100) / 100; }
function addDays(d, days) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
function formatDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fridayAfter(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  const day = d.getDay();
  const offset = (5 - day + 7) % 7;
  return addDays(d, offset);
}

// ─── Given a sorted tier list + a deal index, return the active rate ──
// Tier shape: { upToDeal: number | null, ratePerW: number, sortOrder }
// Logic mirrors getTrainerOverrideRate in lib/data.ts:
//   Walk tiers in sortOrder. If dealIndex < tier.upToDeal → use this rate.
//   If upToDeal is null → perpetual (catch-all for deals beyond the last cap).
function rateForDealIndex(tiers, dealIndex) {
  const sorted = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const tier of sorted) {
    if (tier.upToDeal === null || dealIndex < tier.upToDeal) {
      return tier.ratePerW;
    }
  }
  return 0; // shouldn't happen if tiers are well-formed
}

async function main() {
  // ── Idempotency check ────────────────────────────────────────────────
  const existing = await client.execute("SELECT COUNT(*) as c FROM \"PayrollEntry\" WHERE id LIKE 'synth_tr_%'");
  if (Number(existing.rows[0].c) > 0) {
    console.error("✗ Synth trainer entries already exist (synth_tr_*). Refusing to re-run.");
    console.error("  Wipe with: DELETE FROM \"PayrollEntry\" WHERE id LIKE 'synth_tr_%';");
    process.exit(1);
  }

  // ── Load assignments + tiers ─────────────────────────────────────────
  const assignments = (await client.execute(`
    SELECT id, trainerId, traineeId, active
    FROM "TrainerAssignment"
    WHERE id LIKE 'synth_%'
  `)).rows;
  if (assignments.length === 0) {
    console.error("✗ No synth TrainerAssignment rows found. Run generate-synthetic-extras.mjs first.");
    process.exit(1);
  }

  const tierRows = (await client.execute(`
    SELECT id, assignmentId, upToDeal, ratePerW, sortOrder
    FROM "TrainerOverrideTier"
    WHERE id LIKE 'synth_%'
  `)).rows;
  const tiersByAssignment = new Map();
  for (const t of tierRows) {
    if (!tiersByAssignment.has(t.assignmentId)) tiersByAssignment.set(t.assignmentId, []);
    tiersByAssignment.get(t.assignmentId).push({
      upToDeal: t.upToDeal,
      ratePerW: t.ratePerW,
      sortOrder: t.sortOrder,
    });
  }

  console.log(`  ${assignments.length} trainer assignments, ${tierRows.length} tier rows`);

  // ── Load user names so we can build good `notes` strings ──────────────
  const userRows = (await client.execute(`SELECT id, firstName, lastName FROM "User" WHERE id LIKE 'synth_%'`)).rows;
  const userById = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  // ── Load installer payment models for the M2/M3 split ────────────────
  const installers = (await client.execute('SELECT id, name, installPayPct FROM "Installer"')).rows;
  const installerPctById = new Map(installers.map((i) => [i.id, i.installPayPct]));

  // ── For each assignment, walk the trainee's qualifying deals ─────────
  // A deal qualifies if phase IN (Installed, PTO, Completed) — same check
  // the context.tsx trainer-payout code uses.
  const entries = [];
  let entryIdx = 1;
  let totalPaid = 0;
  let totalPending = 0;

  for (const assignment of assignments) {
    const tiers = tiersByAssignment.get(assignment.id);
    if (!tiers || tiers.length === 0) continue;

    const traineeId = assignment.traineeId;
    const trainerId = assignment.trainerId;
    const traineeName = userById.get(traineeId) ?? "Unknown";

    // All of the trainee's deals in qualifying phases, ordered by soldDate
    // so we can iterate and compute the active tier per-deal (based on
    // how many deals they had closed BEFORE this one).
    const traineeDeals = (await client.execute({
      sql: `SELECT id, customerName, closerId, setterId, soldDate, kWSize, installerId, phase
            FROM "Project"
            WHERE (closerId = ? OR setterId = ?)
              AND phase IN ('Installed', 'PTO', 'Completed')
            ORDER BY soldDate ASC`,
      args: [traineeId, traineeId],
    })).rows;

    let dealIndex = 0;
    for (const deal of traineeDeals) {
      const rate = rateForDealIndex(tiers, dealIndex);
      if (rate > 0) {
        const installPayPct = installerPctById.get(deal.installerId) ?? 80;
        const baseOverride = rate * deal.kWSize * 1000;
        const m2Override = round2(baseOverride * (installPayPct / 100));
        const m3Override = installPayPct < 100 ? round2(baseOverride * ((100 - installPayPct) / 100)) : 0;

        // M2 entry — paid ~30 days after soldDate
        const m2Date = formatDate(fridayAfter(addDays(new Date(deal.soldDate), 30)));
        const m2Status = new Date(m2Date) < new Date() ? "Paid" : "Pending";
        entries.push({
          id: `synth_tr_${String(entryIdx).padStart(5, "0")}`,
          repId: trainerId,
          projectId: deal.id,
          amount: m2Override,
          type: "Deal",
          paymentStage: "Trainer",
          status: m2Status,
          date: m2Date,
          notes: `Trainer override M2 — ${traineeName} (Deal ${dealIndex + 1}, $${rate.toFixed(2)}/W)`,
        });
        entryIdx++;
        if (m2Status === "Paid") totalPaid += m2Override; else totalPending += m2Override;

        // M3 entry for tiered installers only
        if (m3Override > 0) {
          const m3Date = formatDate(fridayAfter(addDays(new Date(deal.soldDate), 60)));
          const m3Status = new Date(m3Date) < new Date() ? "Paid" : "Pending";
          entries.push({
            id: `synth_tr_${String(entryIdx).padStart(5, "0")}`,
            repId: trainerId,
            projectId: deal.id,
            amount: m3Override,
            type: "Deal",
            paymentStage: "Trainer",
            status: m3Status,
            date: m3Date,
            notes: `Trainer override M3 — ${traineeName} (Deal ${dealIndex + 1}, $${rate.toFixed(2)}/W)`,
          });
          entryIdx++;
          if (m3Status === "Paid") totalPaid += m3Override; else totalPending += m3Override;
        }
      }
      dealIndex++;
    }
  }

  console.log();
  console.log(`Will generate:`);
  console.log(`  Trainer commission entries: ${entries.length}`);
  console.log(`    Paid total:              $${Math.round(totalPaid).toLocaleString()}`);
  console.log(`    Pending total:           $${Math.round(totalPending).toLocaleString()}`);
  console.log(`  Distinct trainers earning: ${new Set(entries.map((e) => e.repId)).size}`);
  console.log();

  if (!commit) {
    console.log("  (dry-run — no inserts. Pass --commit to write.)");
    return;
  }

  // ── Insert ───────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  let count = 0;
  for (const e of entries) {
    await client.execute({
      sql: `INSERT INTO "PayrollEntry" (id, repId, projectId, amount, type, paymentStage, status, date, notes, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [e.id, e.repId, e.projectId, e.amount, e.type, e.paymentStage, e.status, e.date, e.notes, now, now],
    });
    count++;
    if (count % 100 === 0) process.stdout.write(`  inserted ${count}/${entries.length}\r`);
  }
  process.stdout.write(`  inserted ${count}/${entries.length}\n`);

  // ── Verify ───────────────────────────────────────────────────────────
  const final = await client.execute("SELECT COUNT(*) as c, SUM(amount) as s FROM \"PayrollEntry\" WHERE paymentStage = 'Trainer'");
  console.log();
  console.log(`Post-insert: ${final.rows[0].c} Trainer-stage entries, sum = $${Math.round(Number(final.rows[0].s)).toLocaleString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
