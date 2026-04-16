// Migration: add ProjectCloser + ProjectSetter join tables for tag-team
// deals (multiple closers/setters on one project, each with their own
// commission cut). No data backfill — the DB was just wiped (2026-04-16)
// and single-closer deals don't need rows in these tables.
//
// Reversible — down() drops both tables + their indexes. Safe to run
// repeatedly: every step checks existence first.

import { runMigration, tableExists, indexExists } from './migrate-helpers.mjs';

const TABLES = /** @type {const} */ (['ProjectCloser', 'ProjectSetter']);

async function up(client) {
  for (const table of TABLES) {
    if (await tableExists(client, table)) {
      console.log(`  = ${table} already exists, skipping`);
      continue;
    }
    console.log(`  + CREATE ${table}`);
    // Same column set for both join tables — only the relation name differs.
    // We deliberately store money as INTEGER cents to match the Float→Int
    // migration from 2026-04-15; never introduce Float here.
    await client.execute(`
      CREATE TABLE "${table}" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "projectId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "m1AmountCents" INTEGER NOT NULL DEFAULT 0,
        "m2AmountCents" INTEGER NOT NULL DEFAULT 0,
        "m3AmountCents" INTEGER,
        "position" INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "${table}_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "${table}_userId_fkey"    FOREIGN KEY ("userId")    REFERENCES "User"("id")    ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);

    // Uniqueness: a single user appears at most once per project in each table.
    if (!(await indexExists(client, `${table}_projectId_userId_key`))) {
      await client.execute(`CREATE UNIQUE INDEX "${table}_projectId_userId_key" ON "${table}"("projectId", "userId")`);
    }
    // Lookup indexes — all three are hot paths: by project (detail page
    // hydrate), by user (GDPR export + "deals I co-closed" view).
    if (!(await indexExists(client, `${table}_projectId_idx`))) {
      await client.execute(`CREATE INDEX "${table}_projectId_idx" ON "${table}"("projectId")`);
    }
    if (!(await indexExists(client, `${table}_userId_idx`))) {
      await client.execute(`CREATE INDEX "${table}_userId_idx" ON "${table}"("userId")`);
    }
  }
}

async function down(client) {
  // Drop order: cascade-children first, but since these are leaf tables
  // (only User + Project reference them), order among themselves doesn't
  // matter. SQLite drops indexes with the table.
  for (const table of TABLES) {
    if (await tableExists(client, table)) {
      console.log(`  - DROP ${table}`);
      await client.execute(`DROP TABLE "${table}"`);
    }
  }
}

await runMigration({ up, down, name: 'project-closer-setter' });
