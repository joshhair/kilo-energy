// Mirror of migrate-add-project-admin-notes-table.mjs for dev.db.
//
// Run: node scripts/migrate-dev-db-add-project-admin-notes-table.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ProjectAdminNote'`).all();
if (tables.length === 0) {
  console.log('Creating "ProjectAdminNote" table in dev.db…');
  db.exec(`
    CREATE TABLE "ProjectAdminNote" (
      "id"         TEXT PRIMARY KEY NOT NULL,
      "projectId"  TEXT NOT NULL,
      "authorId"   TEXT NOT NULL,
      "authorName" TEXT NOT NULL,
      "text"       TEXT NOT NULL,
      "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProjectAdminNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX "ProjectAdminNote_projectId_idx" ON "ProjectAdminNote"("projectId");
    CREATE INDEX "ProjectAdminNote_authorId_idx" ON "ProjectAdminNote"("authorId");
  `);
  console.log('✓ Table + indexes created.');
} else {
  console.log('✓ "ProjectAdminNote" already exists in dev.db — skipping.');
}

const legacyAuthorId = 'legacy_project_admin_notes_import';
const seen = new Set(
  db.prepare(`SELECT "projectId" as pid FROM "ProjectAdminNote" WHERE "authorId" = ?`).all(legacyAuthorId).map((r) => r.pid),
);

const projects = db.prepare(`SELECT "id", "adminNotes" FROM "Project" WHERE "adminNotes" IS NOT NULL AND trim("adminNotes") != ''`).all();
console.log(`Found ${projects.length} project(s) with legacy admin-notes.`);

const insert = db.prepare(`INSERT INTO "ProjectAdminNote" ("id","projectId","authorId","authorName","text","createdAt") VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`);
let backfilled = 0;
for (const row of projects) {
  if (seen.has(row.id)) continue;
  insert.run(`cl_adminnote_legacy_${row.id}`, row.id, legacyAuthorId, 'Legacy import', row.adminNotes);
  backfilled++;
}
console.log(`✓ Backfilled ${backfilled} legacy admin-note rows (${seen.size} already present).`);

db.close();
