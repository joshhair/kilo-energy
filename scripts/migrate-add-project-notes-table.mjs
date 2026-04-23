// Migration: create "ProjectNote" table on Turso production + backfill
// existing Project.notes content into one row per project.
//
// Safe, additive, idempotent. The legacy Project.notes column is kept
// (not dropped here) so any read path still hitting it continues to
// work during rollout. A follow-up cleanup can drop it once the UI
// fully switches over.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-project-notes-table.mjs

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
  const exists = await tableExists('ProjectNote');
  if (exists) {
    console.log('✓ "ProjectNote" already exists — skipping create.');
  } else {
    console.log('Creating "ProjectNote" table…');
    await client.execute(`
      CREATE TABLE "ProjectNote" (
        "id"         TEXT PRIMARY KEY NOT NULL,
        "projectId"  TEXT NOT NULL,
        "authorId"   TEXT NOT NULL,
        "authorName" TEXT NOT NULL,
        "text"       TEXT NOT NULL,
        "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProjectNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await client.execute(`CREATE INDEX "ProjectNote_projectId_idx" ON "ProjectNote"("projectId")`);
    await client.execute(`CREATE INDEX "ProjectNote_authorId_idx" ON "ProjectNote"("authorId")`);
    console.log('✓ Table + indexes created.');
  }

  // Backfill legacy Project.notes content → ProjectNote rows. Skip
  // projects whose notes field is empty or whose first-import row is
  // already present (identified by a sentinel authorId value).
  const legacyAuthorId = 'legacy_project_notes_import';
  const seenRows = await client.execute(
    `SELECT "projectId" FROM "ProjectNote" WHERE "authorId" = ?`,
    [legacyAuthorId],
  );
  const already = new Set(seenRows.rows.map((r) => r.projectId));

  const projects = await client.execute(
    `SELECT "id", "notes" FROM "Project" WHERE "notes" IS NOT NULL AND trim("notes") != ''`,
  );
  console.log(`Found ${projects.rows.length} project(s) with legacy notes content.`);

  let backfilled = 0;
  for (const row of projects.rows) {
    if (already.has(row.id)) continue;
    const id = `cl_note_legacy_${row.id}`;
    await client.execute(
      `INSERT INTO "ProjectNote" ("id","projectId","authorId","authorName","text","createdAt") VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [id, row.id, legacyAuthorId, 'Legacy import', row.notes],
    );
    backfilled++;
  }
  console.log(`✓ Backfilled ${backfilled} legacy note rows (${already.size} already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
