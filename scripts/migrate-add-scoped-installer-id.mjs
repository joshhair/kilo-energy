// Migration: ADD COLUMN "scopedInstallerId" to User on Turso production.
// Safe, additive, idempotent. Nullable — null = full access (default for
// existing rows). When non-null, the user is a "vendor PM": they only see
// projects whose installerId matches, with commission/margin scrubbed and
// payroll/training/reimbursement endpoints blocked entirely.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-scoped-installer-id.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute(`PRAGMA table_info("User")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`User columns before: ${columns.length}`);

  if (!columns.includes("scopedInstallerId")) {
    console.log('Adding column "scopedInstallerId" TEXT NULL...');
    await client.execute(`ALTER TABLE "User" ADD COLUMN "scopedInstallerId" TEXT`);
  } else {
    console.log('✓ "scopedInstallerId" already exists — skipping.');
  }

  const after = await client.execute(`PRAGMA table_info("User")`);
  const afterCols = after.rows.map((r) => r.name);
  if (!afterCols.includes("scopedInstallerId")) {
    console.error("✗ Migration incomplete");
    process.exit(1);
  }
  console.log(`User columns after: ${afterCols.length}`);
  console.log('✓ Migration complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
