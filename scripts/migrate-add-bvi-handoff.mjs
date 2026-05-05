// Turso production migration: BVI / per-installer handoff schema.
//
// Adds:
//   - 4 columns on Project (installerIntakeJson, handoffSentAt, handoffLastResendAt, utilityBillFileId)
//   - 5 columns on Installer (primaryEmail, ccEmails, subjectPrefix, handoffEnabled, customNotes)
//   - 5 tables (ProjectFile, ProjectSurveyLink, ProjectInstallerNote, EmailDelivery, StalledAlertConfig)
//   - Backfill: Project.phaseChangedAt = COALESCE(phaseChangedAt, soldDate, createdAt) for legacy null rows
//   - Backfill: insert StalledAlertConfig singleton row
//
// Safe: pure additive — nullable / defaulted columns, new tables. Existing data untouched
// except for the phaseChangedAt backfill (which only writes where null, never overwrites).
//
// Idempotent: every step checks existence before acting. Both up() and down() are safe to re-run.
//
// Run:
//   set -a && . ./.env && set +a && node scripts/migrate-add-bvi-handoff.mjs           # apply
//   set -a && . ./.env && set +a && node scripts/migrate-add-bvi-handoff.mjs --down    # rollback (drops the new tables; columns left in place — Turso/SQLite cannot DROP COLUMN)

import { runMigration, columnExists, tableExists, indexExists } from "./migrate-helpers.mjs";

