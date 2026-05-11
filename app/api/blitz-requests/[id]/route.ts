import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { parseJsonBody } from '../../../../lib/api-validation';
import { patchBlitzRequestSchema } from '../../../../lib/schemas/business';
import { logChange } from '../../../../lib/audit';
import { notify } from '../../../../lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '../../../../lib/email-templates/notification';
import { logger } from '../../../../lib/logger';

// PATCH /api/blitz-requests/[id] — Approve/deny a request (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const parsed = await parseJsonBody(req, patchBlitzRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Capture prior status so we only fire a "decision" notification when
  // the request actually transitioned (admin-notes-only edits + idempotent
  // re-saves of the same status shouldn't re-spam the requester).
  const priorRecord = await prisma.blitzRequest.findUnique({
    where: { id },
    select: { status: true },
  });
  const priorStatus = priorRecord?.status ?? null;

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes;

  let request;
  try {
    request = await prisma.$transaction(async (tx) => {
      const updated = await tx.blitzRequest.update({
        where: { id },
        data,
        include: { requestedBy: true, blitz: true },
      });

      // If approving a cancellation request, also cancel the blitz and unlink projects
      if (body.status === 'approved' && updated.type === 'cancel' && updated.blitzId) {
        const currentBlitz = await tx.blitz.findUnique({ where: { id: updated.blitzId }, select: { status: true } });
        if (!currentBlitz || !['upcoming', 'active'].includes(currentBlitz.status)) {
          throw new Error(`Cannot cancel blitz in '${currentBlitz?.status ?? 'unknown'}' status`);
        }
        await tx.blitz.update({
          where: { id: updated.blitzId },
          data: { status: 'cancelled' },
        });
        await tx.project.updateMany({
          where: { blitzId: updated.blitzId },
          data: { blitzId: null },
        });
      }

      // If approving a create request, create the blitz (idempotency: skip if already linked)
      if (body.status === 'approved' && updated.type === 'create' && !updated.blitzId) {
        const newBlitz = await tx.blitz.create({
          data: {
            name: updated.name,
            location: updated.location,
            startDate: updated.startDate,
            endDate: updated.endDate,
            housing: updated.housing,
            notes: updated.notes,
            createdById: updated.requestedById,
            ownerId: updated.requestedById,
            participants: {
              create: { userId: updated.requestedById, joinStatus: 'approved' },
            },
          },
        });
        const updatedWithBlitz = await tx.blitzRequest.update({
          where: { id },
          data: { blitzId: newBlitz.id },
          include: { requestedBy: true, blitz: true },
        });
        return updatedWithBlitz;
      }

      return updated;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed';
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  // Backfill existing deals for newly-approved create requests (mirrors POST /api/blitzes lines 150–189)
  if (body.status === 'approved' && request.type === 'create' && request.blitz) {
    const newBlitz = request.blitz;
    const ownerId = request.requestedById;
    const approvedParticipants = await prisma.blitzParticipant.findMany({
      where: { blitzId: newBlitz.id, joinStatus: 'approved' },
      select: { userId: true },
    });
    const approvedIds = approvedParticipants.map((p) => p.userId);
    await prisma.project.updateMany({
      where: {
        blitzId: null,
        soldDate: { gte: newBlitz.startDate, lte: newBlitz.endDate },
        closerId: ownerId,
        OR: [{ setterId: null }, { setterId: { in: approvedIds } }],
      },
      data: { blitzId: newBlitz.id },
    });
    await prisma.project.updateMany({
      where: {
        blitzId: null,
        soldDate: { gte: newBlitz.startDate, lte: newBlitz.endDate },
        setterId: ownerId,
        closerId: { in: approvedIds },
      },
      data: { blitzId: newBlitz.id },
    });
    const coRoleProjects = await prisma.project.findMany({
      where: {
        blitzId: null,
        soldDate: { gte: newBlitz.startDate, lte: newBlitz.endDate },
        OR: [
          { additionalClosers: { some: { userId: ownerId } }, setterId: { in: approvedIds } },
          { additionalSetters: { some: { userId: ownerId } }, closerId: { in: approvedIds } },
        ],
      },
      select: { id: true },
    });
    for (const project of coRoleProjects) {
      await prisma.project.update({ where: { id: project.id }, data: { blitzId: newBlitz.id } });
    }
  }

  await logChange({
    actor: { id: actor.id, email: actor.email },
    action: 'blitz_request_update',
    entityType: 'BlitzRequest',
    entityId: id,
    detail: {
      newStatus: request.status,
      type: request.type,
      blitzId: request.blitzId,
      adminNotes: request.adminNotes,
    },
  });

  // Notify the requester when the admin actually transitioned the
  // request to approved or denied. Skip idempotent re-saves,
  // admin-notes-only edits, and self-decisions (admin acting on their
  // own request — emailing themselves is noise).
  if (
    body.status !== undefined &&
    body.status !== priorStatus &&
    (body.status === 'approved' || body.status === 'denied') &&
    request.requestedById !== actor.id
  ) {
    const decidedRequest = request;
    void (async () => {
      try {
        const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';
        const blitzUrl = decidedRequest.type === 'create' && decidedRequest.blitzId
          ? `${appUrl}/dashboard/blitz/${decidedRequest.blitzId}`
          : `${appUrl}/dashboard/blitz`;
        const isApproved = body.status === 'approved';
        const isCancel = decidedRequest.type === 'cancel';
        const verb = isCancel ? 'cancellation' : 'creation';
        const decision = isApproved ? 'approved' : 'denied';
        const heading = isApproved
          ? `Your blitz ${verb} request was approved`
          : `Your blitz ${verb} request was denied`;
        const cta = isApproved && !isCancel
          ? { label: 'Open blitz', url: blitzUrl }
          : { label: 'View requests', url: `${appUrl}/dashboard/blitz` };
        const adminNotesBlock = decidedRequest.adminNotes
          ? `<p style="margin:0 0 12px 0;"><strong>Admin notes:</strong></p>
             <blockquote style="margin:0 0 12px 0;padding:12px 16px;border-left:3px solid #1de9b6;background:#f5f7fb;color:#0f1322;border-radius:0 6px 6px 0;font-size:14px;">
               ${escapeHtml(decidedRequest.adminNotes)}
             </blockquote>`
          : '';
        await notify({
          type: 'blitz_request_decided',
          userId: decidedRequest.requestedById,
          subject: `Blitz ${verb} request ${decision}: ${decidedRequest.name || '(unnamed)'}`,
          emailHtml: renderNotificationEmail({
            heading,
            bodyHtml: `
              <p style="margin:0 0 12px 0;">Your request for the blitz <strong>${escapeHtml(decidedRequest.name || '(unnamed)')}</strong> was ${decision} by an admin.</p>
              ${adminNotesBlock}
            `,
            cta,
            footerNote: 'Sent because you have blitz request notifications turned on. Manage at /dashboard/preferences.',
          }),
        });
      } catch (err) {
        logger.warn('blitz_request_decided_notify_failed', { requestId: id, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }

  return NextResponse.json(request);
}
