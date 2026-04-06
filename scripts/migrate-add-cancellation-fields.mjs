// Migration: ADD COLUMN "cancellationReason" and "cancellationNotes" to
// Project on Turso production. Safe, additive, idempotent.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-cancellation-fields.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute(`PRAGMA table_info("Project")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`Project columns before: ${columns.length}`);

  if (!columns.includes("cancellationReason")) {
    console.log('Adding column "cancellationReason" TEXT (nullable)...');
    await client.execute(`ALTER TABLE "Project" ADD COLUMN "cancellationReason" TEXT`);
  } else {
    console.log('✓ "cancellationReason" already exists — skipping.');
  }

  if (!columns.includes("cancellationNotes")) {
    console.log('Adding column "cancellationNotes" TEXT (nullable)...');
    await client.execute(`ALTER TABLE "Project" ADD COLUMN "cancellationNotes" TEXT`);
  } else {
    console.log('✓ "cancellationNotes" already exists — skipping.');
  }

  const after = await client.execute(`PRAGMA table_info("Project")`);
  const afterCols = after.rows.map((r) => r.name);
  const ok = afterCols.includes("cancellationReason") && afterCols.includes("cancellationNotes");
  if (!ok) {
    console.error("✗ Migration incomplete");
    process.exit(1);
  }
  console.log(`Project columns after: ${afterCols.length}`);
  console.log('✓ Migration complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
