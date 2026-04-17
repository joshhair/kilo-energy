// dev.db mirror of migrate-add-project-trainer.mjs.
// Run: node scripts/migrate-dev-db-add-project-trainer.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const info = db.prepare(`PRAGMA table_info("Project")`).all();
const cols = info.map((r) => r.name);

const addIfMissing = (name, ddl) => {
  if (cols.includes(name)) {
    console.log(`✓ Column "${name}" already exists.`);
    return;
  }
  console.log(`Adding column "${name}"...`);
  db.prepare(ddl).run();
  console.log(`✓ Added "${name}".`);
};

addIfMissing('trainerId', `ALTER TABLE "Project" ADD COLUMN "trainerId" TEXT REFERENCES "User"("id")`);
addIfMissing('trainerRate', `ALTER TABLE "Project" ADD COLUMN "trainerRate" REAL`);
db.prepare(`CREATE INDEX IF NOT EXISTS "Project_trainerId_idx" ON "Project"("trainerId")`).run();
console.log('✓ Index ensured.');

db.close();
