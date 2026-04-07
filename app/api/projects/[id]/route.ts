import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin, requireInternalUser, userCanAccessProject } from '../../../../lib/api-auth';

// Financial fields that project managers must NOT be able to modify
const PM_BLOCKED_FIELDS = ['m1Paid', 'm1Amount', 'm2Paid', 'm2Amount', 'm3Amount', 'm3Paid', 'setterM2Amount', 'setterM3Amount', 'netPPW', 'baselineOverrideJson'];

// Fields reps/sub-dealers are NEVER allowed to modify on their own deals —
// they can change notes, flag, and customer-facing info but not money,
// phase (admin/PM only), or ownership.
const REP_BLOCKED_FIELDS = [
  'm1Paid', 'm1Amount', 'm2Paid', 'm2Amount', 'm3Amount', 'm3Paid',
  'setterM2Amount', 'setterM3Amount', 'netPPW', 'baselineOverrideJson',
  'phase', 'closerId', 'setterId', 'subDealerId',
];

// PATCH /api/projects/[id] — Update a project (phase change, notes, flag, etc.)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

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
    const existing = await prisma.project.findUnique({ where: { id }, select: { closerId: true, setterId: true, blitzId: true } });
    const effectiveBlitzId = body.blitzId ?? existing?.blitzId;
    if (effectiveBlitzId) {
      // Validate soldDate falls within the blitz window when it is being set
      if (body.soldDate !== undefined) {
        const blitz = await prisma.blitz.findUnique({
          where: { id: effectiveBlitzId },
          select: { startDate: true, endDate: true },
        });
        if (blitz) {
          const sold = new Date(body.soldDate);
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

  // Build update data, only including fields that were sent
  const data: Record<string, unknown> = {};
  if (body.phase !== undefined) data.phase = body.phase;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.flagged !== undefined) data.flagged = body.flagged;
  if (body.m1Paid !== undefined) data.m1Paid = body.m1Paid;
  if (body.m1Amount !== undefined) data.m1Amount = body.m1Amount;
  if (body.m2Paid !== undefined) data.m2Paid = body.m2Paid;
  if (body.m2Amount !== undefined) data.m2Amount = body.m2Amount;
  if (body.m3Amount !== undefined) data.m3Amount = body.m3Amount;
  if (body.m3Paid !== undefined) data.m3Paid = body.m3Paid;
  if (body.setterM2Amount !== undefined) data.setterM2Amount = body.setterM2Amount;
  if (body.setterM3Amount !== undefined) data.setterM3Amount = body.setterM3Amount;
  if (body.cancellationReason !== undefined) data.cancellationReason = body.cancellationReason;
  if (body.cancellationNotes !== undefined) data.cancellationNotes = body.cancellationNotes;
  if (body.baselineOverrideJson !== undefined) data.baselineOverrideJson = body.baselineOverrideJson;
  if (body.leadSource !== undefined) data.leadSource = body.leadSource;
  if (body.blitzId !== undefined) data.blitzId = body.blitzId;
  if (body.productType !== undefined) data.productType = body.productType;
  if (body.kWSize !== undefined) data.kWSize = body.kWSize;
  if (body.netPPW !== undefined) data.netPPW = body.netPPW;
  if (body.setterId !== undefined) data.setterId = body.setterId || null;
  if (body.soldDate !== undefined) data.soldDate = body.soldDate;
  // FK resolution: installer/financer name → ID
  if (body.installer !== undefined) {
    const inst = await prisma.installer.findFirst({ where: { name: body.installer } });
    if (inst) data.installerId = inst.id;
  }
  if (body.financer !== undefined) {
    const fin = await prisma.financer.findFirst({ where: { name: body.financer } });
    if (fin) data.financerId = fin.id;
  }

  const project = await prisma.project.update({
    where: { id },
    data,
    include: { closer: true, setter: true, installer: true, financer: true },
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
