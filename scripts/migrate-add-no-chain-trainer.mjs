// One-shot migration: add noChainTrainer column to Project table.
// Boolean, default false. Admin's explicit "remove all trainers from this
// deal" flag. When true, chain-trainee visibility + chain commission are
// suppressed for this project. Default false preserves current behavior.
//
// Safe and additive. Idempotent — checks for the column first.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-no-chain-trainer.mjs

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

  if (cols.includes("noChainTrainer")) {
    console.log(`✓ Column "noChainTrainer" already exists.`);
    return;
  }
  console.log(`Adding column "noChainTrainer"...`);
  // SQLite stores booleans as INTEGER 0/1. Default 0 = false.
  await client.execute(
    `ALTER TABLE "Project" ADD COLUMN "noChainTrainer" INTEGER NOT NULL DEFAULT 0`,
  );
  console.log(`✓ Added "noChainTrainer".`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