async function addColumn(db, table, column, def) {
  if (await columnExists(db, table, column)) {
    console.log(`✓ ${table}.${column} already exists — skipping.`);
    return;
  }
  await db.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${def}`);
  console.log(`✓ Added ${table}.${column}`);
}

async function createIndex(db, name, sql) {
  if (await indexExists(db, name)) {
    console.log(`✓ Index ${name} already exists — skipping.`);
    return;
  }
  await db.execute(sql);
  console.log(`✓ Created index ${name}`);
}

async function up(db) {
  // ── Project columns ────────────────────────────────────────────────
  console.log('\n── Adding Project columns ──');
  await addColumn(db, 'Project', 'installerIntakeJson', 'TEXT');
  await addColumn(db, 'Project', 'handoffSentAt', 'DATETIME');
  await addColumn(db, 'Project', 'handoffLastResendAt', 'DATETIME');
  await addColumn(db, 'Project', 'utilityBillFileId', 'TEXT');

  // ── Installer columns ──────────────────────────────────────────────
  console.log('\n── Adding Installer columns ──');
  await addColumn(db, 'Installer', 'primaryEmail', 'TEXT');
  await addColumn(db, 'Installer', 'ccEmails', `TEXT NOT NULL DEFAULT '[]'`);
  await addColumn(db, 'Installer', 'subjectPrefix', 'TEXT');
  await addColumn(db, 'Installer', 'handoffEnabled', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn(db, 'Installer', 'customNotes', `TEXT NOT NULL DEFAULT ''`);

  // ── ProjectFile ────────────────────────────────────────────────────
  console.log('\n── Creating ProjectFile ──');
  if (await tableExists(db, 'ProjectFile')) {
    console.log('✓ ProjectFile already exists — skipping.');
  } else {
    await db.execute(`
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
      )
    `);
    console.log('✓ ProjectFile created');
  }
  await createIndex(db, 'ProjectFile_projectId_idx', `CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId")`);
  await createIndex(db, 'ProjectFile_kind_idx', `CREATE INDEX "ProjectFile_kind_idx" ON "ProjectFile"("kind")`);
  await createIndex(db, 'ProjectFile_uploadedById_idx', `CREATE INDEX "ProjectFile_uploadedById_idx" ON "ProjectFile"("uploadedById")`);

  // ── ProjectSurveyLink ──────────────────────────────────────────────
  console.log('\n── Creating ProjectSurveyLink ──');
  if (await tableExists(db, 'ProjectSurveyLink')) {
    console.log('✓ ProjectSurveyLink already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "ProjectSurveyLink" (
        "id"        TEXT PRIMARY KEY NOT NULL,
        "projectId" TEXT NOT NULL,
        "url"       TEXT NOT NULL,
        "label"     TEXT NOT NULL,
        "addedById" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProjectSurveyLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ProjectSurveyLink_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
      )
    `);
    console.log('✓ ProjectSurveyLink created');
  }
  await createIndex(db, 'ProjectSurveyLink_projectId_idx', `CREATE INDEX "ProjectSurveyLink_projectId_idx" ON "ProjectSurveyLink"("projectId")`);
  await createIndex(db, 'ProjectSurveyLink_addedById_idx', `CREATE INDEX "ProjectSurveyLink_addedById_idx" ON "ProjectSurveyLink"("addedById")`);

  // ── ProjectInstallerNote ───────────────────────────────────────────
  console.log('\n── Creating ProjectInstallerNote ──');
  if (await tableExists(db, 'ProjectInstallerNote')) {
    console.log('✓ ProjectInstallerNote already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "ProjectInstallerNote" (
        "id"        TEXT PRIMARY KEY NOT NULL,
        "projectId" TEXT NOT NULL,
        "body"      TEXT NOT NULL,
        "authorId"  TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProjectInstallerNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ProjectInstallerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
      )
    `);
    console.log('✓ ProjectInstallerNote created');
  }
  await createIndex(db, 'ProjectInstallerNote_projectId_idx', `CREATE INDEX "ProjectInstallerNote_projectId_idx" ON "ProjectInstallerNote"("projectId")`);
  await createIndex(db, 'ProjectInstallerNote_authorId_idx', `CREATE INDEX "ProjectInstallerNote_authorId_idx" ON "ProjectInstallerNote"("authorId")`);

  // ── EmailDelivery ──────────────────────────────────────────────────
  console.log('\n── Creating EmailDelivery ──');
  if (await tableExists(db, 'EmailDelivery')) {
    console.log('✓ EmailDelivery already exists — skipping.');
  } else {
    await db.execute(`
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
      )
    `);
    console.log('✓ EmailDelivery created');
  }
  await createIndex(db, 'EmailDelivery_providerMessageId_key', `CREATE UNIQUE INDEX "EmailDelivery_providerMessageId_key" ON "EmailDelivery"("providerMessageId")`);
  await createIndex(db, 'EmailDelivery_projectId_idx', `CREATE INDEX "EmailDelivery_projectId_idx" ON "EmailDelivery"("projectId")`);
  await createIndex(db, 'EmailDelivery_installerId_idx', `CREATE INDEX "EmailDelivery_installerId_idx" ON "EmailDelivery"("installerId")`);
  await createIndex(db, 'EmailDelivery_createdById_idx', `CREATE INDEX "EmailDelivery_createdById_idx" ON "EmailDelivery"("createdById")`);

  // ── StalledAlertConfig (admin singleton) ──────────────────────────
  console.log('\n── Creating StalledAlertConfig ──');
  if (await tableExists(db, 'StalledAlertConfig')) {
    console.log('✓ StalledAlertConfig already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "StalledAlertConfig" (
        "id"                 TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
        "enabled"            INTEGER NOT NULL DEFAULT 1,
        "soldDateCutoffDays" INTEGER NOT NULL DEFAULT 180,
        "digestRecipients"   TEXT NOT NULL DEFAULT '[]',
        "phaseThresholds"    TEXT NOT NULL DEFAULT '{}',
        "digestSendHourUtc"  INTEGER NOT NULL DEFAULT 15,
        "updatedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedById"        TEXT
      )
    `);
    console.log('✓ StalledAlertConfig created');
  }
  // Insert singleton row if missing.
  const existing = await db.execute(`SELECT id FROM "StalledAlertConfig" WHERE id='singleton'`);
  if (existing.rows.length === 0) {
    await db.execute(`INSERT INTO "StalledAlertConfig" ("id") VALUES ('singleton')`);
    console.log('✓ Inserted StalledAlertConfig singleton row.');
  } else {
    console.log('✓ StalledAlertConfig singleton already present.');
  }

  // ── Backfill: Project.phaseChangedAt ──────────────────────────────
  console.log('\n── Backfilling Project.phaseChangedAt ──');
  const before = await db.execute(`SELECT COUNT(*) as n FROM "Project" WHERE "phaseChangedAt" IS NULL`);
  const nullCount = Number(before.rows[0]?.n ?? 0);
  if (nullCount > 0) {
    await db.execute(`
      UPDATE "Project"
      SET "phaseChangedAt" = COALESCE("phaseChangedAt", "soldDate", "createdAt")
      WHERE "phaseChangedAt" IS NULL
    `);
    console.log(`✓ Backfilled phaseChangedAt on ${nullCount} project(s).`);
  } else {
    console.log('✓ No null phaseChangedAt rows — skipping backfill.');
  }
}

async function down(db) {
  // SQLite/libSQL cannot DROP COLUMN. The column additions are left in
  // place. Tables can be dropped though — that's the meaningful rollback.
  console.log('\n── Dropping tables (column drops not supported by SQLite) ──');
  for (const t of ['EmailDelivery', 'ProjectInstallerNote', 'ProjectSurveyLink', 'ProjectFile', 'StalledAlertConfig']) {
    if (await tableExists(db, t)) {
      await db.execute(`DROP TABLE "${t}"`);
      console.log(`✓ Dropped ${t}`);
    } else {
      console.log(`– ${t} not present`);
    }
  }
  console.log('\nNote: Project + Installer column additions cannot be rolled back automatically.');
  console.log('To fully revert, restore from a Turso snapshot (docs/runbooks/restore-from-backup.md).');
}

runMigration({ up, down, name: "add-bvi-handoff" });
