// Shared helpers for manual Turso migrations.
//
// Conventions enforced:
// - Each migration exports `up(client)` and `down(client)`.
// - `up` is required; `down` is optional but strongly encouraged. If a
//   migration is genuinely one-way (e.g. lossy data transform), export
//   `down = null` to make the intent explicit.
// - Both must be idempotent — check for existence before creating/dropping.
//
// Invocation:
//   set -a && . ./.env && set +a && node scripts/migrate-xxx.mjs          # runs up()
//   set -a && . ./.env && set +a && node scripts/migrate-xxx.mjs --down   # runs down() (rollback)
//
// Safety: down() is destructive by definition. Operator must pass --down
// explicitly; never fires by default.

import { createClient } from "@libsql/client";

export function makeClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env");
    process.exit(1);
  }
  return createClient({ url, authToken });
}

/** Run one of up() / down() based on CLI args. */
export async function runMigration({ up, down, name }) {
  const args = process.argv.slice(2);
  const direction = args.includes("--down") ? "down" : "up";
  const client = makeClient();

  console.log(`── Migration: ${name} (${direction}) ──`);

  if (direction === "down") {
    if (!down) {
      console.error(`Migration "${name}" declared no down() — rollback is not supported.`);
      console.error(`This is typically because the up() is lossy or structurally irreversible.`);
      console.error(`To undo, restore from a Turso snapshot (see docs/runbooks/restore-from-backup.md).`);
      process.exit(1);
    }
    console.log("⚠️  Running DOWN — destructive. Ctrl+C now if this is not what you wanted.");
    await sleep(3000);
    await down(client);
  } else {
    await up(client);
  }
  console.log("✓ Migration complete.");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function columnExists(client, table, column) {
  const info = await client.execute(`PRAGMA table_info("${table}")`);
  return info.rows.some((r) => r.name === column);
}

export async function tableExists(client, name) {
  const r = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}

export async function indexExists(client, name) {
  const r = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND name = ?`,
    args: [name],
  });
  return r.rows.length > 0;
}
