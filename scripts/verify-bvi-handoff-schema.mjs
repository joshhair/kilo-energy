// Quick verification that the BVI handoff migration applied to Turso prod.
// Reads PRAGMA table_info on each touched table and reports the new columns + tables.
//
// Run: set -a && . ./.env && set +a && node scripts/verify-bvi-handoff-schema.mjs

import { makeClient } from "./migrate-helpers.mjs";

const db = makeClient();

const NEW_PROJECT_COLS = ['installerIntakeJson', 'handoffSentAt', 'handoffLastResendAt', 'utilityBillFileId'];
const NEW_INSTALLER_COLS = ['primaryEmail', 'ccEmails', 'subjectPrefix', 'handoffEnabled', 'customNotes'];
const NEW_TABLES = ['ProjectFile', 'ProjectSurveyLink', 'ProjectInstallerNote', 'EmailDelivery', 'StalledAlertConfig'];

let ok = true;

function fail(msg) { console.error(`✗ ${msg}`); ok = false; }
function pass(msg) { console.log(`✓ ${msg}`); }

async function checkColumn(table, col) {
  const info = await db.execute(`PRAGMA table_info("${table}")`);
  if (info.rows.some(r => r.name === col)) pass(`${table}.${col} present`);
  else fail(`${table}.${col} MISSING`);
}

async function checkTable(name) {
  const r = await db.execute({ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, args: [name] });
  if (r.rows.length > 0) pass(`Table ${name} present`);
  else fail(`Table ${name} MISSING`);
}

console.log('── Project columns ──');
for (const c of NEW_PROJECT_COLS) await checkColumn('Project', c);

console.log('\n── Installer columns ──');
for (const c of NEW_INSTALLER_COLS) await checkColumn('Installer', c);

console.log('\n── New tables ──');
for (const t of NEW_TABLES) await checkTable(t);

console.log('\n── StalledAlertConfig singleton ──');
const sing = await db.execute(`SELECT id, enabled, soldDateCutoffDays FROM "StalledAlertConfig" WHERE id='singleton'`);
if (sing.rows.length === 1) {
  pass(`Singleton row: ${JSON.stringify(sing.rows[0])}`);
} else {
  fail(`Singleton row count: ${sing.rows.length}`);
}

console.log('\n── phaseChangedAt backfill ──');
const nullCount = await db.execute(`SELECT COUNT(*) as n FROM "Project" WHERE "phaseChangedAt" IS NULL`);
const totalCount = await db.execute(`SELECT COUNT(*) as n FROM "Project"`);
const remaining = Number(nullCount.rows[0]?.n ?? -1);
const total = Number(totalCount.rows[0]?.n ?? -1);
if (remaining === 0) pass(`All ${total} projects have phaseChangedAt set (0 remaining null)`);
else fail(`${remaining}/${total} projects still have null phaseChangedAt`);

console.log('\n── Indexes ──');
const expectedIndexes = [
  'ProjectFile_projectId_idx', 'ProjectFile_kind_idx', 'ProjectFile_uploadedById_idx',
  'ProjectSurveyLink_projectId_idx', 'ProjectSurveyLink_addedById_idx',
  'ProjectInstallerNote_projectId_idx', 'ProjectInstallerNote_authorId_idx',
  'EmailDelivery_providerMessageId_key', 'EmailDelivery_projectId_idx', 'EmailDelivery_installerId_idx', 'EmailDelivery_createdById_idx',
];
for (const ix of expectedIndexes) {
  const r = await db.execute({ sql: `SELECT name FROM sqlite_master WHERE type='index' AND name=?`, args: [ix] });
  if (r.rows.length > 0) pass(`Index ${ix}`);
  else fail(`Index ${ix} MISSING`);
}

console.log(ok ? '\n✓ Schema verified.' : '\n✗ Schema verification FAILED.');
process.exit(ok ? 0 : 1);
