// Mirror of migrate-add-blitz-rsvp-and-goals.mjs, but against the local
// dev.db used by the test suite when TURSO env is not set.
//
// Phase 2e + 3a adds three columns:
//   - Blitz.confirmDeadline   DateTime?   — RSVP cutoff before startDate
//   - Blitz.maxParticipants   Int?        — capacity cap (null = no cap)
//   - BlitzParticipant.targetDeals Int?   — per-rep goal for leaderboard
//
// Run: node scripts/migrate-dev-db-add-blitz-rsvp-and-goals.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

function ensureColumn(table, name, ddl) {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all();
  const cols = info.map((r) => r.name);
  if (cols.includes(name)) {
    console.log(`✓ "${table}.${name}" already exists — skipping.`);
    return;
  }
  console.log(`Adding column "${table}.${name}" → ${ddl} ...`);
  db.prepare(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${ddl}`).run();
}

ensureColumn('Blitz', 'confirmDeadline', 'DATETIME');
ensureColumn('Blitz', 'maxParticipants', 'INTEGER');
ensureColumn('BlitzParticipant', 'targetDeals', 'INTEGER');

console.log('✓ Done.');
db.close();
