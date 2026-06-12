// Migration: add BlitzAnnouncement — the durable record of a blitz
// broadcast (Josh's 2026-06-12 feedback: sent broadcasts were email-only
// and unrecoverable; only a 120-char AuditLog preview existed). The
// broadcast route now creates one row per send BEFORE the email fan-out
// and updates the delivery counts after.
//
// No backfill: the two pre-existing broadcasts have no full-text DB
// record (recoverable manually from the email archive if wanted).
//
// Reversible — down() drops the table + index. Idempotent: every step
// checks existence first.

import { runMigration, tableExists, indexExists } from './migrate-helpers.mjs';

async function up(client) {
  if (await tableExists(client, 'BlitzAnnouncement')) {
    console.log('  = BlitzAnnouncement already exists, skipping');
  } else {
    console.log('  + CREATE BlitzAnnouncement');
    await client.execute(`
      CREATE TABLE "BlitzAnnouncement" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "blitzId" TEXT NOT NULL,
        "senderId" TEXT NOT NULL,
        "senderName" TEXT NOT NULL,
        "senderRole" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "emailSubject" TEXT NOT NULL DEFAULT '',
        "recipientTotal" INTEGER NOT NULL DEFAULT 0,
        "recipientsOk" INTEGER NOT NULL DEFAULT 0,
        "recipientsFailed" INTEGER NOT NULL DEFAULT 0,
        "recipientsSkipped" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BlitzAnnouncement_blitzId_fkey" FOREIGN KEY ("blitzId") REFERENCES "Blitz"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
  }
  if (!(await indexExists(client, 'BlitzAnnouncement_blitzId_createdAt_idx'))) {
    console.log('  + CREATE INDEX BlitzAnnouncement_blitzId_createdAt_idx');
    await client.execute(
      `CREATE INDEX "BlitzAnnouncement_blitzId_createdAt_idx" ON "BlitzAnnouncement"("blitzId", "createdAt")`,
    );
  }
}

async function down(client) {
  if (await indexExists(client, 'BlitzAnnouncement_blitzId_createdAt_idx')) {
    await client.execute(`DROP INDEX "BlitzAnnouncement_blitzId_createdAt_idx"`);
  }
  if (await tableExists(client, 'BlitzAnnouncement')) {
    await client.execute(`DROP TABLE "BlitzAnnouncement"`);
  }
}

runMigration({ name: 'add-blitz-announcements', up, down });
