// dev.db mirror of migrate-add-notifications.mjs.
// Run: node scripts/migrate-dev-db-add-notifications.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

function tableExists(name) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!row;
}

function indexExists(name) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(name);
  return !!row;
}

function columnExists(table, column) {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all();
  return info.some((r) => r.name === column);
}

function addColumn(table, column, def) {
  if (columnExists(table, column)) {
    console.log(`✓ ${table}.${column} already exists.`);
    return;
  }
  db.prepare(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${def}`).run();
  console.log(`✓ Added ${table}.${column}.`);
}

function ensureIndex(name, sql) {
  if (indexExists(name)) {
    console.log(`✓ Index ${name} already exists.`);
    return;
  }
  db.prepare(sql).run();
  console.log(`✓ Created index ${name}.`);
}

// ── User columns ──
addColumn('User', 'notificationPhone', 'TEXT');
addColumn('User', 'notificationPhoneVerifiedAt', 'DATETIME');
addColumn('User', 'quietHoursStartUtc', 'INTEGER');
addColumn('User', 'quietHoursEndUtc', 'INTEGER');

// ── NotificationPreference ──
if (tableExists('NotificationPreference')) {
  console.log('✓ NotificationPreference already exists.');
} else {
  db.prepare(`
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
  `).run();
  console.log('✓ NotificationPreference created.');
}
ensureIndex('NotificationPreference_userId_eventType_key',
  `CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_key" ON "NotificationPreference"("userId", "eventType")`);
ensureIndex('NotificationPreference_userId_idx',
  `CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId")`);

// ── NotificationDelivery ──
if (tableExists('NotificationDelivery')) {
  console.log('✓ NotificationDelivery already exists.');
} else {
  db.prepare(`
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
  `).run();
  console.log('✓ NotificationDelivery created.');
}
ensureIndex('NotificationDelivery_providerMessageId_key',
  `CREATE UNIQUE INDEX "NotificationDelivery_providerMessageId_key" ON "NotificationDelivery"("providerMessageId")`);
ensureIndex('NotificationDelivery_userId_idx',
  `CREATE INDEX "NotificationDelivery_userId_idx" ON "NotificationDelivery"("userId")`);
ensureIndex('NotificationDelivery_projectId_idx',
  `CREATE INDEX "NotificationDelivery_projectId_idx" ON "NotificationDelivery"("projectId")`);
ensureIndex('NotificationDelivery_eventType_sentAt_idx',
  `CREATE INDEX "NotificationDelivery_eventType_sentAt_idx" ON "NotificationDelivery"("eventType", "sentAt")`);

// ── PushSubscription ──
if (tableExists('PushSubscription')) {
  console.log('✓ PushSubscription already exists.');
} else {
  db.prepare(`
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
  `).run();
  console.log('✓ PushSubscription created.');
}
ensureIndex('PushSubscription_endpoint_key',
  `CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`);
ensureIndex('PushSubscription_userId_idx',
  `CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId")`);

db.close();
console.log('\nDev DB migration complete.');
