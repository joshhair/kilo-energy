// Data migration: move all notes/messages on Glide-imported projects
// into the admin-only ProjectAdminNote table so they're never exposed
// to reps, trainers, or sub-dealers via the rep-visible Notes / Chatter
// surfaces. Glide's "Deal Note" rows landed in ProjectMessage during
// the 2026-04-16 bulk import (per scripts/import-glide.mts stage 8),
// and the per-deal "Rep Note" textarea landed in Project.notes — both
// surfaces are rep-visible by default. This migration relocates them.
//
// What it does for each project where importedFromGlide=true:
//   1. For every ProjectMessage on the project: create a matching
//      ProjectAdminNote (same text, authorId/Name, createdAt) then
//      delete the ProjectMessage row.
//   2. If Project.notes has content: create a ProjectAdminNote with
//      that content (authored by "Glide Import" using the importing
//      admin's id) and clear Project.notes.
//   3. Existing ProjectNote rows on the project: also relocated to
//      ProjectAdminNote and deleted.
//
// Idempotent: re-running is safe — once a project has no
// ProjectMessage / ProjectNote rows and Project.notes is empty, the
// migration does nothing for that project.
//
// Run against Turso production:
//   set -a && . ./.env && set +a && node scripts/migrate-glide-notes-to-admin-only.mjs
// or with COMMIT=true to actually write (otherwise dry-run):
//   COMMIT=true node scripts/migrate-glide-notes-to-admin-only.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const COMMIT = process.env.COMMIT === 'true';

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
  process.exit(1);
}

const client = createClient({ url, authToken });

function cuid() {
  // Quick CUID-like id for inserted rows. The schema generator uses
  // @default(cuid()) but raw SQL inserts need an explicit id.
  return 'cl' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// Resolve the importing admin's user id to attribute the legacy
// Project.notes textarea content to. Falls back to "system" if no
// admin is found.
async function resolveImportAdminId() {
  const res = await client.execute({
    sql: `SELECT id FROM "User" WHERE email = 'josh@kiloenergies.com' LIMIT 1`,
  });
  return res.rows[0]?.id ?? null;
}

async function main() {
  const importAdminId = await resolveImportAdminId();
  console.log(`Import admin id: ${importAdminId ?? '(none — Project.notes attribution will be skipped)'}`);
  console.log(COMMIT ? '── MODE: COMMIT (writes will persist)' : '── MODE: DRY-RUN (no writes)');

  // 1. Gather Glide-imported projects.
  const projectsRes = await client.execute({
    sql: `SELECT id, customerName, notes FROM "Project" WHERE importedFromGlide = 1`,
  });
  const projects = projectsRes.rows;
  console.log(`Glide-imported projects: ${projects.length}`);

  let messagesMoved = 0;
  let notesMoved = 0;
  let legacyNotesMoved = 0;
  let projectsTouched = 0;

  for (const p of projects) {
    const projectId = p.id;
    let touchedThisProject = false;

    // ── Move ProjectMessage rows ─────────────────────────────────────
    const msgs = await client.execute({
      sql: `SELECT id, authorId, authorName, text, createdAt FROM "ProjectMessage" WHERE projectId = ?`,
      args: [projectId],
    });
    for (const m of msgs.rows) {
      if (COMMIT) {
        const newId = cuid();
        await client.execute({
          sql: `INSERT INTO "ProjectAdminNote" (id, projectId, authorId, authorName, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [newId, projectId, m.authorId, m.authorName, m.text, m.createdAt],
        });
        // Clean up ProjectCheckItem + ProjectMention rows that reference
        // this message (cascade in Prisma — but raw SQL needs explicit
        // deletes since we're doing them separately).
        await client.execute({
          sql: `DELETE FROM "ProjectCheckItem" WHERE messageId = ?`,
          args: [m.id],
        });
        await client.execute({
          sql: `DELETE FROM "ProjectMention" WHERE messageId = ?`,
          args: [m.id],
        });
        await client.execute({
          sql: `DELETE FROM "ProjectMessage" WHERE id = ?`,
          args: [m.id],
        });
      }
      messagesMoved++;
      touchedThisProject = true;
    }

    // ── Move ProjectNote rows ────────────────────────────────────────
    const notes = await client.execute({
      sql: `SELECT id, authorId, authorName, text, createdAt FROM "ProjectNote" WHERE projectId = ?`,
      args: [projectId],
    });
    for (const n of notes.rows) {
      if (COMMIT) {
        const newId = cuid();
        await client.execute({
          sql: `INSERT INTO "ProjectAdminNote" (id, projectId, authorId, authorName, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [newId, projectId, n.authorId, n.authorName, n.text, n.createdAt],
        });
        await client.execute({
          sql: `DELETE FROM "ProjectNote" WHERE id = ?`,
          args: [n.id],
        });
      }
      notesMoved++;
      touchedThisProject = true;
    }

    // ── Move legacy Project.notes textarea content ──────────────────
    if (typeof p.notes === 'string' && p.notes.trim().length > 0 && importAdminId) {
      if (COMMIT) {
        const newId = cuid();
        await client.execute({
          sql: `INSERT INTO "ProjectAdminNote" (id, projectId, authorId, authorName, text, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          args: [newId, projectId, importAdminId, 'Glide Import', p.notes],
        });
        await client.execute({
          sql: `UPDATE "Project" SET notes = '' WHERE id = ?`,
          args: [projectId],
        });
      }
      legacyNotesMoved++;
      touchedThisProject = true;
    }

    if (touchedThisProject) projectsTouched++;
  }

  console.log('');
  console.log('── Summary ──');
  console.log(`  ProjectMessage  rows moved: ${messagesMoved}`);
  console.log(`  ProjectNote     rows moved: ${notesMoved}`);
  console.log(`  Project.notes   moved:      ${legacyNotesMoved}`);
  console.log(`  Projects touched:           ${projectsTouched} / ${projects.length}`);
  console.log('');
  console.log(COMMIT ? 'Done — writes committed.' : 'Done (dry-run). Re-run with COMMIT=true to apply.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
