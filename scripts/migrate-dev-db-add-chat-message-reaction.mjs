// Mirror of migrate-add-chat-message-reaction.mjs, against local dev.db
// used by the test suite when TURSO env is not set.
//
// Run: node scripts/migrate-dev-db-add-chat-message-reaction.mjs

import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'dev.db');
const db = new Database(dbPath);

const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ChatMessageReaction'`).get();
if (exists) {
  console.log('✓ "ChatMessageReaction" already exists — skipping.');
} else {
  console.log('Creating "ChatMessageReaction" table in dev.db…');
  db.exec(`
    CREATE TABLE "ChatMessageReaction" (
      "id"           TEXT PRIMARY KEY NOT NULL,
      "messageId"    TEXT NOT NULL,
      "userId"       TEXT NOT NULL,
      "reactionType" TEXT NOT NULL DEFAULT 'like',
      "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ChatMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "ChatMessageReaction_messageId_userId_reactionType_key" ON "ChatMessageReaction"("messageId","userId","reactionType");
    CREATE INDEX "ChatMessageReaction_messageId_idx" ON "ChatMessageReaction"("messageId");
    CREATE INDEX "ChatMessageReaction_userId_idx" ON "ChatMessageReaction"("userId");
  `);
}
console.log('✓ Done.');
db.close();
