// One-shot migration: add Project.phaseChangedAt column.
//
// Stamped in app/api/projects/[id]/route.ts whenever a project's phase
// changes, and read in app/dashboard/page.tsx for Needs-Attention staleness
// calc. Null for pre-migration rows — code falls back to soldDate.
//
// Safe and additive, idempotent.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-phase-changed-at.mjs
// Rollback:
//   set -a && . ./.env && set +a && node scripts/migrate-add-phase-changed-at.mjs --down

import { runMigration, columnExists } from "./migrate-helpers.mjs";

async function up(client) {
  if (await columnExists(client, "Project", "phaseChangedAt")) {
    console.log(`✓ Column "phaseChangedAt" already exists — skipping.`);
    return;
  }
  console.log(`Adding column "phaseChangedAt"...`);
  await client.execute(`ALTER TABLE "Project" ADD COLUMN "phaseChangedAt" DATETIME`);
  console.log(`✓ Added.`);
}

async function down(client) {
  if (!(await columnExists(client, "Project", "phaseChangedAt"))) {
    console.log(`✓ Column "phaseChangedAt" already absent — skipping.`);
    return;
  }
  console.log(`Dropping column "phaseChangedAt"...`);
  await client.execute(`ALTER TABLE "Project" DROP COLUMN "phaseChangedAt"`);
  console.log(`✓ Dropped.`);
}

await runMigration({ up, down, name: "add-phase-changed-at" });
process.exit(0);
