// One-shot migration: ADD COLUMN "idempotencyKey" TEXT (nullable, unique)
// to the PayrollEntry table on the Turso production database.
//
// Why: prevents accidental double-pay when a client retries a POST /api/payroll
// request (double-click, network retry, etc). The route uses this key to
// dedupe — if a row with the same key already exists, return it instead of
// inserting a duplicate.
//
// Safe and additive — nullable column, no existing data is modified.
// Idempotent — checks for the column and the unique index before adding.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-payroll-idempotency.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute(`PRAGMA table_info("PayrollEntry")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`PayrollEntry columns: ${columns.length}`);

  if (columns.includes("idempotencyKey")) {
    console.log('✓ Column "idempotencyKey" already exists — skipping ADD.');
  } else {
    console.log('Adding column "idempotencyKey" TEXT (nullable)...');
    await client.execute(`ALTER TABLE "PayrollEntry" ADD COLUMN "idempotencyKey" TEXT`);
    console.log('✓ Column added.');
  }

  const idxList = await client.execute(`PRAGMA index_list("PayrollEntry")`);
  const idxNames = idxList.rows.map((r) => r.name);
  const uniqueIdxName = "PayrollEntry_idempotencyKey_key";

  if (idxNames.includes(uniqueIdxName)) {
    console.log(`✓ Unique index "${uniqueIdxName}" already exists — skipping.`);
  } else {
    console.log(`Creating unique index "${uniqueIdxName}"...`);
    await client.execute(
      `CREATE UNIQUE INDEX "${uniqueIdxName}" ON "PayrollEntry"("idempotencyKey")`
    );
    console.log(`✓ Unique index created.`);
  }

  console.log("\nMigration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
