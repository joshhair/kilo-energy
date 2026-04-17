// Mirror of migrate-add-is-active-training.mjs, but against the local
// dev.db (used by test suite when TURSO env is not set).
//
// Run: node scripts/migrate-dev-db-add-is-active-training.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("TrainerAssignment")`).all();
const cols = info.map((r) => r.name);

if (cols.includes('isActiveTraining')) {
  console.log('✓ Column "isActiveTraining" already exists in dev.db — nothing to do.');
  db.close();
  process.exit(0);
}

console.log('Adding column "isActiveTraining" BOOLEAN NOT NULL DEFAULT true to dev.db...');
db.prepare(
  `ALTER TABLE "TrainerAssignment" ADD COLUMN "isActiveTraining" BOOLEAN NOT NULL DEFAULT true`,
).run();
console.log('✓ Done.');
db.close();
