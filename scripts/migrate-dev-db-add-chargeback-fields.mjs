// Mirror of migrate-add-chargeback-fields.mjs, but against the local dev.db
// used by the test suite when TURSO env is not set.
//
// Run: node scripts/migrate-dev-db-add-chargeback-fields.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("PayrollEntry")`).all();
const cols = info.map((r) => r.name);

if (!cols.includes('isChargeback')) {
  console.log('Adding column "isChargeback" BOOLEAN NOT NULL DEFAULT 0 to dev.db...');
  db.prepare(`ALTER TABLE "PayrollEntry" ADD COLUMN "isChargeback" BOOLEAN NOT NULL DEFAULT 0`).run();
} else {
  console.log('✓ "isChargeback" already exists — skipping.');
}

if (!cols.includes('chargebackOfId')) {
  console.log('Adding column "chargebackOfId" TEXT NULL to dev.db...');
  db.prepare(`ALTER TABLE "PayrollEntry" ADD COLUMN "chargebackOfId" TEXT`).run();
} else {
  console.log('✓ "chargebackOfId" already exists — skipping.');
}

try {
  db.prepare(`CREATE INDEX IF NOT EXISTS "PayrollEntry_isChargeback_idx" ON "PayrollEntry"("isChargeback")`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS "PayrollEntry_chargebackOfId_idx" ON "PayrollEntry"("chargebackOfId")`).run();
} catch (err) {
  console.warn('Index creation warning (non-fatal):', err.message);
}

console.log('✓ Done.');
db.close();
