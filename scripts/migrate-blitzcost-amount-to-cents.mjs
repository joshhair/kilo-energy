/**
 * migrate-blitzcost-amount-to-cents.mjs
 *
 * Aligns the live Turso schema with Prisma's `BlitzCost.amountCents Int`.
 * Today, Turso has `amount REAL NOT NULL` and the route at
 * app/api/blitzes/[id]/costs/route.ts writes `amountCents` — so the Prisma
 * insert silently routes to a column the DB doesn't have. Behavior
 * depends on libSQL/Prisma adapter coercion: at best the cost write fails;
 * at worst the value is silently dropped. Either way, blitz costs are
 * unreliable today.
 *
 * Strategy: expand-then-contract.
 *   up()
 *     1. Add `amountCents INTEGER NOT NULL DEFAULT 0` to BlitzCost
 *     2. Backfill: amountCents = ROUND(amount * 100) for existing rows
 *     3. (Old `amount` REAL column LEFT IN PLACE — see note below.)
 *
 *   down()
 *     1. Drop `amountCents` column.
 *
 * Why we don't drop `amount` in this migration:
 *   • SQLite doesn't support ALTER TABLE DROP COLUMN reliably across
 *     versions; the safe pattern is "expand → migrate readers/writers
 *     → contract" across multiple PRs.
 *   • Right now Prisma writes amountCents and never reads `amount`, so
 *     leaving the old column orphaned is fine — it'll just sit there.
 *   • Drop in a follow-up migration after we've confirmed in production
 *     that amountCents is the only column ever read / written.
 *
 * Pre-flight (mandatory before --commit):
 *   1. npm run backup:now              ← Turso snapshot
 *   2. node scripts/migrate-blitzcost-amount-to-cents.mjs  ← idempotent up()
 *   3. spot-check: any BlitzCost row should now show both `amount` and
 *      `amountCents`, with amountCents == ROUND(amount * 100).
 *
 * Rollback:
 *   node scripts/migrate-blitzcost-amount-to-cents.mjs --down
 *   (Drops the new amountCents column. amount data is preserved untouched.)
 */

import { runMigration, columnExists } from "./migrate-helpers.mjs";

async function up(client) {
  const hasAmountCents = await columnExists(client, "BlitzCost", "amountCents");

  if (!hasAmountCents) {
    console.log("Adding BlitzCost.amountCents …");
    await client.execute(`
      ALTER TABLE "BlitzCost"
      ADD COLUMN "amountCents" INTEGER NOT NULL DEFAULT 0
    `);
    console.log("Backfilling amountCents from amount …");
    const result = await client.execute(`
      UPDATE "BlitzCost" SET "amountCents" = CAST(ROUND("amount" * 100) AS INTEGER)
      WHERE "amountCents" = 0 AND "amount" IS NOT NULL
    `);
    console.log(`  Updated ${result.rowsAffected ?? 0} rows.`);
  } else {
    console.log("BlitzCost.amountCents already exists — skipping ADD COLUMN.");
    // Re-run backfill anyway, in case prior backfill missed rows added since.
    const result = await client.execute(`
      UPDATE "BlitzCost" SET "amountCents" = CAST(ROUND("amount" * 100) AS INTEGER)
      WHERE "amountCents" = 0 AND "amount" IS NOT NULL AND "amount" > 0
    `);
    console.log(`  Re-backfilled ${result.rowsAffected ?? 0} rows that had amountCents=0.`);
  }

  // Sanity check: report any remaining mismatch
  const mismatches = await client.execute(`
    SELECT id, amount, amountCents
    FROM "BlitzCost"
    WHERE CAST(ROUND("amount" * 100) AS INTEGER) <> "amountCents"
    LIMIT 10
  `);
  if (mismatches.rows.length > 0) {
    console.warn(`⚠️  ${mismatches.rows.length} BlitzCost row(s) have amount * 100 ≠ amountCents:`);
    for (const row of mismatches.rows) {
      console.warn(`    id=${row.id}  amount=${row.amount}  amountCents=${row.amountCents}`);
    }
    console.warn(`These were likely written by code that bypassed the cents column. Review manually.`);
  } else {
    console.log("✓ All BlitzCost rows have amount * 100 == amountCents.");
  }
}

async function down(client) {
  // SQLite supports DROP COLUMN as of 3.35 (2021). libSQL inherits this.
  const hasAmountCents = await columnExists(client, "BlitzCost", "amountCents");
  if (!hasAmountCents) {
    console.log("BlitzCost.amountCents already absent — nothing to drop.");
    return;
  }
  console.log("Dropping BlitzCost.amountCents …");
  await client.execute(`ALTER TABLE "BlitzCost" DROP COLUMN "amountCents"`);
  console.log("✓ Dropped.");
}

await runMigration({ up, down, name: "blitzcost-amount-to-cents" });
