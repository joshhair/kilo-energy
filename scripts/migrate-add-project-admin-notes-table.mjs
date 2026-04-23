// Migration: create "ProjectAdminNote" table on Turso production +
// backfill existing Project.adminNotes content into one row per project.
//
// Safe, additive, idempotent. The legacy Project.adminNotes column is
// kept (not dropped here) so any read path still hitting it continues
// to work during rollout.
//
// Run with:
//   set -a && . ./.env && set +a && node scripts/migrate-add-project-admin-notes-table.mjs

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
  const exists = await tableExists('ProjectAdminNote');
  if (exists) {
    console.log('✓ "ProjectAdminNote" already exists — skipping create.');
  } else {
    console.log('Creating "ProjectAdminNote" table…');
    await client.execute(`
      CREATE TABLE "ProjectAdminNote" (
        "id"         TEXT PRIMARY KEY NOT NULL,
        "projectId"  TEXT NOT NULL,
        "authorId"   TEXT NOT NULL,
        "authorName" TEXT NOT NULL,
        "text"       TEXT NOT NULL,
        "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProjectAdminNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await client.execute(`CREATE INDEX "ProjectAdminNote_projectId_idx" ON "ProjectAdminNote"("projectId")`);
    await client.execute(`CREATE INDEX "ProjectAdminNote_authorId_idx" ON "ProjectAdminNote"("authorId")`);
    console.log('✓ Table + indexes created.');
  }

  const legacyAuthorId = 'legacy_project_admin_notes_import';
  const seenRows = await client.execute(
    `SELECT "projectId" FROM "ProjectAdminNote" WHERE "authorId" = ?`,
    [legacyAuthorId],
  );
  const already = new Set(seenRows.rows.map((r) => r.projectId));

  const projects = await client.execute(
    `SELECT "id", "adminNotes" FROM "Project" WHERE "adminNotes" IS NOT NULL AND trim("adminNotes") != ''`,
  );
  console.log(`Found ${projects.rows.length} project(s) with legacy admin-notes content.`);

  let backfilled = 0;
  for (const row of projects.rows) {
    if (already.has(row.id)) continue;
    const id = `cl_adminnote_legacy_${row.id}`;
    await client.execute(
      `INSERT INTO "ProjectAdminNote" ("id","projectId","authorId","authorName","text","createdAt") VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [id, row.id, legacyAuthorId, 'Legacy import', row.adminNotes],
    );
    backfilled++;
  }
  console.log(`✓ Backfilled ${backfilled} legacy admin-note rows (${already.size} already present).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
