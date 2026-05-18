/**
 * One-shot Turso migration: add Phase 2e + 3a columns.
 *
 * Adds:
 *   - Blitz.confirmDeadline (DATETIME nullable) — RSVP cutoff
 *   - Blitz.maxParticipants (INTEGER nullable) — headcount cap
 *   - BlitzParticipant.targetDeals (INTEGER nullable) — per-rep deal goal
 *
 * Idempotent — checks PRAGMA table_info before adding. Safe to re-run.
 *
 * Run locally: `set -a && . ./.env && set +a && node scripts/migrate-add-blitz-rsvp-and-goals.mjs`
 */

import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be in env');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function columnExists(table, column) {
  const result = await client.execute(`PRAGMA table_info("${table}")`);
  return result.rows.some((r) => r.name === column);
}

async function addColumn(table, column, type) {
  if (await columnExists(table, column)) {
    console.log(`✓ ${table}.${column} already exists, skipping`);
    return;
  }
  console.log(`+ Adding ${table}.${column} (${type})`);
  await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
}

async function main() {
  console.log('Migrating Phase 2e + 3a columns to Turso...');
  await addColumn('Blitz', 'confirmDeadline', 'DATETIME');
  await addColumn('Blitz', 'maxParticipants', 'INTEGER');
  await addColumn('BlitzParticipant', 'targetDeals', 'INTEGER');
  console.log('✓ Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
