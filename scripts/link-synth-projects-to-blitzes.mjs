// scripts/link-synth-projects-to-blitzes.mjs
//
// Phase A.5 patch — the synthetic extras script populated Blitz rows and
// BlitzParticipant rows, but left `blitzId` NULL on every project. Result:
// on the blitz detail page, "Deals closed during this blitz" shows zero
// for every blitz, which is misleading and hides all the UI surface area
// that the agent polish run needs to exercise.
//
// This script backfills the link. For each past + current synth blitz:
//   1. Load its approved closer participants (joinStatus='approved' AND
//      role='rep' AND repType in closer/both)
//   2. Find projects where closerId ∈ those participants AND blitzId is
//      currently NULL
//   3. Pick 20-30 of them
//   4. UPDATE each: soldDate → random date within blitz window,
//      blitzId → this blitz, leadSource → 'blitz'
//
// Respects the same validation rules the real POST /api/projects enforces:
//   - closer must be an approved BlitzParticipant
//   - soldDate must be within [blitz.startDate, blitz.endDate]
//
// Future blitzes (upcoming) don't get projects linked because, by
// definition, those deals haven't been closed yet.
//
// Idempotency: projects with blitzId != NULL are skipped. Safe to re-run.
//
// Side note on payroll entries: the earlier extras script generated
// PayrollEntry rows with dates derived from each project's original
// soldDate (Friday after soldDate for M1, +30d for M2, +60d for M3).
// After this script moves the project's soldDate, the entry dates are no
// longer "recomputed-correct" — they're just slightly off relative to
// the new soldDate. The UI doesn't care (it reads entry.date directly),
// but it's worth knowing if you see a payroll entry dated pre-sold.
// For a clean rebuild, wipe synth_pay_% and re-run extras after this.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/link-synth-projects-to-blitzes.mjs           (dry-run)
//   set -a && . ./.env && set +a && node scripts/link-synth-projects-to-blitzes.mjs --commit  (write)

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
const rng = mulberry32(123);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
function randSubset(arr, count) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}
function formatDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
// Random date within [start, end] (inclusive), returned as YYYY-MM-DD
function randomDateInWindow(startStr, endStr) {
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  return formatDate(new Date(start + rand() * (end - start)));
}

// ─── Target projects per blitz (tuned for realistic density) ─────────────
// Past blitzes: 20-30 deals closed during the blitz (typical for a 7-14 day
// on-site push with 15-30 reps). Active blitz: 10-20 deals already in this
// week. Future blitzes: 0 (deals haven't happened yet).
const TARGETS = {
  completed: { min: 20, max: 30 },
  active:    { min: 10, max: 20 },
};

async function main() {
  // ─── Load all synth past + current blitzes ───────────────────────────
  const blitzRows = (await client.execute(
    "SELECT id, name, status, startDate, endDate FROM \"Blitz\" WHERE id LIKE 'synth_blitz_%' AND status IN ('completed', 'active') ORDER BY startDate"
  )).rows;

  if (blitzRows.length === 0) {
    console.error("✗ No synth blitzes found. Run generate-synthetic-extras.mjs first.");
    process.exit(1);
  }
  console.log(`Found ${blitzRows.length} past + current blitzes:`);
  for (const b of blitzRows) {
    console.log(`  ${b.status.padEnd(10)} ${b.startDate} → ${b.endDate}  ${b.name}`);
  }
  console.log();

  // ─── For each blitz, compute its batch of projects to link ───────────
  const updates = []; // { projectId, blitzId, newSoldDate, blitzName }
  const statsByBlitz = new Map();

  for (const blitz of blitzRows) {
    // Load approved closer-capable participants for this blitz
    const participants = (await client.execute({
      sql: `SELECT bp.userId
            FROM "BlitzParticipant" bp
            JOIN "User" u ON u.id = bp.userId
            WHERE bp.blitzId = ?
              AND bp.joinStatus = 'approved'
              AND u.role = 'rep'
              AND u.repType IN ('closer', 'both')`,
      args: [blitz.id],
    })).rows;

    const participantIds = participants.map((p) => p.userId);
    if (participantIds.length === 0) {
      console.log(`  ${blitz.name}: 0 approved closer participants — skipping`);
      continue;
    }

    // Find currently-unlinked projects where closerId ∈ participants.
    // We intentionally ignore the current soldDate because we're about
    // to overwrite it anyway. The only constraint is that the project
    // exists under a synth closer we can attribute to this blitz.
    const placeholders = participantIds.map(() => "?").join(", ");
    const candidateProjects = (await client.execute({
      sql: `SELECT id
            FROM "Project"
            WHERE id LIKE 'synth_proj_%'
              AND blitzId IS NULL
              AND closerId IN (${placeholders})`,
      args: participantIds,
    })).rows;

    if (candidateProjects.length === 0) {
      console.log(`  ${blitz.name}: 0 unlinked candidate projects — skipping`);
      continue;
    }

    const target = TARGETS[blitz.status];
    const batchSize = Math.min(candidateProjects.length, randInt(target.min, target.max));
    const chosen = randSubset(candidateProjects, batchSize);

    for (const p of chosen) {
      updates.push({
        projectId: p.id,
        blitzId: blitz.id,
        newSoldDate: randomDateInWindow(blitz.startDate, blitz.endDate),
        blitzName: blitz.name,
      });
    }
    statsByBlitz.set(blitz.id, { name: blitz.name, count: chosen.length, participants: participantIds.length });
  }

  console.log();
  console.log("Planned updates:");
  for (const [, stats] of statsByBlitz) {
    console.log(`  ${stats.count.toString().padStart(3)} projects → ${stats.name}  (from ${stats.participants} approved closers)`);
  }
  console.log(`  ${updates.length} total project updates`);
  console.log();

  if (updates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!commit) {
    console.log("  (dry-run — no writes. Pass --commit to apply.)");
    return;
  }

  // ─── Apply updates ───────────────────────────────────────────────────
  console.log("Applying updates...");
  let applied = 0;
  for (const u of updates) {
    await client.execute({
      sql: `UPDATE "Project"
            SET blitzId = ?, soldDate = ?, leadSource = 'blitz'
            WHERE id = ? AND blitzId IS NULL`,
      args: [u.blitzId, u.newSoldDate, u.projectId],
    });
    applied++;
    if (applied % 20 === 0) process.stdout.write(`  updated ${applied}/${updates.length}\r`);
  }
  process.stdout.write(`  updated ${applied}/${updates.length}\n`);

  // ─── Verify ──────────────────────────────────────────────────────────
  console.log();
  console.log("Post-update counts per blitz:");
  for (const blitz of blitzRows) {
    const r = await client.execute({
      sql: `SELECT COUNT(*) as c FROM "Project" WHERE blitzId = ?`,
      args: [blitz.id],
    });
    console.log(`  ${String(r.rows[0].c).padStart(3)} projects  ${blitz.name}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
