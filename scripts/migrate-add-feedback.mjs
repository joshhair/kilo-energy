// Turso production migration: in-app feedback widget storage.
//
// Adds the `Feedback` table for user-submitted feedback from the floating
// "Send feedback" widget. Operational queue, admin-only. Emails Josh at
// jarvisbyjosh@gmail.com on each submit; row persists regardless of email
// outcome.
//
// Safe: pure additive — new table only. No existing data touched. No FK
// cascades from the rep User side that could affect deletes.
//
// Idempotent: existence-checked at every step. Re-running is a no-op.
//
// Run:
//   set -a && . ./.env && set +a && node scripts/migrate-add-feedback.mjs           # apply
//   set -a && . ./.env && set +a && node scripts/migrate-add-feedback.mjs --down    # rollback (drops the table)

import { runMigration, tableExists, indexExists } from './migrate-helpers.mjs';

async function up(db) {
  if (await tableExists(db, 'Feedback')) {
    console.log('✓ Feedback table already exists — skipping.');
  } else {
    await db.execute(`
      CREATE TABLE "Feedback" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "userRoleSnapshot" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "url" TEXT,
        "userAgent" TEXT,
        "resolved" INTEGER NOT NULL DEFAULT 0,
        "resolvedAt" DATETIME,
        "resolvedBy" TEXT,
        "resolverNote" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    console.log('+ Created Feedback table.');
  }

  if (!(await indexExists(db, 'Feedback_userId_idx'))) {
    await db.execute(`CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId")`);
    console.log('+ Created Feedback_userId_idx.');
  } else {
    console.log('✓ Feedback_userId_idx already exists.');
  }

  if (!(await indexExists(db, 'Feedback_resolved_createdAt_idx'))) {
    await db.execute(`CREATE INDEX "Feedback_resolved_createdAt_idx" ON "Feedback"("resolved", "createdAt")`);
    console.log('+ Created Feedback_resolved_createdAt_idx.');
  } else {
    console.log('✓ Feedback_resolved_createdAt_idx already exists.');
  }

  if (!(await indexExists(db, 'Feedback_createdAt_idx'))) {
    await db.execute(`CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt")`);
    console.log('+ Created Feedback_createdAt_idx.');
  } else {
    console.log('✓ Feedback_createdAt_idx already exists.');
  }
}

async function down(db) {
  if (await tableExists(db, 'Feedback')) {
    await db.execute(`DROP TABLE "Feedback"`);
    console.log('- Dropped Feedback table (indexes auto-dropped).');
  } else {
    console.log('✓ Feedback table does not exist — skipping.');
  }
}

runMigration({ up, down, name: 'add-feedback' });
