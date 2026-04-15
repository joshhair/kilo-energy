import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser, userCanAccessProject } from '../../../../lib/api-auth';
import { logChange, AUDITED_FIELDS } from '../../../../lib/audit';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchProjectSchema, type PatchProjectInput } from '../../../../lib/schemas/project';
import { enforceRateLimit } from '../../../../lib/rate-limit';

// Financial fields project managers must NOT be able to modify
const PM_BLOCKED_FIELDS: Array<keyof PatchProjectInput> = [
  'm1Paid', 'm1Amount', 'm2Paid', 'm2Amount', 'm3Amount', 'm3Paid',
  'setterM1Amount', 'setterM2Amount', 'setterM3Amount', 'netPPW', 'baselineOverrideJson',
];

// Fields reps/sub-dealers are NEVER allowed to modify on their own deals —
// they can change notes, flag, and customer-facing info but not money,
// phase (admin/PM only), or ownership.
const REP_BLOCKED_FIELDS: Array<keyof PatchProjectInput> = [
  ...PM_BLOCKED_FIELDS,
  'phase', 'closerId', 'setterId',
];

// PATCH /api/projects/[id] — Update a project (phase change, notes, flag, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  // Higher ceiling on project patches — admins routinely click through many
  // phase changes in a short window. 120/min covers that; legit Kanban
  // drag-drops won't hit it.
  const limited = enforceRateLimit(`PATCH /api/projects/[id]:${user.id}`, 120, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, patchProjectSchema);
  if (!parsed.ok) return parsed.response;
  const body: PatchProjectInput = { ...parsed.data };

  // ─── Project ownership check ───
  // Reps + sub-dealers can only modify deals they're on.
  const canAccess = await userCanAccessProject(user, id);
  if (!canAccess) {
    return NextResponse.json({ error: 'Forbidden — no access to this project' }, { status: 403 });
  }

  // ─── Field-level authorization ───
  if (user.role === 'project_manager') {
    for (const field of PM_BLOCKED_FIELDS) delete body[field];
  } else if (user.role === 'rep' || user.role === 'sub-dealer') {
    for (const field of REP_BLOCKED_FIELDS) delete body[field];
  }

  // Validate blitz participation and window before writing (mirrors POST /api/projects validation)
  // Also runs when only setterId/closerId/soldDate changes — the project may already have a blitzId.
  if (body.blitzId || body.setterId !== undefined || body.closerId !== undefined || body.soldDate !== undefined) {
    const existing = await prisma.project.findUnique({ where: { id }, select: { closerId: true, setterId: true, blitzId: true, soldDate: true } });
    const effectiveBlitzId = body.blitzId !== undefined ? body.blitzId : existing?.blitzId;
    if (effectiveBlitzId) {
      const blitz = await prisma.blitz.findUnique({
        where: { id: effectiveBlitzId },
        select: { startDate: true, endDate: true, status: true },
      });
      if (blitz) {
        if (blitz.status === 'cancelled') {
          return NextResponse.json({ error: 'Cannot link a project to a cancelled blitz' }, { status: 400 });
        }
        const effectiveSoldDate = body.soldDate ?? existing?.soldDate;
        if (effectiveSoldDate) {
          const sold = new Date(effectiveSoldDate);
          if (sold < new Date(blitz.startDate) || sold > new Date(blitz.endDate)) {
            return NextResponse.json({ error: 'soldDate is outside the blitz window' }, { status: 400 });
          }
        }
      }
      const closerId = body.closerId ?? existing?.closerId;
      if (closerId) {
        const participation = await prisma.blitzParticipant.findFirst({
          where: { blitzId: effectiveBlitzId, userId: closerId, joinStatus: 'approved' },
        });
        if (!participation) {
          return NextResponse.json({ error: 'Closer is not an approved participant of this blitz' }, { status: 403 });
        }
      }
      const setterId = body.setterId ?? existing?.setterId;
      if (setterId) {
        const setterParticipation = await prisma.blitzParticipant.findFirst({
          where: { blitzId: effectiveBlitzId, userId: setterId, joinStatus: 'approved' },
        });
        if (!setterParticipation) {
          return NextResponse.json({ error: 'Setter is not an approved participant of this blitz' }, { status: 403 });
        }
      }
    }
  }

  // Build update data, only including fields that were sent.
  // Zod has already validated types + bounds at the boundary.
  const data: Record<string, unknown> = {};
  const passthrough: Array<keyof PatchProjectInput> = [
    'phase', 'notes', 'flagged',
    'm1Paid', 'm1Amount', 'm2Paid', 'm2Amount', 'm3Amount', 'm3Paid',
    'setterM1Amount', 'setterM2Amount', 'setterM3Amount',
    'cancellationReason', 'cancellationNotes', 'baselineOverrideJson',
    'leadSource', 'blitzId', 'productType', 'kWSize', 'netPPW', 'soldDate',
  ];
  for (const key of passthrough) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  // Nullable FK fields: empty string → null
  if (body.closerId !== undefined) data.closerId = body.closerId || null;
  if (body.setterId !== undefined) data.setterId = body.setterId || null;

  // FK resolution: installer/financer name → ID
  if (body.installer !== undefined) {
    const inst = await prisma.installer.findFirst({ where: { name: body.installer } });
    if (!inst) return NextResponse.json({ error: `Installer "${body.installer}" not found` }, { status: 400 });
    if (!inst.active) return NextResponse.json({ error: 'Installer is archived' }, { status: 400 });
    data.installerId = inst.id;
  }
  if (body.financer !== undefined) {
    const fin = await prisma.financer.findFirst({ where: { name: body.financer } });
    if (!fin) return NextResponse.json({ error: `Financer "${body.financer}" not found` }, { status: 400 });
    if (!fin.active) return NextResponse.json({ error: 'Financer is archived' }, { status: 400 });
    data.financerId = fin.id;
  }

  // Snapshot before-state for audit diff (only fields we care about).
  const auditSelect: Record<string, true> = {};
  for (const f of AUDITED_FIELDS.Project) auditSelect[f] = true;
  const before = await prisma.project.findUnique({
    where: { id },
    select: auditSelect,
  });

  const project = await prisma.project.update({
    where: { id },
    data,
    include: { closer: true, setter: true, installer: true, financer: true },
  });

  // Audit: record diff of audited fields (no-op if nothing changed in them).
  const phaseChanged = before && (before as Record<string, unknown>).phase !== project.phase;
  await logChange({
    actor: { id: user.id, email: user.email ?? null },
    action: phaseChanged ? 'phase_change' : 'project_update',
    entityType: 'Project',
    entityId: id,
    before: before as Record<string, unknown> | undefined,
    after: project as unknown as Record<string, unknown>,
    fields: AUDITED_FIELDS.Project,
  });

  return NextResponse.json(project);
}

// DELETE /api/projects/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  // Delete related records first (activity, messages, payroll entries)
  await prisma.projectActivity.deleteMany({ where: { projectId: id } });
  await prisma.projectCheckItem.deleteMany({ where: { message: { projectId: id } } });
  await prisma.projectMention.deleteMany({ where: { message: { projectId: id } } });
  await prisma.projectMessage.deleteMany({ where: { projectId: id } });
  await prisma.payrollEntry.deleteMany({ where: { projectId: id } });
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
