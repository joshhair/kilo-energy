/**
 * Paid-amount correction admin notification.
 *
 * Fires to every active admin when one admin retroactively edits a Paid
 * payroll entry's recorded amount. Loud-by-design: a silent retroactive
 * change to a paid commission is exactly the kind of thing we want
 * surfaced to the whole admin team, so it's never just one set of eyes
 * deciding.
 *
 * Does NOT fire to the rep — many of these will be Glide-import data
 * cleanup where the rep's actual paid amount didn't change, so a "your
 * commission was adjusted" email would be misleading. Rep visibility is
 * a deliberate future decision once import cleanup is done.
 *
 * Privacy: rep name + amount delta + reason all travel through this
 * email. Recipient set is admins only, so the same sensitivity rules
 * that apply elsewhere (kilo margin omitted, etc.) don't apply here.
 */

import { renderNotificationEmail, escapeHtml } from './notification';

export interface PaidCorrectionEmailData {
  /** Full name of the rep whose Paid entry was edited. */
  repName: string;
  /** Project customer name for context, when the entry has one. */
  customerName?: string | null;
  /** "M1" | "M2" | "M3" | "Bonus" — payment stage of the affected entry. */
  paymentStage: string;
  /** Original recorded amount in cents (before correction). */
  fromCents: number;
  /** New recorded amount in cents (after correction). */
  toCents: number;
  /** Required reason text the actor entered. */
  reason: string;
  /** Full name of the admin who made the correction. */
  actorName: string;
  /** Direct URL to the payroll entry in the admin payroll view. */
  entryUrl: string;
  /** ISO timestamp of the correction. */
  correctedAt: string;
}

function fmtDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function renderPaidCorrectionEmail(data: PaidCorrectionEmailData): {
  subject: string;
  html: string;
} {
  const delta = data.toCents - data.fromCents;
  const direction = delta === 0 ? 'unchanged' : delta > 0 ? 'increased' : 'decreased';
  const subject = `[Kilo] ${data.actorName} corrected ${data.repName}'s ${data.paymentStage} pay (${fmtDollars(data.fromCents)} → ${fmtDollars(data.toCents)})`;

  const customerLine = data.customerName
    ? `<strong>Project:</strong> ${escapeHtml(data.customerName)}<br/>`
    : '';

  // Inline hex literals: notification.ts already documents that CSS vars
  // don't survive Gmail/Outlook, so we mirror the existing palette by
  // hand. The deltaColor pair matches accent-emerald-text / accent-red-text.
  const deltaColor = delta > 0 ? '#0a7d5a' : delta < 0 ? '#b83a3a' : '#3f4757';
  const deltaLabel = delta === 0
    ? 'No amount change (metadata only)'
    : `${direction} by ${fmtDollars(Math.abs(delta))}`;

  const html = renderNotificationEmail({
    heading: `Paid entry correction — ${escapeHtml(data.repName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;">
        <strong>Rep:</strong> ${escapeHtml(data.repName)}<br/>
        ${customerLine}
        <strong>Stage:</strong> ${escapeHtml(data.paymentStage)}<br/>
        <strong>Corrected by:</strong> ${escapeHtml(data.actorName)}<br/>
        <strong>When:</strong> ${escapeHtml(data.correctedAt)}
      </p>
      <table role="presentation" style="margin:12px 0;border-collapse:collapse;font-size:13px;">
        <tr>
          <td style="padding:8px 14px;background:#f5f7fb;border-radius:6px 0 0 6px;color:#3f4757;">Original</td>
          <td style="padding:8px 14px;background:#f5f7fb;color:#0f1322;font-weight:600;">${fmtDollars(data.fromCents)}</td>
        </tr>
        <tr>
          <td style="padding:8px 14px;background:#eaf6f1;color:#3f4757;">Corrected to</td>
          <td style="padding:8px 14px;background:#eaf6f1;border-radius:0 6px 6px 0;color:#0f1322;font-weight:600;">${fmtDollars(data.toCents)}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding:8px 14px;color:${deltaColor};font-weight:600;font-size:12px;">${deltaLabel}</td>
        </tr>
      </table>
      <p style="margin:16px 0 8px 0;font-weight:600;font-size:13px;">Reason:</p>
      <blockquote style="margin:0;padding:12px 16px;border-left:3px solid #1de9b6;background:#f5f7fb;color:#0f1322;border-radius:0 6px 6px 0;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(data.reason)}</blockquote>
    `,
    cta: { label: 'Open Payroll', url: data.entryUrl },
    footerNote: 'Sent to all admins because a Paid payroll entry was retroactively edited. The original value is preserved server-side and visible via the audit log.',
  });

  return { subject, html };
}
