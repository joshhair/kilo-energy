// Mirror of migrate-add-project-notes-table.mjs, but against the local
// dev.db (used by the test suite and local dev server).
//
// Run: node scripts/migrate-dev-db-add-project-notes-table.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ProjectNote'`).all();
if (tables.length === 0) {
  console.log('Creating "ProjectNote" table in dev.db…');
  db.exec(`
    CREATE TABLE "ProjectNote" (
      "id"         TEXT PRIMARY KEY NOT NULL,
      "projectId"  TEXT NOT NULL,
      "authorId"   TEXT NOT NULL,
      "authorName" TEXT NOT NULL,
      "text"       TEXT NOT NULL,
      "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProjectNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX "ProjectNote_projectId_idx" ON "ProjectNote"("projectId");
    CREATE INDEX "ProjectNote_authorId_idx" ON "ProjectNote"("authorId");
  `);
  console.log('✓ Table + indexes created.');
} else {
  console.log('✓ "ProjectNote" already exists in dev.db — skipping.');
}

const legacyAuthorId = 'legacy_project_notes_import';
const seen = new Set(
  db.prepare(`SELECT "projectId" as pid FROM "ProjectNote" WHERE "authorId" = ?`).all(legacyAuthorId).map((r) => r.pid),
);

const projects = db.prepare(`SELECT "id", "notes" FROM "Project" WHERE "notes" IS NOT NULL AND trim("notes") != ''`).all();
console.log(`Found ${projects.length} project(s) with legacy notes.`);

const insert = db.prepare(`INSERT INTO "ProjectNote" ("id","projectId","authorId","authorName","text","createdAt") VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`);
let backfilled = 0;
for (const row of projects) {
  if (seen.has(row.id)) continue;
  insert.run(`cl_note_legacy_${row.id}`, row.id, legacyAuthorId, 'Legacy import', row.notes);
  backfilled++;
}
console.log(`✓ Backfilled ${backfilled} legacy note rows (${seen.size} already present).`);

db.close();
