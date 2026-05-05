import { NextResponse } from 'next/server';
import { db } from '@/lib/db-gated';
import { withApiHandler } from '@/lib/with-api-handler';
import { logDataAccess } from '@/lib/audit-log';

// GET /api/projects/[id]/email-deliveries — list delivery records for a
// project. Drives the HandoffStatusCard on the project detail page.
//
// Privacy: gated. Audience matches Files / Survey Links / Installer Notes —
// admin + internal PM + vendor PM whose scopedInstallerId matches the
// project. Reps DENY (the gate's `installerSurfaceProjectWhere` enforces).

export const GET = withApiHandler<{ id: string }>(async (_req, { params }) => {
  const { id } = await params!;
  const rows = await db.emailDelivery.findMany({
    where: { projectId: id },
    orderBy: { sentAt: 'desc' },
  });

  if (rows.length > 0) {
    void logDataAccess({
      route: '/api/projects/[id]/email-deliveries',
      modelName: 'EmailDelivery',
      recordIds: rows.map((r) => r.id),
    });
  }

  // Parse JSON columns to arrays for client convenience.
  const safe = rows.map((r) => {
    let toEmails: string[] = [];
    let ccEmails: string[] = [];
    try { const v = JSON.parse(r.toEmails) as unknown; if (Array.isArray(v)) toEmails = v.filter((x): x is string => typeof x === 'string'); } catch { /* ignore */ }
    try { const v = JSON.parse(r.ccEmails) as unknown; if (Array.isArray(v)) ccEmails = v.filter((x): x is string => typeof x === 'string'); } catch { /* ignore */ }
    return {
      id: r.id,
      projectId: r.projectId,
      installerId: r.installerId,
      providerMessageId: r.providerMessageId,
      toEmails,
      ccEmails,
      subject: r.subject,
      status: r.status,
      errorReason: r.errorReason,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      bouncedAt: r.bouncedAt,
      isTest: r.isTest,
      createdById: r.createdById,
    };
  });

  return NextResponse.json(safe);
});
