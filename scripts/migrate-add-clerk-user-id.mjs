// One-shot migration: ADD COLUMN "clerkUserId" TEXT
// to the User table on the Turso production database, plus the unique
// index that the Prisma schema declares.
//
// Safe and additive — nullable column, no existing data is modified.
// Idempotent — checks for the column and the index before adding.
//
// Why this column exists:
//   The new admin deactivation flow needs to call Clerk lifecycle methods
//   (lockUser / unlockUser / deleteUser) which take a Clerk user ID, not
//   an email. Storing the Clerk ID on the User row gives O(1) lookup at
//   deactivation time and survives email changes (a real failure mode for
//   long-running business apps where users change emails over time).
//   Populated lazily by getInternalUser() on each user's next sign-in.
//
// Run with:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-add-clerk-user-id.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function main() {
  // ── Check existing columns ────────────────────────────────────────
  const info = await client.execute(`PRAGMA table_info("User")`);
  const columns = info.rows.map((r) => r.name);
  console.log(`User columns: ${columns.length}`);

  if (columns.includes("clerkUserId")) {
    console.log('✓ Column "clerkUserId" already exists — skipping ADD.');
  } else {
    console.log('Adding column "clerkUserId" TEXT (nullable)...');
    await client.execute(
      `ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT`
    );
    const after = await client.execute(`PRAGMA table_info("User")`);
    const ok = after.rows.some((r) => r.name === "clerkUserId");
    if (!ok) {
      console.error("✗ Column add ran but column is missing — abort.");
      process.exit(1);
    }
    console.log('✓ Column "clerkUserId" added.');
  }

  // ── Unique index (Prisma's @unique generates this) ────────────────
  const idxList = await client.execute(`PRAGMA index_list("User")`);
  const idxNames = idxList.rows.map((r) => r.name);
  const uniqueIdxName = "User_clerkUserId_key";

  if (idxNames.includes(uniqueIdxName)) {
    console.log(`✓ Unique index "${uniqueIdxName}" already exists — skipping.`);
  } else {
    console.log(`Creating unique index "${uniqueIdxName}"...`);
    await client.execute(
      `CREATE UNIQUE INDEX "${uniqueIdxName}" ON "User"("clerkUserId")`
    );
    console.log(`✓ Unique index "${uniqueIdxName}" created.`);
  }

  // ── Secondary lookup index (matches @@index([clerkUserId])) ───────
  const lookupIdxName = "User_clerkUserId_idx";
  if (idxNames.includes(lookupIdxName)) {
    console.log(`✓ Lookup index "${lookupIdxName}" already exists — skipping.`);
  } else {
    console.log(`Creating lookup index "${lookupIdxName}"...`);
    await client.execute(
      `CREATE INDEX "${lookupIdxName}" ON "User"("clerkUserId")`
    );
    console.log(`✓ Lookup index "${lookupIdxName}" created.`);
  }

  console.log("\nMigration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
