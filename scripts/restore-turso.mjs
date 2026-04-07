// scripts/restore-turso.mjs
//
// Reads a JSON dump produced by backup-turso.mjs and rehydrates Turso.
// DRY-RUN BY DEFAULT — only writes when `--commit` is passed explicitly.
//
// Two merge modes:
//   --mode=merge    (default) Skip rows whose id already exists.
//                             Safe, idempotent. Use for most recoveries.
//   --mode=replace            Drop all rows in each table first, then insert.
//                             DANGEROUS — only use for full disaster recovery
//                             where you're rolling back to a point-in-time
//                             and want to erase everything that happened
//                             after the backup.
//
// Usage:
//   # Dry-run against latest dump
//   node scripts/restore-turso.mjs
//
//   # Dry-run against a specific dump
//   node scripts/restore-turso.mjs state/backups/turso-2026-04-07-100104.json
//
//   # Actually write (merge mode — safe)
//   node scripts/restore-turso.mjs <path> --commit
//
//   # Disaster recovery (nuke-and-replace)
//   node scripts/restore-turso.mjs <path> --commit --mode=replace
//
// FK-safe insertion order is enforced via RESTORE_ORDER below. Tables
// with no FK dependencies go first; tables that reference others come
// after their parents. Inside a transaction we temporarily disable
// foreign key checks as an extra safety net because the order below is
// hand-verified but not bulletproof against future schema additions.

import { createClient } from "@libsql/client";
import * as fs from "fs";
import * as path from "path";

// ─── Parse args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let dumpPath = null;
let commit = false;
let mode = "merge";

for (const arg of args) {
  if (arg === "--commit") commit = true;
  else if (arg === "--dry-run") commit = false;
  else if (arg.startsWith("--mode=")) mode = arg.slice(7);
  else if (arg.endsWith(".json")) dumpPath = arg;
  else if (arg === "--help" || arg === "-h") {
    console.log(`Usage: node scripts/restore-turso.mjs [dump-path] [--commit] [--mode=merge|replace]

  dump-path      Path to a JSON dump. Defaults to most recent in state/backups/.
  --commit       Actually write to Turso. Without this, runs in dry-run mode.
  --mode=merge   Skip rows whose id already exists (default, safe).
  --mode=replace Drop all rows in each table first, then insert.
                 DANGEROUS — full rollback only.`);
    process.exit(0);
  }
}

if (!["merge", "replace"].includes(mode)) {
  console.error(`Invalid --mode: ${mode}. Must be "merge" or "replace".`);
  process.exit(1);
}

// ─── Locate the dump ────────────────────────────────────────────────────────
if (!dumpPath) {
  const dir = path.resolve(process.cwd(), "state", "backups");
  if (!fs.existsSync(dir)) {
    console.error(`No state/backups/ directory. Run backup-turso.mjs first, or pass a dump path.`);
    process.exit(1);
  }
  const candidates = fs.readdirSync(dir).filter((f) => f.startsWith("turso-") && f.endsWith(".json")).sort();
  if (candidates.length === 0) {
    console.error(`No turso-*.json dumps found in ${dir}. Run backup-turso.mjs first.`);
    process.exit(1);
  }
  dumpPath = path.join(dir, candidates[candidates.length - 1]);
  console.log(`Using most recent dump: ${dumpPath}`);
}

if (!fs.existsSync(dumpPath)) {
  console.error(`Dump file not found: ${dumpPath}`);
  process.exit(1);
}

// ─── Load + validate dump ───────────────────────────────────────────────────
const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
if (!dump.tables || typeof dump.tables !== "object") {
  console.error(`Invalid dump format: missing 'tables' object`);
  process.exit(1);
}
console.log(`  takenAt:   ${dump.takenAt}`);
console.log(`  totalRows: ${dump.totalRows}`);
console.log(`  mode:      ${commit ? (mode === "replace" ? "COMMIT (REPLACE)" : "COMMIT (MERGE)") : "DRY-RUN"}`);
console.log();

