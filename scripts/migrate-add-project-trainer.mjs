// One-shot migration: add trainerId + trainerRate columns to Project table.
// These are optional per-deal trainer override fields, separate from the
// rep-level TrainerAssignment chain (for historical/one-off attachments).
//
// Safe and additive. Idempotent — checks for columns first.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-project-trainer.mjs

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
  const cols = info.rows.map((r) => r.name);

  const addIfMissing = async (name, ddl) => {
    if (cols.includes(name)) {
      console.log(`✓ Column "${name}" already exists.`);
      return;
    }
    console.log(`Adding column "${name}"...`);
    await client.execute(ddl);
    console.log(`✓ Added "${name}".`);
  };

  await addIfMissing(
    "trainerId",
    `ALTER TABLE "Project" ADD COLUMN "trainerId" TEXT REFERENCES "User"("id")`,
  );
  await addIfMissing(
    "trainerRate",
    `ALTER TABLE "Project" ADD COLUMN "trainerRate" REAL`,
  );

  // Index (SQLite CREATE INDEX IF NOT EXISTS is safe)
  await client.execute(
    `CREATE INDEX IF NOT EXISTS "Project_trainerId_idx" ON "Project"("trainerId")`,
  );
  console.log(`✓ Index ensured.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
