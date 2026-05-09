import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/db';
import { logger, errorContext } from '@/lib/logger';
import { verifySvixSignature } from '@/lib/svix-verify';
import { notify } from '@/lib/notifications/service';
import { renderNotificationEmail, escapeHtml } from '@/lib/email-templates/notification';

// POST /api/webhooks/resend — Resend delivery-status webhook receiver.
//
// Resend posts events as JSON with these types we care about:
//   - email.sent        (we already record on send; ignore)
//   - email.delivered   → status='delivered', deliveredAt=now
//   - email.bounced     → status='bounced', bouncedAt=now, errorReason
//   - email.complained  → status='complained', errorReason
//   - email.failed      → status='failed', errorReason
//
// HMAC verification: Resend signs the request with a shared secret
// (RESEND_WEBHOOK_SECRET). We verify the signature BEFORE parsing the
// body — never trust a webhook payload until proven. Uses constant-time
// comparison to prevent timing-based forgery.
//
// No request context: this is a public endpoint by HMAC. Uses dbAdmin
// (allowed for app/api/webhooks/** via eslint config update — see below).

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    bounce?: {
      message?: string;
      bounceType?: string;
    };
    complaint?: {
      complaintFeedbackType?: string;
    };
  };
}

// Svix signature verification lives in lib/svix-verify.ts (tested unit).

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('resend_webhook_secret_missing');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  // Read raw body BEFORE parsing JSON — signature is computed over raw bytes
  const rawBody = await req.text();
  // Resend's Svix integration sends headers under both `webhook-*` and
  // `svix-*` namespaces depending on configuration / version. Try both.
  const webhookId = req.headers.get('webhook-id') ?? req.headers.get('svix-id');
  const webhookTimestamp = req.headers.get('webhook-timestamp') ?? req.headers.get('svix-timestamp');
  const webhookSignature = req.headers.get('webhook-signature') ?? req.headers.get('svix-signature');

  const verify = verifySvixSignature(rawBody, webhookId, webhookTimestamp, webhookSignature, secret);
  if (!verify.ok) {
    logger.error('resend_webhook_signature_invalid', {
      reason: verify.reason,
      hasId: !!webhookId,
      hasTimestamp: !!webhookTimestamp,
      hasSignature: !!webhookSignature,
      bodyLength: rawBody.length,
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch (err) {
    logger.error('resend_webhook_invalid_json', errorContext(err));
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messageId = event.data?.email_id;
  if (!messageId) {
    // Nothing actionable — ack so Resend doesn't retry.
    return NextResponse.json({ ok: true, skipped: 'no_message_id' });
  }

  // Map event type → status mutation
  let updates: {
    status?: string;
    deliveredAt?: Date | null;
    bouncedAt?: Date | null;
    errorReason?: string | null;
  } = {};

  switch (event.type) {
    case 'email.delivered':
      updates = { status: 'delivered', deliveredAt: new Date() };
      break;
    case 'email.bounced':
      updates = {
        status: 'bounced',
        bouncedAt: new Date(),
        errorReason: event.data?.bounce?.message || event.data?.bounce?.bounceType || 'Bounced',
      };
      break;
    case 'email.complained':
      updates = {
        status: 'complained',
        errorReason: event.data?.complaint?.complaintFeedbackType || 'Complaint received',
      };
      break;
    case 'email.failed':
      updates = { status: 'failed', errorReason: 'Provider reported failure' };
      break;
    default:
      // Ignore email.sent (we record this on initial send) + unknown types
      return NextResponse.json({ ok: true, ignored: event.type });
  }

  // Dual-write: update BOTH the legacy EmailDelivery row (handoff /
  // stalled-digest UX still reads from it) AND any NotificationDelivery
  // row sharing the same providerMessageId (the unified log Phase 3+
  // events write into). Keys are unique per table; missing-row updates
  // are no-ops.
  //
  // allSettled (not all): if NotificationDelivery is missing, malformed,
  // or the migration is mid-flight, we MUST NOT take the EmailDelivery
  // bounce-tracking path down with it. EmailDelivery is the live UX
  // surface for the BVI handoff bounce alerts; NotificationDelivery is
  // the new unified log. Each side fails independently.
  const [emailResult, notificationResult] = await Promise.allSettled([
    dbAdmin.emailDelivery.updateMany({
      where: { providerMessageId: messageId },
      data: updates,
    }),
    dbAdmin.notificationDelivery.updateMany({
      where: { providerMessageId: messageId },
      data: updates,
    }),
  ]);

  const emailRowsUpdated = emailResult.status === 'fulfilled' ? emailResult.value.count : 0;
  const notificationRowsUpdated = notificationResult.status === 'fulfilled' ? notificationResult.value.count : 0;

  if (emailResult.status === 'rejected') {
    logger.error('resend_webhook_email_update_failed', {
      messageId,
      ...errorContext(emailResult.reason),
    });
  }
  if (notificationResult.status === 'rejected') {
    // Soft-fail: don't 500 just because the new table isn't ready yet.
    // Resend would otherwise retry the webhook indefinitely.
    logger.error('resend_webhook_notification_update_failed', {
      messageId,
      ...errorContext(notificationResult.reason),
    });
  }

  // 500 only if BOTH legs failed — partial failures still ack so Resend
  // doesn't retry forever and pile up duplicates.
  if (emailResult.status === 'rejected' && notificationResult.status === 'rejected') {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  logger.info('resend_webhook_status_updated', {
    messageId,
    eventType: event.type,
    emailRowsUpdated,
    notificationRowsUpdated,
    emailOk: emailResult.status === 'fulfilled',
    notificationOk: notificationResult.status === 'fulfilled',
  });

  // Handoff bounce alert — fire ONLY on bounced/complained/failed for an
  // EmailDelivery row that's tied to a project (i.e. an installer handoff
  // or test send). Skip delivered. Notify admin + internal PM audience
  // (event registry already restricts handoff_bounced to those roles).
  if (
    emailRowsUpdated > 0 &&
    (event.type === 'email.bounced' || event.type === 'email.complained' || event.type === 'email.failed')
  ) {
    try {
      const delivery = await dbAdmin.emailDelivery.findFirst({
        where: { providerMessageId: messageId },
        select: {
          id: true,
          subject: true,
          toEmails: true,
          errorReason: true,
          isTest: true,
          project: { select: { id: true, customerName: true } },
          installer: { select: { name: true } },
        },
      });
      // Skip test sends — those are admin self-tests, not real ops failures.
      if (delivery && !delivery.isTest && delivery.project) {
        const admins = await dbAdmin.user.findMany({
          where: {
            active: true,
            OR: [
              { role: 'admin' },
              { role: 'project_manager', scopedInstallerId: null },
            ],
          },
          select: { id: true },
        });
        const projectUrl = `${process.env.APP_URL || 'https://app.kiloenergies.com'}/dashboard/projects/${delivery.project.id}`;
        const installerName = delivery.installer?.name ?? 'an installer';
        const reason = delivery.errorReason ?? 'Bounced';
        const headlineVerb =
          event.type === 'email.complained' ? 'flagged as spam' :
          event.type === 'email.failed'     ? 'failed to send' :
          'bounced';
        const heading = `Handoff ${headlineVerb} — ${delivery.project.customerName}`;

        await Promise.all(
          admins.map((a) =>
            notify({
              type: 'handoff_bounced',
              userId: a.id,
              projectId: delivery.project!.id,
              subject: heading,
              emailHtml: renderNotificationEmail({
                heading,
                bodyHtml: `
                  <p style="margin:0 0 12px 0;">The handoff email to <strong>${escapeHtml(installerName)}</strong> for <strong>${escapeHtml(delivery.project!.customerName)}</strong> ${headlineVerb}.</p>
                  <p style="margin:0 0 12px 0;color:#5b6477;font-size:13px;">Reason: ${escapeHtml(reason)}</p>
                  <p style="margin:0;color:#5b6477;font-size:12px;">Recipients: ${escapeHtml(delivery.toEmails)}</p>
                `,
                cta: { label: 'Open deal in Kilo', url: projectUrl },
                footerNote: 'Sent because you have handoff-bounce alerts on. Manage at /dashboard/preferences.',
              }),
              smsBody: `Kilo: handoff ${headlineVerb} for ${delivery.project!.customerName}.`,
              pushBody: `Handoff ${headlineVerb}: ${delivery.project!.customerName}`,
            }),
          ),
        );
      }
    } catch (err) {
      // Don't take down the webhook over a notification failure.
      logger.error('handoff_bounce_notification_failed', {
        messageId,
        ...errorContext(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    rowsUpdated: emailRowsUpdated + notificationRowsUpdated,
  });
}
