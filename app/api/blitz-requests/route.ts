import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createBlitzRequestSchema } from '../../../lib/schemas/business';
import { logChange } from '../../../lib/audit';
import { notify } from '../../../lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '../../../lib/email-templates/notification';
import { logger } from '../../../lib/logger';

// GET /api/blitz-requests — List blitz requests scoped to role.
// Admin: all requests. Everyone else: only their own requests.
export async function GET() {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const where = user.role === 'admin' ? {} : { requestedById: user.id };
  const requests = await prisma.blitzRequest.findMany({
    where,
    include: { requestedBy: true, blitz: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(requests);
}

// POST /api/blitz-requests — Submit a blitz request (create or cancel).
// Caller must have canRequestBlitz. requestedById is forced to the current
// user to prevent spoofing.
export async function POST(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const internal = await prisma.user.findUnique({
    where: { id: user.id },
    select: { canRequestBlitz: true },
  });
  if (!internal?.canRequestBlitz) {
    return NextResponse.json({ error: 'Forbidden — blitz request permission required' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, createBlitzRequestSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.type === 'cancel') {
    const blitz = await prisma.blitz.findUnique({ where: { id: body.blitzId }, select: { ownerId: true, createdById: true, status: true } });
    if (!blitz || (blitz.ownerId !== user.id && blitz.createdById !== user.id)) {
      return NextResponse.json({ error: 'Forbidden — you can only request cancellation of blitzes you own' }, { status: 403 });
    }
    if (blitz.status !== 'upcoming' && blitz.status !== 'active') {
      return NextResponse.json({ error: 'Cannot request cancellation of a blitz that is not upcoming or active' }, { status: 400 });
    }
    const existing = await prisma.blitzRequest.findFirst({
      where: { blitzId: body.blitzId, type: 'cancel', status: 'pending' },
    });
    if (existing) {
      return NextResponse.json({ error: 'A cancellation request for this blitz is already pending' }, { status: 409 });
    }
  }

  const request = await prisma.blitzRequest.create({
    data: {
      requestedById: user.id,
      type: body.type,
      blitzId: body.type === 'cancel' ? body.blitzId : null,
      name: body.type === 'create' ? body.name : (body.name ?? ''),
      location: body.location ?? '',
      startDate: body.type === 'create' ? body.startDate : (body.startDate ?? ''),
      endDate: body.type === 'create' ? body.endDate : (body.endDate ?? ''),
      housing: body.housing ?? '',
      notes: body.notes ?? '',
      expectedHeadcount: body.expectedHeadcount ?? 0,
    },
    include: { requestedBy: true, blitz: true },
  });
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'blitz_request_create',
    entityType: 'BlitzRequest',
    entityId: request.id,
    detail: {
      type: request.type,
      blitzId: request.blitzId,
      name: request.name,
      startDate: request.startDate,
      endDate: request.endDate,
      expectedHeadcount: request.expectedHeadcount,
    },
  });

  // Notify every active admin that a blitz request is awaiting review.
  // Without this, requests sit in the queue until an admin happens to
  // open /dashboard/blitz and notice the "Requests" tab. Fire-and-forget
  // — never block the response on the email fanout.
  void (async () => {
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'admin', active: true },
        select: { id: true },
      });
      if (admins.length === 0) return;
      const requesterName =
        `${request.requestedBy.firstName ?? ''} ${request.requestedBy.lastName ?? ''}`.trim()
        || request.requestedBy.email;
      const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';
      const reviewUrl = `${appUrl}/dashboard/blitz`;
      const isCancel = request.type === 'cancel';
      const verb = isCancel ? 'cancellation' : 'creation';
      const detailLines = [
        request.name ? `<strong>Name:</strong> ${escapeHtml(request.name)}` : null,
        request.location ? `<strong>Location:</strong> ${escapeHtml(request.location)}` : null,
        request.startDate ? `<strong>Dates:</strong> ${escapeHtml(request.startDate)} – ${escapeHtml(request.endDate || request.startDate)}` : null,
        request.expectedHeadcount ? `<strong>Expected headcount:</strong> ${request.expectedHeadcount}` : null,
        request.housing ? `<strong>Housing:</strong> ${escapeHtml(request.housing)}` : null,
      ].filter(Boolean).join('<br/>');
      await Promise.all(
        admins.map((a) =>
          notify({
            type: 'blitz_request_pending',
            userId: a.id,
            subject: `Blitz ${verb} request from ${requesterName}`,
            emailHtml: renderNotificationEmail({
              heading: `New blitz ${verb} request`,
              bodyHtml: `
                <p style="margin:0 0 12px 0;"><strong>${escapeHtml(requesterName)}</strong> submitted a blitz ${verb} request.</p>
                ${detailLines ? `<p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;">${detailLines}</p>` : ''}
                ${request.notes ? `<p style="margin:0 0 12px 0;font-size:13px;color:#3f4757;"><em>${escapeHtml(request.notes)}</em></p>` : ''}
              `,
              cta: { label: 'Review request', url: reviewUrl },
              footerNote: 'Sent because you have blitz request notifications turned on. Manage at /dashboard/preferences.',
            }),
          })
        )
      );
    } catch (err) {
      logger.warn('blitz_request_pending_notify_failed', { requestId: request.id, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return NextResponse.json(request, { status: 201 });
}
