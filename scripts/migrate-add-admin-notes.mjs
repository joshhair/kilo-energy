// Migration: ADD COLUMN "adminNotes" to Project on Turso production.
// Safe, additive, idempotent. Default "" matches the Prisma schema.
//
// Admin + PM only visibility at the app level (enforced by
// lib/fieldVisibility.ts + server scrubber). The column itself is
// plain TEXT — RBAC lives in the serializer, not the DB.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-admin-notes.mjs

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

  if (!columns.includes("adminNotes")) {
    console.log('Adding column "adminNotes" TEXT NOT NULL DEFAULT ""...');
    await client.execute(`ALTER TABLE "Project" ADD COLUMN "adminNotes" TEXT NOT NULL DEFAULT ''`);
  } else {
    console.log('✓ "adminNotes" already exists — skipping.');
  }

  const after = await client.execute(`PRAGMA table_info("Project")`);
  const afterCols = after.rows.map((r) => r.name);
  if (!afterCols.includes("adminNotes")) {
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
