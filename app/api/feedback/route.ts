import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { prisma } from '../../../lib/db';
import { requireInternalUser } from '../../../lib/api-auth';
import { parseJsonBody } from '../../../lib/api-validation';
import { createFeedbackSchema } from '../../../lib/schemas/feedback';
import { enforceRateLimit } from '../../../lib/rate-limit';
import { sendEmail } from '../../../lib/email-helpers';
import { renderFeedbackEmail } from '../../../lib/email-templates/feedback';
import { buildBlobKey } from '../../../lib/file-uploads';
import { logger, errorContext } from '../../../lib/logger';

// Fixed recipient — operational queue lands in Josh's Gmail where filters
// route to the `kilo/feedback` label for triage. Not configurable via env
// to prevent accidental redirection of user feedback to the wrong inbox.
const FEEDBACK_RECIPIENT = 'jarvisbyjosh@gmail.com';

// POST /api/feedback — submit user feedback via the in-app widget.
//
// Auth: requireInternalUser (no anonymous feedback — every submission is
// tied to a logged-in user; Clerk session is the gate).
//
// Rate limit: 5 submissions/minute/user. Catches accidental double-submit
// and bounds the damage from a compromised token.
//
// Flow:
//   1. Validate body (message 1-2000 chars; URL/userAgent optional)
//   2. Create Feedback row
//   3. Best-effort email to FEEDBACK_RECIPIENT (Josh's Gmail). Email
//      failure does NOT roll back the DB write — the row IS the queue,
//      email is just the notification channel.
//   4. Return 201 with the new id + createdAt.
//
// Privacy: the message body is user-typed content the user explicitly
// chose to share with admin. We don't append other server-side context
// (project amounts, customer PII, commissions). Only what the user typed
// plus URL/role metadata they're aware travels.
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireInternalUser();
  } catch (r) {
    return r as NextResponse;
  }

  const limited = await enforceRateLimit(`POST /api/feedback:${user.id}`, 5, 60_000);
  if (limited) return limited;

  const parsed = await parseJsonBody(req, createFeedbackSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Pull user profile snapshot so the email can render their name + role.
  // Role snapshot persists with the Feedback row in case the user's role
  // changes later — the historical context is preserved.
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { firstName: true, lastName: true, email: true, role: true },
  });
  const userName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || user.email
    : user.email;
  const userRole = profile?.role ?? user.role ?? 'unknown';

  // Fallback userAgent from the request header if the client didn't send it.
  const headerUserAgent = req.headers.get('user-agent') ?? null;
  const userAgent = body.userAgent ?? headerUserAgent ?? null;

  const created = await prisma.feedback.create({
    data: {
      userId: user.id,
      userRoleSnapshot: userRole,
      message: body.message,
      url: body.url ?? null,
      userAgent,
    },
    select: { id: true, createdAt: true },
  });

  // Screenshot (optional): upload to Vercel Blob and reference by public
  // URL in the email. Two reasons we don't inline as `data:` URI:
  //   1. Gmail (web + mobile) strips `<img src="data:…">` for security,
  //      so the screenshot wouldn't render in the destination inbox.
  //   2. A real URL appears in Resend's auto-derived plaintext, which
  //      means downstream readers (Gmail MCP, oncall scripts) can fetch
  //      the image directly without parsing MIME.
  //
  // Best-effort: upload failure does NOT block the feedback row or the
  // notification email — the email just goes out without the screenshot,
  // logged so admin can investigate.
  //
  // Privacy: Blob URLs use `access: 'public'` with an unguessable random
  // suffix. The screenshot may contain page content (commission numbers,
  // customer names) so the URL itself is the access gate — don't share
  // outside admin. Matches the existing receipt-upload precedent.
  let screenshotUrl: string | null = null;
  if (body.screenshotBase64) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      logger.warn('feedback_screenshot_skipped_no_blob_token', { feedbackId: created.id });
    } else {
      try {
        const buffer = Buffer.from(body.screenshotBase64, 'base64');
        const key = buildBlobKey(`feedback/${created.id}`, 'screenshot.jpg');
        const uploaded = await put(key, buffer, {
          access: 'public',
          contentType: 'image/jpeg',
        });
        screenshotUrl = uploaded.url;
      } catch (err) {
        logger.warn('feedback_screenshot_upload_failed', {
          feedbackId: created.id,
          ...errorContext(err),
        });
      }
    }
  }

  // Best-effort email. If sending fails, the row persists; admin can
  // read pending feedback via DB query. Failure is logged with the
  // feedback id for traceability.
  try {
    const { subject, html } = renderFeedbackEmail({
      userName,
      userEmail: profile?.email ?? user.email,
      userRole,
      url: body.url ?? null,
      message: body.message,
      userAgent,
      createdAt: created.createdAt.toISOString(),
      screenshotUrl,
    });
    const result = await sendEmail({
      to: FEEDBACK_RECIPIENT,
      subject,
      html,
      replyTo: profile?.email ?? user.email,
      // Don't BCC archive for feedback — keeps the operational inbox tidy.
      // The DB row is the canonical record.
      bccArchive: null,
    });
    if (!result.ok) {
      logger.warn('feedback_email_send_failed', {
        feedbackId: created.id,
        code: result.code,
        error: result.error,
      });
    }
  } catch (err) {
    logger.warn('feedback_email_threw', {
      feedbackId: created.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json(
    { id: created.id, createdAt: created.createdAt.toISOString() },
    { status: 201 },
  );
}
