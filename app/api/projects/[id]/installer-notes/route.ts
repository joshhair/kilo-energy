import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { parseJsonBody } from '@/lib/api-validation';
import { createProjectInstallerNoteSchema } from '@/lib/schemas/pricing';
import { logDataAccess } from '@/lib/audit-log';
import { logChange } from '@/lib/audit';

// GET  /api/projects/[id]/installer-notes — List notes for a project.
// POST /api/projects/[id]/installer-notes — Add a new note.
//
// Privacy: gated. Audience = admin + internal PM + vendor PM whose
// scopedInstallerId matches project.installerId. Reps DENY.

export const GET = withApiHandler<{ id: string }>(async (_req, { params }) => {
  const { id } = await params!;
  const notes = await db.projectInstallerNote.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (notes.length > 0) {
    void logDataAccess({
      route: '/api/projects/[id]/installer-notes',
      modelName: 'ProjectInstallerNote',
      recordIds: notes.map((n) => n.id),
    });
  }
  return NextResponse.json(notes);
});

export const POST = withApiHandler<{ id: string }>(async (req, { params, user }) => {
  const { id } = await params!;

  // Confirm caller can see the project.
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const parsed = await parseJsonBody(req, createProjectInstallerNoteSchema);
  if (!parsed.ok) return parsed.response;

  const created = await db.projectInstallerNote.create({
    data: {
      projectId: id,
      body: parsed.data.body.trim(),
      authorId: user.id,
    },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_installer_note_create',
    entityType: 'ProjectInstallerNote',
    entityId: created.id,
    detail: { projectId: id, bodyLength: created.body.length },
  });

  return NextResponse.json(created);
});
