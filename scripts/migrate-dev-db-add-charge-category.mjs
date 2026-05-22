// Mirror of migrate-add-charge-category.mjs, but against the local dev.db
// used by the test suite when TURSO env is not set.
//
// Run: node scripts/migrate-dev-db-add-charge-category.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("PayrollEntry")`).all();
const cols = info.map((r) => r.name);

if (!cols.includes('chargeCategory')) {
  console.log('Adding column "chargeCategory" TEXT NULL to dev.db...');
  db.prepare(`ALTER TABLE "PayrollEntry" ADD COLUMN "chargeCategory" TEXT`).run();
} else {
  console.log('✓ "chargeCategory" already exists — skipping.');
}

console.log('✓ Done.');
db.close();
