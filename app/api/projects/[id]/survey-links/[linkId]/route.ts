import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { parseJsonBody } from '@/lib/api-validation';
import { patchProjectSurveyLinkSchema } from '@/lib/schemas/pricing';
import { logChange } from '@/lib/audit';

// PATCH  /api/projects/[id]/survey-links/[linkId] — Edit a survey link.
// DELETE /api/projects/[id]/survey-links/[linkId] — Remove a survey link.
//
// Privacy: gated. Audience matches the parent route — admin/PM/vendor-PM-of-installer.
// projectId is asserted explicitly to harden against URL tampering.

export const PATCH = withApiHandler<{ id: string; linkId: string }>(async (req, { params, user }) => {
  const { id, linkId } = await params!;

  const existing = await db.projectSurveyLink.findUnique({ where: { id: linkId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.projectId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const parsed = await parseJsonBody(req, patchProjectSurveyLinkSchema);
  if (!parsed.ok) return parsed.response;

  const data: Record<string, unknown> = {};
  if (parsed.data.url !== undefined) data.url = parsed.data.url.trim();
  if (parsed.data.label !== undefined) data.label = parsed.data.label.trim();

  const updated = await db.projectSurveyLink.update({
    where: { id: linkId },
    data,
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_survey_link_update',
    entityType: 'ProjectSurveyLink',
    entityId: linkId,
    detail: {
      projectId: id,
      before: { url: existing.url, label: existing.label },
      after: { url: updated.url, label: updated.label },
    },
  });

  return NextResponse.json(updated);
});

export const DELETE = withApiHandler<{ id: string; linkId: string }>(async (_req, { params, user }) => {
  const { id, linkId } = await params!;

  const existing = await db.projectSurveyLink.findUnique({ where: { id: linkId } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.projectId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.projectSurveyLink.delete({ where: { id: linkId } });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_survey_link_delete',
    entityType: 'ProjectSurveyLink',
    entityId: linkId,
    detail: { projectId: id, url: existing.url, label: existing.label },
  });

  return NextResponse.json({ success: true });
});
