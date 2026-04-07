// scripts/migrate-add-setter-m1-amount.mjs
//
// Emergency migration: add the `setterM1Amount` column to the Turso
// Project table. The Phase B' agent polish run (cycle 481) added this
// column to prisma/schema.prisma + the code paths that populate it.
// The Phase B' blocklist caught the commit and refused to push it
// directly, but subsequent cycles (482-484) piled commits on top of
// bea8ce0 and the next successful `git push` carried the schema-
// dependent commit along for the ride. Vercel deployed the new code,
// which now references a column that doesn't exist in Turso.
//
// The fix is additive and safe — the column is a Float with default 0
// so existing rows just get 0 on read. No data loss, no reconciliation
// needed. This script matches the pattern in migrate-add-clerk-user-id.mjs.
//
// BLOCKLIST POSTMORTEM: the current autoCommit blocklist only prevents
// a blocked commit from being pushed in its own cycle. It doesn't
// prevent a LATER allowed cycle from pushing the blocked commit
// transitively via `git push`. That's a real hole in the safeguard
// design. Fix coming in a follow-up after this hotpatch.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-setter-m1-amount.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}
const client = createClient({ url, authToken });

async function main() {
  const info = await client.execute('PRAGMA table_info("Project")');
  const columns = info.rows.map((r) => r.name);
  console.log(`Project columns: ${columns.length}`);

  if (columns.includes("setterM1Amount")) {
    console.log('✓ Column "setterM1Amount" already exists — nothing to do.');
    return;
  }

  console.log('Adding column "setterM1Amount" FLOAT NOT NULL DEFAULT 0...');
  await client.execute(
    `ALTER TABLE "Project" ADD COLUMN "setterM1Amount" REAL NOT NULL DEFAULT 0`
  );

  const after = await client.execute('PRAGMA table_info("Project")');
  const ok = after.rows.some((r) => r.name === "setterM1Amount");
  if (!ok) {
    console.error("✗ Migration ran but column is missing — abort.");
    process.exit(1);
  }
  console.log('✓ Column "setterM1Amount" added successfully.');

  const count = await client.execute('SELECT COUNT(*) as c FROM "Project"');
  console.log(`  ${count.rows[0].c} rows now have setterM1Amount defaulting to 0`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
