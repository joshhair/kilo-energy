import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/db';
import { logger, errorContext } from '@/lib/logger';
import { verifySvixSignature } from '@/lib/svix-verify';

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
  return NextResponse.json({
    ok: true,
    rowsUpdated: emailRowsUpdated + notificationRowsUpdated,
  });
}
