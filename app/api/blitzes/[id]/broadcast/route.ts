import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../../lib/db';
import { requireInternalUser } from '../../../../../lib/api-auth';
import { parseJsonBody } from '../../../../../lib/api-validation';
import { logChange } from '../../../../../lib/audit';
import { logger, errorContext } from '../../../../../lib/logger';
import { notify } from '../../../../../lib/notifications/service';

// POST /api/blitzes/[id]/broadcast — Phase 3c one-click "remind everyone".
//
// Owner or admin sends a free-text message; the server fans out to every
// approved participant via the standard notification service so user-level
// preferences and channel routing apply. Each recipient sees only their
// own address (per-recipient notify call, not a single email blast).
//
// Safety:
//   - Owner-or-admin only
//   - Message capped at 2,000 chars (a Slack-DM-sized blurb, not an essay)
//   - Rate-limit: 1 broadcast per blitz per 30 minutes. Hard cap to prevent
//     accidental "spam everyone" loops. Tracked via the AuditLog row from
//     the previous broadcast.

const MIN_INTERVAL_MS = 30 * 60 * 1000;

const broadcastSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(2000, 'Message too long'),
});

function renderBroadcastHtml(opts: {
  blitzName: string;
  ownerName: string;
  message: string;
  startDate: string;
  endDate: string;
  appUrl: string;
  blitzId: string;
}): string {
  // Defense in depth — server-side escape so an HTML-y message from the
  // owner can't render as live markup in the recipient's inbox.
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const paragraphs = esc(opts.message)
    .split(/\r?\n\r?\n/)
    .map((p) => `<p style="margin:0 0 10px 0;font-size:14px;line-height:1.5;color:#0f1322;white-space:pre-wrap;">${p.replace(/\r?\n/g, '<br/>')}</p>`)
    .join('');
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1322;background:#ffffff;margin:0;padding:0;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;color:#0aa57b;text-transform:uppercase;letter-spacing:0.6px;">Blitz broadcast</p>
    <h1 style="margin:0 0 4px 0;font-size:20px;font-weight:600;color:#0f1322;">${esc(opts.blitzName)}</h1>
    <p style="margin:0 0 14px 0;font-size:12px;color:#5b6477;">From ${esc(opts.ownerName)} · ${esc(opts.startDate)} – ${esc(opts.endDate)}</p>
    <div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;border:1px solid #e5e7ee;">
      ${paragraphs}
    </div>
    <p style="margin:18px 0 0 0;">
      <a href="${opts.appUrl}/dashboard/blitz/${opts.blitzId}" style="display:inline-block;background:#0aa57b;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 16px;border-radius:8px;">Open blitz</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7ee;margin:24px 0;" />
    <p style="margin:0;font-size:11px;color:#8a92a8;line-height:1.5;">
      Sent by Kilo Energy. Manage these notifications at /dashboard/settings → Notifications.
    </p>
  </div>
</body></html>`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const blitz = await prisma.blitz.findUnique({
    where: { id },
    include: {
      owner: true,
      participants: { where: { joinStatus: 'approved' }, include: { user: true } },
    },
  });
  if (!blitz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = blitz.ownerId === user.id;
  const isAdmin = user.role === 'admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Only the blitz leader or an admin can broadcast' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, broadcastSchema);
  if (!parsed.ok) return parsed.response;
  const { message } = parsed.data;

  // Rate-limit via the most recent ANNOUNCEMENT row (regardless of actor,
  // so two owners can't ping-pong). Keyed off BlitzAnnouncement rather than
  // the old AuditLog lookup: the announcement is created BEFORE the email
  // fan-out, which also narrows the old double-submit window where nothing
  // existed to rate-limit against until the post-send audit write (Codex).
  const lastBroadcast = await prisma.blitzAnnouncement.findFirst({
    where: { blitzId: id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (lastBroadcast) {
    const elapsed = Date.now() - lastBroadcast.createdAt.getTime();
    if (elapsed < MIN_INTERVAL_MS) {
      const waitMin = Math.ceil((MIN_INTERVAL_MS - elapsed) / 60000);
      return NextResponse.json(
        { error: `Broadcast rate-limited. Try again in ${waitMin} min.` },
        { status: 429 },
      );
    }
  }

  const appUrl = process.env.APP_URL || 'https://app.kiloenergies.com';
  // Snapshot the ACTUAL actor — an admin can broadcast on an owner's blitz,
  // and the email + persisted announcement should both say who really sent
  // it (Codex design round, 2026-06-12).
  const senderName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
  const senderFirst = user.firstName || senderName;
  const subject = `Kilo Blitz — ${blitz.name}: message from ${senderFirst}`;
  const html = renderBroadcastHtml({
    blitzName: blitz.name,
    ownerName: senderName,
    message,
    startDate: blitz.startDate,
    endDate: blitz.endDate,
    appUrl,
    blitzId: id,
  });

  // The announcement is the durable object; email is just the delivery
  // channel. Create it BEFORE the fan-out so a partial email failure can
  // never lose the message again (Josh's vanished broadcasts, 2026-06-12).
  const eligibleRecipients = blitz.participants.filter((p) => p.user?.email && p.user.id !== user.id);
  const announcement = await prisma.blitzAnnouncement.create({
    data: {
      blitzId: id,
      senderId: user.id,
      senderName,
      senderRole: user.role,
      message,
      emailSubject: subject,
      recipientTotal: eligibleRecipients.length,
    },
  });

  let okCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const p of blitz.participants) {
    if (!p.user?.email) { skippedCount += 1; continue; }
    // Skip echoing the broadcast back to the sender — they typed it.
    if (p.user.id === user.id) continue;
    try {
      const res = await notify({
        type: 'blitz_broadcast',
        userId: p.user.id,
        subject,
        emailHtml: html,
      });
      if (res.ok && !res.skipped) okCount += 1;
      else if (res.ok && res.skipped) skippedCount += 1;
      else failedCount += 1;
    } catch (err) {
      failedCount += 1;
      logger.error('blitz_broadcast_notify_threw', { ...errorContext(err), blitzId: id, userId: p.user.id });
    }
  }

  await prisma.blitzAnnouncement.update({
    where: { id: announcement.id },
    data: { recipientsOk: okCount, recipientsFailed: failedCount, recipientsSkipped: skippedCount },
  });

  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'blitz_broadcast',
    entityType: 'Blitz',
    entityId: id,
    detail: {
      recipientsTotal: blitz.participants.length,
      recipientsOk: okCount,
      recipientsFailed: failedCount,
      messagePreview: message.slice(0, 120),
    },
  });

  logger.info('blitz_broadcast_sent', { blitzId: id, actorId: user.id, okCount, failedCount });
  return NextResponse.json({ ok: true, recipientsOk: okCount, recipientsFailed: failedCount });
}
