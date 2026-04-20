// Mirror of migrate-add-admin-notes.mjs, but against the local
// dev.db (used by the test suite when TURSO env is not set).
//
// Run: node scripts/migrate-dev-db-add-admin-notes.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("Project")`).all();
const cols = info.map((r) => r.name);

if (cols.includes('adminNotes')) {
  console.log('✓ Column "adminNotes" already exists in dev.db — nothing to do.');
  db.close();
  process.exit(0);
}

console.log('Adding column "adminNotes" TEXT NOT NULL DEFAULT "" to dev.db...');
db.prepare(`ALTER TABLE "Project" ADD COLUMN "adminNotes" TEXT NOT NULL DEFAULT ''`).run();
console.log('✓ Done.');
db.close();
