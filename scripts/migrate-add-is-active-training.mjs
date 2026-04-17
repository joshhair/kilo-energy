// One-shot migration: ADD COLUMN "isActiveTraining" BOOLEAN NOT NULL DEFAULT true
// to the TrainerAssignment table on the Turso production database.
//
// Separates active coaching from residual overrides — trainers still earn
// on graduated trainees, but only see coaching UI for isActiveTraining=true.
//
// Safe and additive — no existing data is modified. Idempotent.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-is-active-training.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute(`PRAGMA table_info("TrainerAssignment")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`TrainerAssignment columns: ${columns.length}`);

  if (columns.includes("isActiveTraining")) {
    console.log('✓ Column "isActiveTraining" already exists — nothing to do.');
    return;
  }

  console.log('Adding column "isActiveTraining" BOOLEAN NOT NULL DEFAULT true...');
  await client.execute(
    `ALTER TABLE "TrainerAssignment" ADD COLUMN "isActiveTraining" BOOLEAN NOT NULL DEFAULT true`
  );

  const after = await client.execute(`PRAGMA table_info("TrainerAssignment")`);
  const ok = after.rows.some((r) => r.name === "isActiveTraining");
  if (!ok) {
    console.error("✗ Migration ran but column is missing — abort.");
    process.exit(1);
  }
  console.log('✓ Column "isActiveTraining" added successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
