/**
 * Feedback email template — sent to admin (Josh) when a user submits via
 * the in-app feedback widget.
 *
 * Privacy: the message body is user-typed content. The user already
 * consented to sharing this with admin by clicking submit. We do NOT
 * auto-append other server-side state (project amounts, customer PII,
 * commission numbers, etc.) — only what the user typed plus URL/role
 * metadata they're aware travels.
 *
 * Recipient is fixed at jarvisbyjosh@gmail.com via FEEDBACK_RECIPIENT
 * config at the call site.
 */

import { renderNotificationEmail, escapeHtml } from './notification';

export interface FeedbackEmailData {
  /** Submitter's first + last name (for greeting in subject + body). */
  userName: string;
  /** Submitter's email (used as Reply-To so admin can ping back directly). */
  userEmail: string;
  /** Submitter's role at submission time. */
  userRole: string;
  /** Page URL where the user clicked the widget. Relative path; no domain. */
  url?: string | null;
  /** Free-form user-typed text. Already trimmed + length-validated upstream. */
  message: string;
  /** Optional browser/OS identifier from the request. Debug context only. */
  userAgent?: string | null;
  /** ISO timestamp of submission. */
  createdAt: string;
}

export function renderFeedbackEmail(data: FeedbackEmailData): {
  subject: string;
  html: string;
} {
  const truncatedPreview =
    data.message.length > 60 ? `${data.message.slice(0, 60)}…` : data.message;
  const subject = `[Kilo Feedback] from ${data.userName}: ${truncatedPreview}`;

  const urlBlock = data.url
    ? `<p style="margin:0 0 12px 0;font-size:13px;color:#3f4757;"><strong>Page:</strong> <code style="background:#f5f7fb;padding:2px 6px;border-radius:4px;font-family:Menlo,Monaco,monospace;font-size:12px;">${escapeHtml(data.url)}</code></p>`
    : '';

  const agentBlock = data.userAgent
    ? `<p style="margin:12px 0 0 0;font-size:11px;color:#8a92a8;">User agent: ${escapeHtml(data.userAgent)}</p>`
    : '';

  const html = renderNotificationEmail({
    heading: `New feedback from ${escapeHtml(data.userName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;">
        <strong>From:</strong> ${escapeHtml(data.userName)} (${escapeHtml(data.userRole)})<br/>
        <strong>Email:</strong> <a href="mailto:${escapeHtml(data.userEmail)}" style="color:#1de9b6;text-decoration:none;">${escapeHtml(data.userEmail)}</a><br/>
        <strong>Submitted:</strong> ${escapeHtml(data.createdAt)}
      </p>
      ${urlBlock}
      <p style="margin:16px 0 8px 0;font-weight:600;">Message:</p>
      <blockquote style="margin:0;padding:12px 16px;border-left:3px solid #1de9b6;background:#f5f7fb;color:#0f1322;border-radius:0 6px 6px 0;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(data.message)}</blockquote>
      ${agentBlock}
    `,
    footerNote: 'Sent via the Kilo in-app feedback widget. Reply to this email to respond directly to the user.',
  });

  return { subject, html };
}
