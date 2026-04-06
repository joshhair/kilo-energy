// Migration: ADD COLUMN "setterM2Amount" and "setterM3Amount" to Project
// on Turso production. Safe, additive, idempotent — checks for existence
// before altering.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-setter-m2-m3.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute(`PRAGMA table_info("Project")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`Project columns before: ${columns.length}`);

  if (!columns.includes("setterM2Amount")) {
    console.log('Adding column "setterM2Amount" REAL NOT NULL DEFAULT 0...');
    await client.execute(
      `ALTER TABLE "Project" ADD COLUMN "setterM2Amount" REAL NOT NULL DEFAULT 0`,
    );
  } else {
    console.log('✓ "setterM2Amount" already exists — skipping.');
  }

  if (!columns.includes("setterM3Amount")) {
    console.log('Adding column "setterM3Amount" REAL (nullable)...');
    await client.execute(
      `ALTER TABLE "Project" ADD COLUMN "setterM3Amount" REAL`,
    );
  } else {
    console.log('✓ "setterM3Amount" already exists — skipping.');
  }

  const after = await client.execute(`PRAGMA table_info("Project")`);
  const afterCols = after.rows.map((r) => r.name);
  const ok = afterCols.includes("setterM2Amount") && afterCols.includes("setterM3Amount");
  if (!ok) {
    console.error("✗ Migration incomplete — abort.");
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
