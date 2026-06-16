// scripts/backup-turso.mjs
//
// Dumps every Turso table to a single timestamped JSON file in
// state/backups/. Safe to run anytime — read-only against the DB, no
// mutations.
//
// Output format:
//   {
//     "takenAt":   "2026-04-07T15:30:00.000Z",
//     "tableCount": 25,
//     "tables": {
//       "User":     [...rows],
//       "Installer":[...rows],
//       ...
//     }
//   }
//
// Why this exists: before the bulk data import event, we need a reliable
// rollback path. If an import goes wrong mid-run, this dump is the only
// way to get back to a known-good state. See restore-turso.mjs for the
// other half of the pipeline.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/backup-turso.mjs
//
// The dump file path is printed at the end so you can easily pipe it
// into restore-turso.mjs if needed.

import { createClient } from "@libsql/client";
import * as fs from "fs";
import * as path from "path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  console.error("Run with: set -a && . ./.env && set +a && node scripts/backup-turso.mjs");
  process.exit(1);
}

const client = createClient({ url, authToken });

// ─── Table list — AUTO-DISCOVERED from the live DB ──────────────────────────
// 2026-06-15: this list used to be hand-maintained and drifted to 25 of 42
// tables (missing AuditLog, ProjectCloser/Setter, notifications, etc.), so a
// "full backup" was silently incomplete and not a real rollback path. We now
// read every user table from sqlite_master so the dump can NEVER miss data
// again, regardless of schema changes. System/internal tables (sqlite_*,
// _prisma_migrations, libsql_*, underscore-prefixed) are excluded.
//
// The RESTORE script (restore-turso.mjs) keeps an EXPLICIT FK-ordered list
// because insertion order matters there; its sanity check fails loudly if a
// dumped table is missing from that order.
async function discoverTables() {
  const res = await client.execute(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE 'libsql_%'
       AND name NOT LIKE '\\_%' ESCAPE '\\'
     ORDER BY name`,
  );
  return res.rows.map((r) => r.name);
}

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "-" + pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function main() {
  console.log("Turso backup starting...");
  console.log(`  URL: ${url.replace(/:[^@]+@/, ":***@")}`);
  console.log();

  const takenAt = new Date().toISOString();
  const TABLES = await discoverTables();
  console.log(`  Discovered ${TABLES.length} tables from the live DB.\n`);
  const tables = {};
  const counts = {};
  let totalRows = 0;

  for (const name of TABLES) {
    try {
      // Wrap identifier in quotes so reserved words / camelCase survive
      const result = await client.execute(`SELECT * FROM "${name}"`);
      // libSQL returns rows with columns typed per the DB. Convert to plain
      // objects for JSON serialization. Column values are already JS
      // primitives (strings, numbers, null, bigint).
      const rows = result.rows.map((row) => {
        const plain = {};
        for (const col of result.columns) {
          const v = row[col];
          // BigInt doesn't serialize to JSON — convert to Number. All our
          // integer columns fit in safe-integer range (counts, cents, IDs).
          plain[col] = typeof v === "bigint" ? Number(v) : v;
        }
        return plain;
      });
      tables[name] = rows;
      counts[name] = rows.length;
      totalRows += rows.length;
      console.log(`  ✓ ${name.padEnd(28)} ${rows.length.toString().padStart(6)} rows`);
    } catch (err) {
      console.error(`  ✗ ${name.padEnd(28)} FAILED: ${err.message}`);
      process.exit(1);
    }
  }

  const dump = {
    takenAt,
    tableCount: TABLES.length,
    totalRows,
    tables,
  };

  // ─── Write to state/backups/ ─────────────────────────────────────────────
  const outDir = path.resolve(process.cwd(), "state", "backups");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const fileName = `turso-${formatTimestamp()}.json`;
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));

  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);

  console.log();
  console.log("─".repeat(60));
  console.log(`  Backup complete`);
  console.log(`    Tables:    ${TABLES.length}`);
  console.log(`    Total rows: ${totalRows}`);
  console.log(`    Size:      ${sizeKb} KB`);
  console.log(`    File:      ${outPath}`);
  console.log();
  console.log("  To restore this dump later (dry-run by default):");
  console.log(`    node scripts/restore-turso.mjs ${outPath}`);
  console.log();
  console.log("  To actually write the restore:");
  console.log(`    node scripts/restore-turso.mjs ${outPath} --commit`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
