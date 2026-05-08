// Turso production migration: notification system schema.
//
// Adds:
//   - 4 columns on User (notificationPhone, notificationPhoneVerifiedAt,
//     quietHoursStartUtc, quietHoursEndUtc)
//   - 3 tables (NotificationPreference, NotificationDelivery, PushSubscription)
//   - All supporting indexes from prisma/schema.prisma
//
// Safe: pure additive — nullable columns + new tables. Existing data untouched.
//
// Idempotent: every step checks existence before acting.
//
// Run:
//   set -a && . ./.env && set +a && node scripts/migrate-add-notifications.mjs           # apply
//   set -a && . ./.env && set +a && node scripts/migrate-add-notifications.mjs --down    # rollback

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
  // ── User columns ───────────────────────────────────────────────────
  console.log('\n── Adding User columns ──');
  await addColumn(db, 'User', 'notificationPhone', 'TEXT');
  await addColumn(db, 'User', 'notificationPhoneVerifiedAt', 'DATETIME');
  await addColumn(db, 'User', 'quietHoursStartUtc', 'INTEGER');
  await addColumn(db, 'User', 'quietHoursEndUtc', 'INTEGER');

  // ── NotificationPreference ─────────────────────────────────────────
  console.log('\n── Creating NotificationPreference ──');
  if (await tableExists(db, 'NotificationPreference')) {
    console.log('✓ NotificationPreference already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "NotificationPreference" (
        "id"           TEXT PRIMARY KEY NOT NULL,
        "userId"       TEXT NOT NULL,
        "eventType"    TEXT NOT NULL,
        "emailEnabled" INTEGER NOT NULL DEFAULT 1,
        "smsEnabled"   INTEGER NOT NULL DEFAULT 0,
        "pushEnabled"  INTEGER NOT NULL DEFAULT 0,
        "digestMode"   TEXT NOT NULL DEFAULT 'instant',
        "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    console.log('✓ NotificationPreference created');
  }
  await createIndex(db, 'NotificationPreference_userId_eventType_key',
    `CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_key" ON "NotificationPreference"("userId", "eventType")`);
  await createIndex(db, 'NotificationPreference_userId_idx',
    `CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId")`);

  // ── NotificationDelivery ───────────────────────────────────────────
  console.log('\n── Creating NotificationDelivery ──');
  if (await tableExists(db, 'NotificationDelivery')) {
    console.log('✓ NotificationDelivery already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "NotificationDelivery" (
        "id"                TEXT PRIMARY KEY NOT NULL,
        "userId"            TEXT,
        "eventType"         TEXT NOT NULL,
        "channel"           TEXT NOT NULL,
        "toAddress"         TEXT NOT NULL,
        "providerMessageId" TEXT,
        "status"            TEXT NOT NULL,
        "errorReason"       TEXT,
        "payloadJson"       TEXT,
        "projectId"         TEXT,
        "sentAt"            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deliveredAt"       DATETIME,
        "bouncedAt"         DATETIME,
        CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "NotificationDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    console.log('✓ NotificationDelivery created');
  }
  await createIndex(db, 'NotificationDelivery_providerMessageId_key',
    `CREATE UNIQUE INDEX "NotificationDelivery_providerMessageId_key" ON "NotificationDelivery"("providerMessageId")`);
  await createIndex(db, 'NotificationDelivery_userId_idx',
    `CREATE INDEX "NotificationDelivery_userId_idx" ON "NotificationDelivery"("userId")`);
  await createIndex(db, 'NotificationDelivery_projectId_idx',
    `CREATE INDEX "NotificationDelivery_projectId_idx" ON "NotificationDelivery"("projectId")`);
  await createIndex(db, 'NotificationDelivery_eventType_sentAt_idx',
    `CREATE INDEX "NotificationDelivery_eventType_sentAt_idx" ON "NotificationDelivery"("eventType", "sentAt")`);

  // ── PushSubscription ───────────────────────────────────────────────
  console.log('\n── Creating PushSubscription ──');
  if (await tableExists(db, 'PushSubscription')) {
    console.log('✓ PushSubscription already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "PushSubscription" (
        "id"          TEXT PRIMARY KEY NOT NULL,
        "userId"      TEXT NOT NULL,
        "provider"    TEXT NOT NULL DEFAULT 'web_push',
        "endpoint"    TEXT NOT NULL,
        "p256dh"      TEXT,
        "auth"        TEXT,
        "nativeToken" TEXT,
        "userAgent"   TEXT,
        "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    console.log('✓ PushSubscription created');
  }
  await createIndex(db, 'PushSubscription_endpoint_key',
    `CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`);
  await createIndex(db, 'PushSubscription_userId_idx',
    `CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId")`);
}

async function down(db) {
  // SQLite/libSQL cannot DROP COLUMN. The User column additions stay.
  // Tables can be dropped — that's the meaningful rollback.
  console.log('\n── Dropping notification tables (column drops not supported by SQLite) ──');
  for (const t of ['NotificationDelivery', 'NotificationPreference', 'PushSubscription']) {
    if (await tableExists(db, t)) {
      await db.execute(`DROP TABLE "${t}"`);
      console.log(`✓ Dropped ${t}`);
    } else {
      console.log(`– ${t} not present`);
    }
  }
  console.log('\nNote: User column additions cannot be rolled back automatically.');
  console.log('To fully revert, restore from a Turso snapshot (docs/runbooks/restore-from-backup.md).');
}

runMigration({ up, down, name: "add-notifications" });
