// Migration: ADD COLUMNs for explicit chargeback tracking on PayrollEntry.
//
// Two fields:
//   isChargeback   BOOLEAN  DEFAULT 0  — explicit intent flag
//   chargebackOfId TEXT              — link to the original Paid entry
//
// Why explicit fields instead of inferring from (amount < 0): negative-amount
// Paid entries will accumulate other meanings over time (refunds, typo
// corrections, manual adjustments). Explicit tracking preserves the ability
// to filter / render / audit chargebacks unambiguously forever.
//
// Safe, additive, idempotent. SQLite ALTER TABLE doesn't support FK
// constraints — the relation is enforced at the Zod + service layer.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-chargeback-fields.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute(`PRAGMA table_info("PayrollEntry")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`PayrollEntry columns before: ${columns.length}`);

  if (!columns.includes("isChargeback")) {
    console.log('Adding column "isChargeback" BOOLEAN NOT NULL DEFAULT 0...');
    await client.execute(`ALTER TABLE "PayrollEntry" ADD COLUMN "isChargeback" BOOLEAN NOT NULL DEFAULT 0`);
  } else {
    console.log('✓ "isChargeback" already exists — skipping.');
  }

  if (!columns.includes("chargebackOfId")) {
    console.log('Adding column "chargebackOfId" TEXT NULL...');
    await client.execute(`ALTER TABLE "PayrollEntry" ADD COLUMN "chargebackOfId" TEXT`);
  } else {
    console.log('✓ "chargebackOfId" already exists — skipping.');
  }

  console.log('Adding indexes if missing...');
  try {
    await client.execute(`CREATE INDEX IF NOT EXISTS "PayrollEntry_isChargeback_idx" ON "PayrollEntry"("isChargeback")`);
    await client.execute(`CREATE INDEX IF NOT EXISTS "PayrollEntry_chargebackOfId_idx" ON "PayrollEntry"("chargebackOfId")`);
  } catch (err) {
    console.warn('Index creation warning (non-fatal):', err.message);
  }

  const after = await client.execute(`PRAGMA table_info("PayrollEntry")`);
  const afterCols = after.rows.map((r) => r.name);
  if (!afterCols.includes("isChargeback") || !afterCols.includes("chargebackOfId")) {
    console.error("✗ Migration incomplete");
    process.exit(1);
  }
  console.log(`PayrollEntry columns after: ${afterCols.length}`);
  console.log('✓ Migration complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
