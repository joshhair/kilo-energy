// Mirror of migrate-add-reimbursement-receipt-archive.mjs, but against
// the local dev.db (used by the test suite when TURSO env is not set).
//
// Run: node scripts/migrate-dev-db-add-reimbursement-receipt-archive.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("Reimbursement")`).all();
const cols = info.map((r) => r.name);

if (!cols.includes('receiptUrl')) {
  console.log('Adding column "receiptUrl" TEXT...');
  db.prepare(`ALTER TABLE "Reimbursement" ADD COLUMN "receiptUrl" TEXT`).run();
  console.log('✓ Added.');
} else {
  console.log('✓ Column "receiptUrl" already exists in dev.db — skipping.');
}
if (!cols.includes('archivedAt')) {
  console.log('Adding column "archivedAt" DATETIME...');
  db.prepare(`ALTER TABLE "Reimbursement" ADD COLUMN "archivedAt" DATETIME`).run();
  console.log('✓ Added.');
} else {
  console.log('✓ Column "archivedAt" already exists in dev.db — skipping.');
}

// Index
const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='Reimbursement_archivedAt_idx'`).get();
if (!idx) {
  db.prepare(`CREATE INDEX IF NOT EXISTS "Reimbursement_archivedAt_idx" ON "Reimbursement"("archivedAt")`).run();
  console.log('✓ Index created.');
} else {
  console.log('✓ Index already exists — skipping.');
}

db.close();
