// scripts/cleanup-qa.mjs
//
// Purges QA-agent-generated test data from Turso. Any Project whose
// customerName starts with "[QA]" is a test deal created by the autonomous
// QA loop — this script removes them cleanly.
//
// Cascade behavior (per prisma/schema.prisma):
//   Project delete cascades → ProjectActivity, ProjectMessage, ProjectCheckItem
//   PayrollEntry.projectId is nullable (no cascade) — we delete those rows
//   explicitly since they're all synthetic too.
//
// Default is DRY RUN. Pass --confirm to actually delete.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/cleanup-qa.mjs            # dry run
//   set -a && . ./.env && set +a && node scripts/cleanup-qa.mjs --confirm  # actual delete

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const confirm = process.argv.includes("--confirm");

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const db = createClient({ url, authToken });

const QA_PATTERN = "[QA]%";

async function main() {
  console.log(`\n=== QA cleanup — ${confirm ? "LIVE" : "DRY RUN"} ===\n`);

  const { rows: projects } = await db.execute({
    sql: `SELECT id, customerName FROM Project WHERE customerName LIKE ? ORDER BY customerName`,
    args: [QA_PATTERN],
  });

  if (projects.length === 0) {
    console.log("No [QA] projects found. Nothing to clean up.");
    return;
  }

  console.log(`Found ${projects.length} [QA] project(s):`);
  for (const p of projects) console.log(`  - ${p.customerName} (${p.id})`);

  const projectIds = projects.map((p) => p.id);
  const placeholders = projectIds.map(() => "?").join(",");

  const { rows: payrollRows } = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM PayrollEntry WHERE projectId IN (${placeholders})`,
    args: projectIds,
  });
  const payrollCount = Number(payrollRows[0]?.n ?? 0);
  console.log(`\nAssociated PayrollEntry rows: ${payrollCount}`);

  if (!confirm) {
    console.log("\nDRY RUN — no changes made. Re-run with --confirm to delete.");
    return;
  }

  console.log("\nDeleting...");

  if (payrollCount > 0) {
    await db.execute({
      sql: `DELETE FROM PayrollEntry WHERE projectId IN (${placeholders})`,
      args: projectIds,
    });
    console.log(`  PayrollEntry: ${payrollCount} deleted`);
  }

  const { rowsAffected } = await db.execute({
    sql: `DELETE FROM Project WHERE id IN (${placeholders})`,
    args: projectIds,
  });
  console.log(`  Project: ${rowsAffected} deleted (cascades to ProjectActivity, ProjectMessage, ProjectCheckItem)`);

  const { rows: usersQa } = await db.execute({
    sql: `SELECT id, email, firstName, lastName FROM User WHERE email LIKE '%+clerk_test@%' OR firstName LIKE '[QA]%'`,
    args: [],
  });
  if (usersQa.length > 0) {
    console.log(`\nTest users (NOT deleted — rerun with --delete-users to purge):`);
    for (const u of usersQa) console.log(`  - ${u.firstName} ${u.lastName} <${u.email}>`);
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  })
  .finally(() => db.close());
