// dev.db mirror of migrate-add-no-chain-trainer.mjs.
// Run: node scripts/migrate-dev-db-add-no-chain-trainer.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("Project")`).all();
const cols = info.map((r) => r.name);

if (cols.includes('noChainTrainer')) {
  console.log(`✓ Column "noChainTrainer" already exists.`);
} else {
  console.log(`Adding column "noChainTrainer"...`);
  db.prepare(
    `ALTER TABLE "Project" ADD COLUMN "noChainTrainer" INTEGER NOT NULL DEFAULT 0`,
  ).run();
  console.log(`✓ Added "noChainTrainer".`);
}

db.close();