// ─── Env + Turso client ─────────────────────────────────────────────────────
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}
const client = createClient({ url, authToken });

// ─── FK-safe insertion order ────────────────────────────────────────────────
// Parents before children. Every table here is verified to only depend on
// tables that appear earlier in the list. If you add a new table to the
// schema, add it here in the right position.
const RESTORE_ORDER = [
  // Tier 1 — no FK dependencies
  "User",
  "Installer",
  "Financer",

  // Tier 2 — depend on tier 1
  "InstallerPricingVersion",      // → Installer
  "InstallerPrepaidOption",       // → Installer
  "ProductCatalogConfig",         // → Installer
  "Product",                      // → Installer
  "Blitz",                        // → User × 2

  // Tier 3 — depend on tier 2
  "InstallerPricingTier",         // → InstallerPricingVersion
  "ProductPricingVersion",        // → Product
  "BlitzParticipant",             // → Blitz, User
  "BlitzCost",                    // → Blitz
  "BlitzRequest",                 // → User, Blitz?

  // Tier 4
  "ProductPricingTier",           // → ProductPricingVersion
  "Project",                      // → User × 3, Installer, Financer, InstallerPricingVersion?, Product?, ProductPricingVersion?, Blitz?
  "TrainerAssignment",            // → User × 2
  "Incentive",                    // → User?, Blitz?

  // Tier 5
  "ProjectActivity",              // → Project
  "ProjectMessage",               // → Project
  "PayrollEntry",                 // → User, Project
  "Reimbursement",                // → User
  "TrainerOverrideTier",          // → TrainerAssignment
  "IncentiveMilestone",           // → Incentive

  // Tier 6
  "ProjectCheckItem",             // → ProjectMessage
  "ProjectMention",               // → ProjectMessage
];

// Sanity check: every table in the dump must be in RESTORE_ORDER, and vice versa.
const dumpTables = new Set(Object.keys(dump.tables));
const orderSet = new Set(RESTORE_ORDER);
const missing = [...dumpTables].filter((t) => !orderSet.has(t));
const extra = [...orderSet].filter((t) => !dumpTables.has(t));
if (missing.length > 0) {
  console.error(`Dump contains tables not in RESTORE_ORDER: ${missing.join(", ")}`);
  console.error(`Add them to the RESTORE_ORDER array (in FK-safe position).`);
  process.exit(1);
}
if (extra.length > 0) {
  console.warn(`RESTORE_ORDER has tables not in dump (harmless, skipping): ${extra.join(", ")}`);
}

// ─── Dry-run preview ────────────────────────────────────────────────────────
async function previewDryRun() {
  console.log("Dry-run preview:");
  let totalWould = 0;
  let totalSkip = 0;

  for (const name of RESTORE_ORDER) {
    const rows = dump.tables[name];
    if (!rows || rows.length === 0) {
      console.log(`  ─ ${name.padEnd(28)}  empty, skipping`);
      continue;
    }

    // Fetch existing ids for merge-mode skip detection
    let existingIds = new Set();
    if (mode === "merge") {
      try {
        const result = await client.execute(`SELECT id FROM "${name}"`);
        existingIds = new Set(result.rows.map((r) => r.id));
      } catch (err) {
        console.error(`  ✗ ${name}: failed to read existing IDs: ${err.message}`);
        process.exit(1);
      }
    }

    const would = rows.filter((r) => !existingIds.has(r.id));
    const skip = rows.length - would.length;
    totalWould += would.length;
    totalSkip += skip;

    const marker = mode === "replace" ? "DELETE+INSERT" : `+${would.length}/~${skip}`;
    console.log(`  ${mode === "replace" ? "⚠" : "→"} ${name.padEnd(28)}  ${String(rows.length).padStart(6)} rows  ${marker}`);
  }

  console.log();
  console.log(`  Total would-insert: ${totalWould}`);
  if (mode === "merge") console.log(`  Total would-skip:   ${totalSkip}`);
  console.log();
  console.log("  (dry-run — no writes)");
}

