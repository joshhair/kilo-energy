/**
 * Installer handoff email body template.
 *
 * Plain HTML — no React, no @react-email. Email clients reliably render
 * inline-styled HTML; the engineering cost of a proper template engine
 * isn't justified for one email type. If we ever grow to ~10 distinct
 * email flows we'll revisit.
 *
 * Subject lines are composed at the call site (per-installer prefix +
 * customer-keyed metadata). This module is just the body.
 *
 * Style philosophy: legible, scannable, plain. BVI ops will route many of
 * these per day; brevity > visual polish. The CRM link is the load-bearing
 * call-to-action.
 */

export interface HandoffEmailBodyInput {
  /** Display name of the installer ("BVI Solar"). Drives the greeting. */
  installerDisplayName: string;
  /** Customer's full name as captured on the project. */
  customerName: string;
  /** Customer street address (from intake). May be empty. */
  customerAddress: string;
  /** System size in kW (e.g. "8.4"). */
  systemSizeKw: string;
  /** Finance product name. */
  financeProduct: string;
  /** Net metering classification ("NEM 3.0" / "Non-Export"). May be empty. */
  exportType: string;
  /** Whether a site survey was requested ("Yes" / "No" / "" if not specified). */
  siteSurveyText: string;
  /** Sales rep display name. */
  repName: string;
  /** Sales rep phone (display only — Reply-To handles email). */
  repPhone: string;
  /** Sales rep email — Reply-To target. */
  repEmail: string;
  /** Optional installer-configured custom note appended verbatim. */
  customNotes: string;
  /** Absolute URL to the project page in our CRM. */
  projectUrl: string;
  /**
   * Optional Vercel Blob public URL of the homeowner utility bill.
   * Rendered as a "Utility bill:" link below the project summary so
   * BVI ops can fetch it even when the email's binary attachment was
   * dropped (size cap, client filtering). Belt + suspenders alongside
   * the actual attachment.
   */
  utilityBillUrl?: string | null;
  /** Original filename for the bill link label. Falls back to a generic label. */
  utilityBillFilename?: string | null;
}

/**
 * HTML-escape a string for safe interpolation. Escapes <, >, &, ", '.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the BVI handoff email body as inline-styled HTML. Output is
 * suitable for direct use as the `html` field of a Resend send.
 */
export function renderHandoffEmailHtml(input: HandoffEmailBodyInput): string {
  const summaryRows: Array<[string, string]> = [
    ['Customer', input.customerName],
    ['Address', input.customerAddress || '—'],
    ['System size', `${input.systemSizeKw} kW`],
    ['Finance', input.financeProduct],
    ['Export type', input.exportType || '—'],
    ['Site survey requested', input.siteSurveyText || '—'],
  ];

  const rowsHtml = summaryRows
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:4px 12px 4px 0;color:#5b6477;font-size:13px;">${esc(k)}</td>
          <td style="padding:4px 0;color:#0f1322;font-size:13px;font-weight:500;">${esc(v)}</td>
        </tr>`,
    )
    .join('');

  // Utility bill link block. Always include when a URL is present —
  // mirrors the attachment so BVI ops has a fallback download path
  // regardless of whether their client renders the attachment. URL
  // is HTML-escaped though we control its shape (Vercel Blob output).
  const utilityBillBlock = input.utilityBillUrl
    ? `
      <p style="margin:16px 0 0 0;font-size:13px;color:#0f1322;">
        <strong>Utility bill:</strong>
        <a href="${esc(input.utilityBillUrl)}" style="color:#00a85a;text-decoration:underline;">
          ${esc(input.utilityBillFilename || 'Download (PDF/image)')}
        </a>
      </p>
    `
    : '';

  const customNotesBlock = input.customNotes.trim()
    ? `
      <p style="margin:18px 0 8px 0;font-size:13px;color:#5b6477;">From ${esc(input.installerDisplayName)}:</p>
      <p style="margin:0;padding:12px;background:#f5f6fa;border-radius:6px;font-size:13px;color:#0f1322;line-height:1.5;white-space:pre-wrap;">${esc(input.customNotes)}</p>
    `
    : '';

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1322;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;">
      Hi ${esc(input.installerDisplayName)} Operations team,
    </p>

    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;">
      A new project has been submitted by <strong>${esc(input.repName)}</strong> for installation.
      The completed Sales Intake Form and the homeowner's utility bill are attached.
    </p>

    <h2 style="margin:24px 0 8px 0;font-size:14px;font-weight:600;color:#0f1322;text-transform:uppercase;letter-spacing:0.5px;">
      Project summary
    </h2>
    <table style="border-collapse:collapse;width:100%;">
      ${rowsHtml}
    </table>

    ${utilityBillBlock}

    ${customNotesBlock}

    <p style="margin:24px 0 8px 0;font-size:14px;line-height:1.5;">
      Full project details, contracts, and live status are in our CRM under your PM access:
    </p>
    <p style="margin:0 0 24px 0;">
      <a href="${esc(input.projectUrl)}"
         style="display:inline-block;padding:10px 18px;background:#00a85a;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">
        Open project in Kilo
      </a>
    </p>

    <p style="margin:24px 0 4px 0;font-size:13px;color:#5b6477;">
      Reply to this email to reach <strong>${esc(input.repName)}</strong> (${esc(input.repPhone || 'no phone on file')})
      and our partner support team.
    </p>

    <hr style="border:none;border-top:1px solid #e5e7ee;margin:24px 0;" />
    <p style="margin:0;font-size:12px;color:#8a92a8;line-height:1.5;">
      Sent from <strong>Kilo Energy</strong> &middot; noreply@kiloenergies.com<br/>
      This message and any attachments contain confidential homeowner information.
      If you received this in error, please delete it and notify the sender.
    </p>
  </div>
</body>
</html>`;
}

