/**
 * Email helpers — Resend SDK wrapper.
 *
 * Single sendEmail() entry point used by every outbound email path
 * (installer handoff, daily stalled digest, future flows). Wraps the
 * Resend SDK with our envelope rules:
 *   - From hardcoded to noreply@kiloenergies.com
 *   - BCC archive auto-injected when configured
 *   - Errors normalized to a discriminated union — never throws on send
 *
 * Auth: process.env.RESEND_API_KEY (set in Vercel + .env)
 *
 * Sends are fire-and-forget from the caller's perspective. The caller
 * decides what to do with delivery status — the EmailDelivery row is
 * the canonical record once the Resend webhook arrives at
 * /api/webhooks/resend.
 *
 * This module is in the eslint allowlist so it can use server-side
 * resources directly. Keep it focused: SDK plumbing, no business logic.
 */

import { Resend } from 'resend';
import { logger, errorContext } from './logger';

/**
 * Default sender. Domain must be verified in Resend with SPF/DKIM/DMARC
 * records configured at kiloenergies.com's DNS.
 */
const DEFAULT_FROM = 'Kilo Energy <noreply@kiloenergies.com>';

/**
 * Always-on archive recipient. Every send is BCC'd here so we have a
 * mailbox of record independent of EmailDelivery row. Override per-call
 * if needed (e.g. internal test sends might not want this).
 */
const DEFAULT_BCC_ARCHIVE = process.env.EMAIL_ARCHIVE_BCC || '';

let client: Resend | null = null;

/**
 * Lazy-init the Resend client so module load doesn't crash when the
 * env var is missing (e.g. test envs, ephemeral preview deploys).
 * Returns null when not configured — sendEmail handles that path.
 */
function getClient(): Resend | null {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  client = new Resend(apiKey);
  return client;
}

export interface SendEmailParams {
  /** One or more To recipients. */
  to: string | string[];
  /** Optional CC list. */
  cc?: string | string[];
  /** Optional Reply-To list. Pass [rep_email, partners@kiloenergies.com] for handoff. */
  replyTo?: string | string[];
  /** Email subject (no prefix injected — caller provides full subject). */
  subject: string;
  /** HTML body. Plain text is auto-derived by Resend. */
  html: string;
  /** Optional attachments. Buffer content recommended for binary files. */
  attachments?: SendEmailAttachment[];
  /** Override the default From address. Rarely needed. */
  from?: string;
  /** Override / disable the default BCC archive. Pass null to skip. */
  bccArchive?: string | string[] | null;
  /** Custom headers (e.g. X-Entity-Ref-Id for tracing). */
  headers?: Record<string, string>;
}

export interface SendEmailAttachment {
  filename: string;
  /** Buffer for binary, string for plain text. */
  content: Buffer | string;
  /** Optional MIME type override (defaults inferred from filename). */
  contentType?: string;
}

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; code: 'NOT_CONFIGURED' | 'API_ERROR' | 'UNKNOWN' };

/**
 * Send an email via Resend. Never throws — returns a discriminated result
 * the caller can inspect to decide whether to retry, log, or surface.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const resend = getClient();
  if (!resend) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      error: 'RESEND_API_KEY is not set — email sending is disabled in this environment',
    };
  }

  const bcc =
    params.bccArchive === null
      ? undefined
      : params.bccArchive ?? (DEFAULT_BCC_ARCHIVE ? DEFAULT_BCC_ARCHIVE : undefined);

  try {
    const result = await resend.emails.send({
      from: params.from ?? DEFAULT_FROM,
      to: params.to,
      cc: params.cc,
      bcc,
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
      headers: params.headers,
    });

    if (result.error) {
      logger.error('email_send_error', {
        subject: params.subject,
        recipientCount: Array.isArray(params.to) ? params.to.length : 1,
        provider: 'resend',
        error: result.error.message ?? String(result.error),
      });
      return {
        ok: false,
        code: 'API_ERROR',
        error: result.error.message ?? 'Resend returned an unstructured error',
      };
    }

    if (!result.data?.id) {
      // Shouldn't happen per Resend's contract, but defensively handle.
      logger.error('email_send_missing_id', {
        subject: params.subject,
        provider: 'resend',
      });
      return {
        ok: false,
        code: 'UNKNOWN',
        error: 'Resend response had no message id',
      };
    }

    logger.info('email_sent', {
      providerMessageId: result.data.id,
      subject: params.subject,
      recipientCount: Array.isArray(params.to) ? params.to.length : 1,
    });
    return { ok: true, providerMessageId: result.data.id };
  } catch (err) {
    logger.error('email_send_threw', {
      subject: params.subject,
      ...errorContext(err),
    });
    return {
      ok: false,
      code: 'UNKNOWN',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Build a Reply-To array from a per-deal rep email + the standing
 * partners alias. Filters out empty strings (a rep without a Kilo email
 * shouldn't break the send).
 */
export function buildHandoffReplyTo(repEmail: string | null | undefined): string[] {
  const partners = process.env.PARTNERS_REPLY_TO || 'partners@kiloenergies.com';
  return [repEmail?.trim(), partners].filter((x): x is string => !!x && x.length > 0);
}
