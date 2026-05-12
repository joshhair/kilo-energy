#!/usr/bin/env node
// One-time backfill: migrate legacy Project.notes string values into
// ProjectNote rows so they appear on the project detail page.
//
// The notes display was refactored 2026-04-23 to read from a separate
// ProjectNote table. The submit + edit-modal writes continued to land
// on the legacy Project.notes column, so any note typed at submission
// since the refactor has been silently invisible. This script sweeps
// existing projects and creates the missing ProjectNote rows.
//
// Forward fix (POST /api/projects creating ProjectNote at submission)
// shipped in the same commit. This script catches the historical gap.
//
// Usage:
//   node scripts/migrate-notes-to-project-note.mjs --dry-run
//   node scripts/migrate-notes-to-project-note.mjs            # actually runs
//
// Idempotent: if a project already has a ProjectNote with matching text,
// we skip rather than duplicate. The risk of false-positive-skip (user
// typed identical text later) is acceptable for a one-time backfill —
// run once, inspect, done.

import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const prisma = new PrismaClient();

async function main() {
  console.log(`[backfill] starting${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

  // Find every project with a non-empty legacy notes value.
  const projects = await prisma.project.findMany({
    where: {
      notes: { not: '' },
    },
    select: {
      id: true,
      customerName: true,
      notes: true,
      closerId: true,
      createdAt: true,
      closer: { select: { firstName: true, lastName: true, email: true } },
      projectNotes: { select: { id: true, text: true } },
    },
  });

  console.log(`[backfill] scanned ${projects.length} projects with legacy notes`);

  let willCreate = 0;
  let willSkip = 0;
  let errors = 0;

  for (const p of projects) {
    const legacyText = (p.notes ?? '').trim();
    if (legacyText.length === 0) {
      willSkip += 1;
      continue;
    }

    // Skip if a matching ProjectNote already exists.
    const alreadyExists = p.projectNotes.some((n) => n.text.trim() === legacyText);
    if (alreadyExists) {
      willSkip += 1;
      continue;
    }

    const authorId = p.closerId;
    const authorName = p.closer
      ? `${p.closer.firstName ?? ''} ${p.closer.lastName ?? ''}`.trim() || p.closer.email
      : 'Unknown';

    if (DRY_RUN) {
      console.log(`[backfill] WOULD CREATE: project=${p.id} (${p.customerName}) author=${authorName} text="${legacyText.slice(0, 60)}${legacyText.length > 60 ? '…' : ''}"`);
      willCreate += 1;
      continue;
    }

    try {
      await prisma.projectNote.create({
        data: {
          projectId: p.id,
          authorId,
          authorName,
          text: legacyText,
          // Preserve original timing so the note doesn't look like it
          // was just added today.
          createdAt: p.createdAt,
        },
      });
      console.log(`[backfill] created: project=${p.id} (${p.customerName})`);
      willCreate += 1;
    } catch (err) {
      console.error(`[backfill] error on project=${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      errors += 1;
    }
  }

  console.log('');
  console.log('[backfill] summary');
  console.log(`  Will create: ${willCreate}`);
  console.log(`  Skipped:     ${willSkip}`);
  console.log(`  Errors:      ${errors}`);
  console.log(DRY_RUN ? '[backfill] DRY RUN complete — no rows written.' : '[backfill] complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[backfill] fatal:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
