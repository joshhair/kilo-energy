// Mirror of migrate-add-bvi-handoff.mjs for the local dev.db (better-sqlite3).
//
// Adds the BVI / per-installer handoff schema:
//   - 4 columns on Project (installerIntakeJson, handoffSentAt, handoffLastResendAt, utilityBillFileId)
//   - 5 columns on Installer (primaryEmail, ccEmails, subjectPrefix, handoffEnabled, customNotes)
//   - 5 tables (ProjectFile, ProjectSurveyLink, ProjectInstallerNote, EmailDelivery, StalledAlertConfig)
//   - Backfill: Project.phaseChangedAt = COALESCE(phaseChangedAt, soldDate, createdAt)
//   - Backfill: insert StalledAlertConfig singleton row
//
// Idempotent — safe to re-run. Each step checks existence first.
//
// Run: node scripts/migrate-dev-db-add-bvi-handoff.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

function tableHasColumn(table, column) {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all();
  return info.some((r) => r.name === column);
}

function tableExists(name) {
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).all(name);
  return r.length > 0;
}

function indexExists(name) {
  const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).all(name);
  return r.length > 0;
}

function addColumn(table, column, def) {
  if (tableHasColumn(table, column)) {
    console.log(`✓ ${table}.${column} already exists — skipping.`);
    return;
  }
  db.prepare(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${def}`).run();
  console.log(`✓ Added ${table}.${column}`);
}

function createIndex(name, sql) {
  if (indexExists(name)) {
    console.log(`✓ Index ${name} already exists — skipping.`);
    return;
  }
  db.exec(sql);
  console.log(`✓ Created index ${name}`);
}

// ── Project columns ──────────────────────────────────────────────────────
console.log('\n── Adding Project columns ──');
addColumn('Project', 'installerIntakeJson', 'TEXT');
addColumn('Project', 'handoffSentAt', 'DATETIME');
addColumn('Project', 'handoffLastResendAt', 'DATETIME');
addColumn('Project', 'utilityBillFileId', 'TEXT');

// ── Installer columns ────────────────────────────────────────────────────
console.log('\n── Adding Installer columns ──');
addColumn('Installer', 'primaryEmail', 'TEXT');
addColumn('Installer', 'ccEmails', 'TEXT NOT NULL DEFAULT \'[]\'');
addColumn('Installer', 'subjectPrefix', 'TEXT');
addColumn('Installer', 'handoffEnabled', 'INTEGER NOT NULL DEFAULT 0'); // SQLite boolean
addColumn('Installer', 'customNotes', 'TEXT NOT NULL DEFAULT \'\'');

// ── ProjectFile table ───────────────────────────────────────────────────
console.log('\n── Creating ProjectFile ──');
if (!tableExists('ProjectFile')) {
  db.exec(`
    CREATE TABLE "ProjectFile" (
      "id"           TEXT PRIMARY KEY NOT NULL,
      "projectId"    TEXT NOT NULL,
      "kind"         TEXT NOT NULL,
      "label"        TEXT NOT NULL,
      "originalName" TEXT NOT NULL,
      "blobUrl"      TEXT NOT NULL,
      "blobPath"     TEXT NOT NULL,
      "mimeType"     TEXT NOT NULL,
      "sizeBytes"    INTEGER NOT NULL,
      "uploadedById" TEXT NOT NULL,
      "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ProjectFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
    );
  `);
  console.log('✓ ProjectFile created');
} else {
  console.log('✓ ProjectFile already exists — skipping.');
}
createIndex('ProjectFile_projectId_idx', `CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId")`);
createIndex('ProjectFile_kind_idx', `CREATE INDEX "ProjectFile_kind_idx" ON "ProjectFile"("kind")`);
createIndex('ProjectFile_uploadedById_idx', `CREATE INDEX "ProjectFile_uploadedById_idx" ON "ProjectFile"("uploadedById")`);

// ── ProjectSurveyLink table ──────────────────────────────────────────────
console.log('\n── Creating ProjectSurveyLink ──');
if (!tableExists('ProjectSurveyLink')) {
  db.exec(`
    CREATE TABLE "ProjectSurveyLink" (
      "id"        TEXT PRIMARY KEY NOT NULL,
      "projectId" TEXT NOT NULL,
      "url"       TEXT NOT NULL,
      "label"     TEXT NOT NULL,
      "addedById" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProjectSurveyLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ProjectSurveyLink_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
    );
  `);
  console.log('✓ ProjectSurveyLink created');
} else {
  console.log('✓ ProjectSurveyLink already exists — skipping.');
}
createIndex('ProjectSurveyLink_projectId_idx', `CREATE INDEX "ProjectSurveyLink_projectId_idx" ON "ProjectSurveyLink"("projectId")`);
createIndex('ProjectSurveyLink_addedById_idx', `CREATE INDEX "ProjectSurveyLink_addedById_idx" ON "ProjectSurveyLink"("addedById")`);

// ── ProjectInstallerNote table ───────────────────────────────────────────
console.log('\n── Creating ProjectInstallerNote ──');
if (!tableExists('ProjectInstallerNote')) {
  db.exec(`
    CREATE TABLE "ProjectInstallerNote" (
      "id"        TEXT PRIMARY KEY NOT NULL,
      "projectId" TEXT NOT NULL,
      "body"      TEXT NOT NULL,
      "authorId"  TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProjectInstallerNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ProjectInstallerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
    );
  `);
  console.log('✓ ProjectInstallerNote created');
} else {
  console.log('✓ ProjectInstallerNote already exists — skipping.');
}
createIndex('ProjectInstallerNote_projectId_idx', `CREATE INDEX "ProjectInstallerNote_projectId_idx" ON "ProjectInstallerNote"("projectId")`);
createIndex('ProjectInstallerNote_authorId_idx', `CREATE INDEX "ProjectInstallerNote_authorId_idx" ON "ProjectInstallerNote"("authorId")`);

// ── EmailDelivery table ──────────────────────────────────────────────────
console.log('\n── Creating EmailDelivery ──');
if (!tableExists('EmailDelivery')) {
  db.exec(`
    CREATE TABLE "EmailDelivery" (
      "id"                TEXT PRIMARY KEY NOT NULL,
      "projectId"         TEXT NOT NULL,
      "installerId"       TEXT,
      "providerMessageId" TEXT,
      "toEmails"          TEXT NOT NULL,
      "ccEmails"          TEXT NOT NULL,
      "subject"           TEXT NOT NULL,
      "status"            TEXT NOT NULL,
      "errorReason"       TEXT,
      "sentAt"            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deliveredAt"       DATETIME,
      "bouncedAt"         DATETIME,
      "isTest"            INTEGER NOT NULL DEFAULT 0,
      "createdById"       TEXT NOT NULL,
      CONSTRAINT "EmailDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "EmailDelivery_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "EmailDelivery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
    );
  `);
  console.log('✓ EmailDelivery created');
} else {
  console.log('✓ EmailDelivery already exists — skipping.');
}
createIndex('EmailDelivery_providerMessageId_key', `CREATE UNIQUE INDEX "EmailDelivery_providerMessageId_key" ON "EmailDelivery"("providerMessageId")`);
createIndex('EmailDelivery_projectId_idx', `CREATE INDEX "EmailDelivery_projectId_idx" ON "EmailDelivery"("projectId")`);
createIndex('EmailDelivery_installerId_idx', `CREATE INDEX "EmailDelivery_installerId_idx" ON "EmailDelivery"("installerId")`);
createIndex('EmailDelivery_createdById_idx', `CREATE INDEX "EmailDelivery_createdById_idx" ON "EmailDelivery"("createdById")`);

// ── StalledAlertConfig (admin singleton) ────────────────────────────────
console.log('\n── Creating StalledAlertConfig ──');
if (!tableExists('StalledAlertConfig')) {
  db.exec(`
    CREATE TABLE "StalledAlertConfig" (
      "id"                 TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
      "enabled"            INTEGER NOT NULL DEFAULT 1,
      "soldDateCutoffDays" INTEGER NOT NULL DEFAULT 180,
      "digestRecipients"   TEXT NOT NULL DEFAULT '[]',
      "phaseThresholds"    TEXT NOT NULL DEFAULT '{}',
      "digestSendHourUtc"  INTEGER NOT NULL DEFAULT 15,
      "updatedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedById"        TEXT
    );
  `);
  console.log('✓ StalledAlertConfig created');
} else {
  console.log('✓ StalledAlertConfig already exists — skipping.');
}

// Insert singleton row if missing.
const singleton = db.prepare(`SELECT id FROM "StalledAlertConfig" WHERE id='singleton'`).all();
if (singleton.length === 0) {
  db.prepare(`INSERT INTO "StalledAlertConfig" ("id") VALUES ('singleton')`).run();
  console.log('✓ Inserted StalledAlertConfig singleton row.');
} else {
  console.log('✓ StalledAlertConfig singleton already present.');
}

// ── Backfill: Project.phaseChangedAt ─────────────────────────────────────
console.log('\n── Backfilling Project.phaseChangedAt ──');
// Use COALESCE so we set the ISO string from soldDate if phaseChangedAt is null.
// soldDate is stored as 'YYYY-MM-DD' string; convert to a DATETIME.
// SQLite is forgiving — it'll accept 'YYYY-MM-DD' as a DATETIME for comparison.
const updateRes = db.prepare(`
  UPDATE "Project"
  SET "phaseChangedAt" = COALESCE("phaseChangedAt", "soldDate", "createdAt")
  WHERE "phaseChangedAt" IS NULL
`).run();
console.log(`✓ Backfilled phaseChangedAt on ${updateRes.changes} project(s).`);

console.log('\n── Migration complete ──');
db.close();
