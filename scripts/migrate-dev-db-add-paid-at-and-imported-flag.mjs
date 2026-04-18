// Mirror of migrate-add-paid-at-and-imported-flag.mjs against dev.db.
//
// Run: node scripts/migrate-dev-db-add-paid-at-and-imported-flag.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const payCols = db.prepare(`PRAGMA table_info("PayrollEntry")`).all().map((r) => r.name);
if (!payCols.includes('paidAt')) {
  console.log('Adding PayrollEntry.paidAt DATETIME...');
  db.prepare(`ALTER TABLE "PayrollEntry" ADD COLUMN "paidAt" DATETIME`).run();
  console.log('✓ Added.');
} else {
  console.log('✓ PayrollEntry.paidAt already exists — skipping.');
}

const projCols = db.prepare(`PRAGMA table_info("Project")`).all().map((r) => r.name);
if (!projCols.includes('importedFromGlide')) {
  console.log('Adding Project.importedFromGlide BOOLEAN NOT NULL DEFAULT 0...');
  db.prepare(`ALTER TABLE "Project" ADD COLUMN "importedFromGlide" BOOLEAN NOT NULL DEFAULT 0`).run();
  console.log('✓ Added.');
} else {
  console.log('✓ Project.importedFromGlide already exists — skipping.');
}

db.close();
