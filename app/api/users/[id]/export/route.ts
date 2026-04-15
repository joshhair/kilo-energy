import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser } from '../../../../../lib/api-auth';
import { logChange } from '../../../../../lib/audit';

/**
 * GET /api/users/[id]/export — GDPR/CCPA-style data export.
 *
 * Returns a JSON document with every record in the system that relates to
 * the target user: profile, deals (as closer/setter/sub-dealer), payroll,
 * reimbursements, messages authored, mentions received, trainer
 * assignments, and audit-log entries where they were the actor.
 *
 * Access:
 *   - Admin: can export any user (operational use — honor a GDPR request
 *     on behalf of an ex-rep who's lost system access).
 *   - Self: a user can export their own records (self-service).
 *   - Everyone else: 403.
 *
 * Side effect: records the export in AuditLog so we have a trail of who
 * pulled what and when (regulator-friendly).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const isSelf = viewer.id === id;
  const isAdmin = viewer.role === 'admin';
  if (!isSelf && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden — can only export your own data' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [
    projectsAsCloser,
    projectsAsSetter,
    projectsAsSubDealer,
    payrollEntries,
    reimbursements,
    messages,
    mentions,
    trainerAsTrainer,
    trainerAsTrainee,
    auditActions,
  ] = await Promise.all([
    prisma.project.findMany({ where: { closerId: id }, include: { installer: true, financer: true } }),
    prisma.project.findMany({ where: { setterId: id }, include: { installer: true, financer: true } }),
    prisma.project.findMany({ where: { subDealerId: id }, include: { installer: true, financer: true } }),
    prisma.payrollEntry.findMany({ where: { repId: id }, orderBy: { date: 'desc' } }),
    prisma.reimbursement.findMany({ where: { repId: id }, orderBy: { date: 'desc' } }),
    prisma.projectMessage.findMany({ where: { authorId: id }, include: { checkItems: true } }),
    prisma.projectMention.findMany({ where: { userId: id }, include: { message: true } }),
    prisma.trainerAssignment.findMany({ where: { trainerId: id }, include: { tiers: true, trainee: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.trainerAssignment.findMany({ where: { traineeId: id }, include: { tiers: true, trainer: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.auditLog.findMany({ where: { actorUserId: id }, orderBy: { createdAt: 'desc' } }),
  ]);

  const bundle = {
    generatedAt: new Date().toISOString(),
    exportedBy: { id: viewer.id, email: viewer.email ?? null },
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      repType: user.repType,
      active: user.active,
      createdAt: user.createdAt,
    },
    projects: {
      asCloser: projectsAsCloser,
      asSetter: projectsAsSetter,
      asSubDealer: projectsAsSubDealer,
    },
    payrollEntries,
    reimbursements,
    messages,
    mentions,
    trainer: {
      asTrainer: trainerAsTrainer,
      asTrainee: trainerAsTrainee,
    },
    auditLog: {
      actionsTaken: auditActions,
    },
  };

  await logChange({
    actor: { id: viewer.id, email: viewer.email ?? null },
    action: 'user_data_export',
    entityType: 'User',
    entityId: id,
    detail: { exportedBySelf: isSelf },
  });

  return NextResponse.json(bundle, {
    status: 200,
    headers: {
      // Hint the browser to download rather than render.
      'Content-Disposition': `attachment; filename="kilo-data-export-${id}-${new Date().toISOString().split('T')[0]}.json"`,
    },
  });
}
