import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { parseJsonBody } from '@/lib/api-validation';
import { createProjectSurveyLinkSchema } from '@/lib/schemas/pricing';
import { logDataAccess } from '@/lib/audit-log';
import { logChange } from '@/lib/audit';

// GET  /api/projects/[id]/survey-links — List survey links for a project.
// POST /api/projects/[id]/survey-links — Add a new survey link.
//
// Privacy: gated. Audience = admin + internal PM + vendor PM whose
// scopedInstallerId matches project.installerId. Reps DENY.

export const GET = withApiHandler<{ id: string }>(async (_req, { params }) => {
  const { id } = await params!;
  const links = await db.projectSurveyLink.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (links.length > 0) {
    void logDataAccess({
      route: '/api/projects/[id]/survey-links',
      modelName: 'ProjectSurveyLink',
      recordIds: links.map((l) => l.id),
    });
  }
  return NextResponse.json(links);
});

export const POST = withApiHandler<{ id: string }>(async (req, { params, user }) => {
  const { id } = await params!;

  // Confirm caller can see the project.
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const parsed = await parseJsonBody(req, createProjectSurveyLinkSchema);
  if (!parsed.ok) return parsed.response;

  const created = await db.projectSurveyLink.create({
    data: {
      projectId: id,
      url: parsed.data.url.trim(),
      label: parsed.data.label.trim(),
      addedById: user.id,
    },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_survey_link_create',
    entityType: 'ProjectSurveyLink',
    entityId: created.id,
    detail: { projectId: id, url: created.url, label: created.label },
  });

  return NextResponse.json(created);
});
