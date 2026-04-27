import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import {
  requireInternalUser,
  requireProjectAccess,
  relationshipToProject,
  loadChainTrainees,
} from '../../../../../lib/api-auth';
import { ProjectFieldVisibility } from '../../../../../lib/fieldVisibility';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { createProjectActivitySchema } from '../../../../../lib/schemas/business';

// GET /api/projects/[id]/activity — List all activities for a project.
// Access: admin, PM, or a rep/sub-dealer who is on the deal.
//
// Field-edit entries leak financial values (e.g. "M2 Amount changed from
// 1200 to 1500") into the human-readable detail string. Per the field-
// visibility matrix in lib/fieldVisibility.ts, those values are scrubbed
// from the project payload for setter/trainer/vendor_pm viewers — so
// returning them via the activity feed would bypass the same matrix. We
// drop field_edit entries whose subject field is restricted for the
// caller's relationship to the project.
//
// View-As impersonation: when an admin passes `?viewAs=<userId>`, the
// endpoint resolves the relationship as if that user were the viewer.
// This keeps the View-As feature honest — admins can verify what a real
// rep would see, including the activity-feed redactions. The auth check
// still runs as the admin (so unauthorized callers can't smuggle a
// viewAs param to read projects they couldn't otherwise access).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }
  const url = new URL(req.url);
  const take = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const skip = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const viewAsId = url.searchParams.get('viewAs');

  // Resolve the viewer's relationship so we know which field_edit entries
  // are safe to expose. Admin/PM passthrough; everyone else gets filtered.
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      closerId: true, setterId: true, subDealerId: true, trainerId: true, installerId: true,
      additionalClosers: { select: { userId: true } },
      additionalSetters: { select: { userId: true } },
    },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // If admin is viewing-as another user, swap in that user's identity for
  // relationship resolution. Non-admins can't impersonate (the param is
  // silently ignored — better than leaking that a user exists by 403'ing).
  let effectiveViewer: { id: string; role: string; scopedInstallerId: string | null } = {
    id: user.id, role: user.role, scopedInstallerId: user.scopedInstallerId,
  };
  if (viewAsId && user.role === 'admin') {
    const target = await prisma.user.findUnique({
      where: { id: viewAsId },
      select: { id: true, role: true, scopedInstallerId: true },
    });
    if (target) {
      effectiveViewer = { id: target.id, role: target.role, scopedInstallerId: target.scopedInstallerId };
    }
  }

  const chainTrainees = effectiveViewer.role === 'rep' ? await loadChainTrainees(effectiveViewer.id) : new Set<string>();
  const rel = relationshipToProject(effectiveViewer, {
    closerId: project.closerId,
    setterId: project.setterId,
    subDealerId: project.subDealerId,
    trainerId: project.trainerId,
    installerId: project.installerId,
    additionalClosers: project.additionalClosers,
    additionalSetters: project.additionalSetters,
  }, chainTrainees);

  // Admin/PM passthrough — paginate at the DB layer for efficiency.
  if (rel === 'admin' || rel === 'pm') {
    const [activities, total] = await Promise.all([
      prisma.projectActivity.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.projectActivity.count({ where: { projectId: id } }),
    ]);
    return NextResponse.json({ activities, total });
  }

  // Non-admin viewer: filter field_edit entries that mention a sensitive
  // field this viewer shouldn't see in the project payload. We drop the
  // entry entirely rather than scrub the detail — the meta field also
  // carries raw old/new values which devtools can read. Pagination
  // happens in JS post-filter so total matches what the viewer sees.
  const isHidden = (field: string): boolean => {
    const policy = ProjectFieldVisibility[field];
    if (!policy) return false;
    const action = policy[rel];
    return action != null && action !== 'pass';
  };
  const all = await prisma.projectActivity.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  });
  const visible = all.filter((a) => {
    if (a.type !== 'field_edit') return true;
    if (!a.meta) return true;
    let parsed: { field?: string } | null = null;
    try { parsed = JSON.parse(a.meta); } catch { return true; }
    const field = parsed?.field;
    if (!field) return true;
    return !isHidden(field);
  });
  // Defensive: strip `meta` from non-admin responses. The UI only renders
  // `detail`; meta is an audit-trail JSON blob that could carry raw old/new
  // values if a future activity type is added without filter coverage.
  // Removing it from the wire format eliminates that regression vector.
  const sanitized = visible.map(({ meta: _meta, ...rest }) => rest);
  return NextResponse.json({
    activities: sanitized.slice(skip, skip + take),
    total: sanitized.length,
  });
}

// POST /api/projects/[id]/activity — Create a new activity entry.
// Access: admin, PM, or a rep/sub-dealer who is on the deal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }

  const parsed = await parseJsonBody(req, createProjectActivitySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const activity = await prisma.projectActivity.create({
    data: {
      projectId: id,
      type: body.type,
      detail: body.detail,
      meta: body.meta ?? null,
    },
  });

  return NextResponse.json(activity, { status: 201 });
}