// ─── Commit mode ────────────────────────────────────────────────────────────
async function commitRestore() {
  console.log(`Starting restore (mode=${mode})...`);
  console.log();

  // SQLite/libSQL temporarily disable FK enforcement inside the restore so
  // the order is guaranteed safe even if we overlooked a dependency. We'll
  // re-enable it at the end.
  await client.execute("PRAGMA foreign_keys = OFF");

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;

  try {
    for (const name of RESTORE_ORDER) {
      const rows = dump.tables[name];
      if (!rows || rows.length === 0) continue;

      // ─── Replace mode: nuke the table first ─────────────────────────────
      if (mode === "replace") {
        const delResult = await client.execute(`DELETE FROM "${name}"`);
        const deleted = Number(delResult.rowsAffected ?? 0);
        totalDeleted += deleted;
        if (deleted > 0) {
          console.log(`  ⚠ ${name.padEnd(28)}  deleted ${deleted} existing rows`);
        }
      }

      // ─── Merge mode: figure out which rows to skip ──────────────────────
      let existingIds = new Set();
      if (mode === "merge") {
        const result = await client.execute(`SELECT id FROM "${name}"`);
        existingIds = new Set(result.rows.map((r) => r.id));
      }

      // ─── Insert rows ────────────────────────────────────────────────────
      let inserted = 0;
      let skipped = 0;

      for (const row of rows) {
        if (mode === "merge" && existingIds.has(row.id)) {
          skipped++;
          continue;
        }

        const cols = Object.keys(row);
        const placeholders = cols.map(() => "?").join(", ");
        const colList = cols.map((c) => `"${c}"`).join(", ");
        const values = cols.map((c) => row[c]);

        try {
          await client.execute({
            sql: `INSERT INTO "${name}" (${colList}) VALUES (${placeholders})`,
            args: values,
          });
          inserted++;
        } catch (err) {
          console.error();
          console.error(`  ✗ ${name}: insert failed on row id=${row.id}: ${err.message}`);
          console.error(`    Restoring FK enforcement and exiting. Partial restore may have occurred.`);
          await client.execute("PRAGMA foreign_keys = ON").catch(() => {});
          process.exit(1);
        }
      }

      totalInserted += inserted;
      totalSkipped += skipped;

      if (inserted > 0 || skipped > 0) {
        const parts = [];
        if (inserted > 0) parts.push(`+${inserted}`);
        if (skipped > 0) parts.push(`~${skipped} existing`);
        console.log(`  ✓ ${name.padEnd(28)}  ${parts.join(", ")}`);
      }
    }
  } finally {
    await client.execute("PRAGMA foreign_keys = ON").catch(() => {});
  }

  console.log();
  console.log("─".repeat(60));
  console.log(`  Restore complete`);
  console.log(`    Inserted: ${totalInserted}`);
  if (mode === "merge") console.log(`    Skipped:  ${totalSkipped} (already existed)`);
  if (mode === "replace") console.log(`    Deleted:  ${totalDeleted} (pre-restore)`);
  console.log();
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (commit) {
    // Big-red-button confirmation for replace mode
    if (mode === "replace") {
      console.log("⚠".repeat(30));
      console.log("⚠  DESTRUCTIVE OPERATION — REPLACE MODE");
      console.log("⚠  This will DELETE every row in every table,");
      console.log("⚠  then restore from the dump. Any data written");
      console.log("⚠  after the dump was taken will be LOST.");
      console.log("⚠".repeat(30));
      console.log();
      console.log("  Proceeding in 5 seconds. Ctrl+C to abort.");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    await commitRestore();
  } else {
    await previewDryRun();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  });
