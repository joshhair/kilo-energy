import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { dbAdmin } from '@/lib/db';
import { logger, errorContext } from '@/lib/logger';

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

/**
 * Verify Resend's webhook signature. Returns true iff the signature
 * matches a freshly-computed HMAC-SHA256 of the raw body using the
 * shared secret. Constant-time comparison.
 */
function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  // Resend sends `svix-signature: v1,<base64>` (Svix format) — strip prefix
  const sigPart = signature.split(',').pop()?.trim() ?? signature;

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(sigPart, 'base64');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('resend_webhook_secret_missing');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  // Read raw body BEFORE parsing JSON — signature is computed over raw bytes
  const rawBody = await req.text();
  // Resend supports several header names depending on integration variant;
  // try the common ones.
  const signatureHeader =
    req.headers.get('svix-signature') ??
    req.headers.get('webhook-signature') ??
    req.headers.get('resend-signature') ??
    null;

  if (!verifySignature(rawBody, signatureHeader, secret)) {
    logger.error('resend_webhook_signature_mismatch', {
      hasHeader: !!signatureHeader,
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

  try {
    const updated = await dbAdmin.emailDelivery.updateMany({
      where: { providerMessageId: messageId },
      data: updates,
    });
    logger.info('resend_webhook_status_updated', {
      messageId,
      eventType: event.type,
      rowsUpdated: updated.count,
    });
    return NextResponse.json({ ok: true, rowsUpdated: updated.count });
  } catch (err) {
    logger.error('resend_webhook_update_failed', { messageId, ...errorContext(err) });
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
