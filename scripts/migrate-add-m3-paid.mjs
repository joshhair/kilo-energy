// One-shot migration: ADD COLUMN "m3Paid" BOOLEAN NOT NULL DEFAULT false
// to the Project table on the Turso production database.
//
// Safe and additive — no existing data is modified.
// Idempotent — checks for the column first.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-m3-paid.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  // Check existing columns
  const info = await client.execute(`PRAGMA table_info("Project")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`Project columns: ${columns.length}`);

  if (columns.includes("m3Paid")) {
    console.log('✓ Column "m3Paid" already exists — nothing to do.');
    return;
  }

  console.log('Adding column "m3Paid" BOOLEAN NOT NULL DEFAULT false...');
  await client.execute(
    `ALTER TABLE "Project" ADD COLUMN "m3Paid" BOOLEAN NOT NULL DEFAULT false`
  );

  // Verify
  const after = await client.execute(`PRAGMA table_info("Project")`);
  const ok = after.rows.some((r) => r.name === "m3Paid");
  if (!ok) {
    console.error("✗ Migration ran but column is missing — abort.");
    process.exit(1);
  }
  console.log('✓ Column "m3Paid" added successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
