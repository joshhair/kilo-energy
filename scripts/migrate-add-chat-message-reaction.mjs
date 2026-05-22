// Migration: create "ChatMessageReaction" table on Turso production.
//
// Lightweight per-user acknowledgement on a ProjectMessage (👍 for v1).
// One row per (messageId, userId, reactionType). Cascade-deletes with
// the parent message. Schema-extensible — reactionType is TEXT so future
// emoji types can ship without another migration.
//
// Safe, additive, idempotent — checks for table existence before
// creating. No data backfill needed (greenfield feature).
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-chat-message-reaction.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function tableExists(name) {
  const rows = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
  return rows.rows.length > 0;
}

async function main() {
  const exists = await tableExists('ChatMessageReaction');
  if (exists) {
    console.log('✓ "ChatMessageReaction" already exists — skipping create.');
    return;
  }
  console.log('Creating "ChatMessageReaction" table…');
  await client.execute(`
    CREATE TABLE "ChatMessageReaction" (
      "id"           TEXT PRIMARY KEY NOT NULL,
      "messageId"    TEXT NOT NULL,
      "userId"       TEXT NOT NULL,
      "reactionType" TEXT NOT NULL DEFAULT 'like',
      "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ChatMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await client.execute(`CREATE UNIQUE INDEX "ChatMessageReaction_messageId_userId_reactionType_key" ON "ChatMessageReaction"("messageId","userId","reactionType")`);
  await client.execute(`CREATE INDEX "ChatMessageReaction_messageId_idx" ON "ChatMessageReaction"("messageId")`);
  await client.execute(`CREATE INDEX "ChatMessageReaction_userId_idx" ON "ChatMessageReaction"("userId")`);
  console.log('✓ Table + indexes created.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
