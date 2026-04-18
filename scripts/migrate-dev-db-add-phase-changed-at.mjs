// Mirror of migrate-add-phase-changed-at.mjs, but against the local
// dev.db (used by the test suite when TURSO env is not set).
//
// Run: node scripts/migrate-dev-db-add-phase-changed-at.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("Project")`).all();
const cols = info.map((r) => r.name);

if (cols.includes('phaseChangedAt')) {
  console.log('✓ Column "phaseChangedAt" already exists in dev.db — nothing to do.');
  db.close();
  process.exit(0);
}

console.log('Adding column "phaseChangedAt" DATETIME to dev.db...');
db.prepare(`ALTER TABLE "Project" ADD COLUMN "phaseChangedAt" DATETIME`).run();
console.log('✓ Done.');
db.close();
