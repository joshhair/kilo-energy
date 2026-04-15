// One-shot migration: create the AuditLog table + its indexes on Turso.
//
// Why: immutable log of sensitive mutations (phase changes, financial edits,
// role/active flips, payroll publishes). Written by lib/audit.ts logChange(),
// read by the admin-only /dashboard/admin/audit viewer.
//
// Safe: pure additive — creates a new table. No existing data touched.
// Idempotent: checks for the table and each index before creating.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-audit-log.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const db = createClient({ url, authToken });

async function tableExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function main() {
  if (await tableExists("AuditLog")) {
    console.log('✓ Table "AuditLog" already exists — skipping CREATE.');
  } else {
    console.log('Creating table "AuditLog"...');
    await db.execute(`
      CREATE TABLE "AuditLog" (
        "id" TEXT PRIMARY KEY,
        "actorUserId" TEXT,
        "actorEmail" TEXT,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "oldValue" TEXT,
        "newValue" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Table "AuditLog" created.');
  }

  const indexes = [
    { name: "AuditLog_entityType_entityId_idx", columns: '"entityType", "entityId"' },
    { name: "AuditLog_actorUserId_idx", columns: '"actorUserId"' },
    { name: "AuditLog_createdAt_idx", columns: '"createdAt"' },
  ];

  for (const idx of indexes) {
    if (await indexExists(idx.name)) {
      console.log(`✓ Index "${idx.name}" already exists — skipping.`);
    } else {
      console.log(`Creating index "${idx.name}"...`);
      await db.execute(`CREATE INDEX "${idx.name}" ON "AuditLog"(${idx.columns})`);
      console.log(`✓ Index "${idx.name}" created.`);
    }
  }

  console.log("\nMigration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
