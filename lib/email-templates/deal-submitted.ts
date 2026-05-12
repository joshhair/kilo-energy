/**
 * Deal-submitted email templates.
 *
 * Two strictly-typed shapes — rep and admin — so the TypeScript compiler
 * enforces the privacy boundary at every call site:
 *
 *   - `RepDealEmailData` has NO `kiloMargin`, NO `kiloPerW`, NO baseline
 *     rates, NO other-party commission amounts. The recipient sees only
 *     their own slice plus the names (not amounts) of other parties on
 *     the deal. TypeScript will refuse compilation if a caller tries to
 *     pass a kiloMargin field through this template.
 *
 *   - `AdminDealEmailData` carries the full picture: kilo margin, all
 *     rep commission totals, attribution chain. Admin-only.
 *
 * Both use the existing `renderNotificationEmail` shell for brand
 * consistency with the other Phase 3 notification templates.
 */

import { renderNotificationEmail, escapeHtml } from './notification';

/** What a rep sees in their deal_submitted_rep email. The shape itself
 *  is the privacy gate — no kilo / margin / other-party amount fields
 *  exist on this type. */
export interface RepDealEmailData {
  /** The recipient's first name (greeting). */
  recipientFirstName: string;
  /** The role this recipient plays on the deal — drives copy. */
  recipientRole: 'closer' | 'setter' | 'co-closer' | 'co-setter' | 'trainer';
  /** Customer's display name. */
  customerName: string;
  /** Sold date in ISO format (YYYY-MM-DD). */
  soldDate: string;
  /** System size in kW. */
  kWSize: number;
  /** Sale price (PPW × kW × 1000). Reps can see this. */
  salePrice: number;
  /** Recipient's own commission stages. */
  myCommission: {
    m1: number;
    m2: number;
    m3?: number | null;
  };
  /** Names (not amounts) of other parties on the deal. */
  parties: {
    closerName?: string;
    setterName?: string;
    trainerName?: string;
    coCloserNames?: string[];
    coSetterNames?: string[];
  };
  /** Absolute URL to the project detail page. */
  projectUrl: string;
}

/** Admin-tier deal_submitted_admin email data. Includes everything. */
export interface AdminDealEmailData {
  customerName: string;
  closerName: string;
  setterName?: string;
  trainerName?: string;
  installer: string;
  financer?: string;
  soldDate: string;
  kWSize: number;
  netPPW: number;
  salePrice: number;
  /** Full commission breakdown. */
  closerTotal: number;
  setterTotal: number;
  trainerPayout: number;
  // NOTE: Kilo margin is INTENTIONALLY OMITTED from this type and never
  // rendered in any email. Email is an external channel (forwarded, screenshotted,
  // synced to personal devices, archived outside our control). Admin reads
  // margin in-app where the privacy gate enforces access. Do NOT add a
  // kiloMargin field to this interface — by Josh's direct policy 2026-05-11.
  coCloserNames?: string[];
  coSetterNames?: string[];
  isSubDealer?: boolean;
  projectUrl: string;
}

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

function formatRole(role: RepDealEmailData['recipientRole']): string {
  switch (role) {
    case 'closer': return 'closer';
    case 'setter': return 'setter';
    case 'co-closer': return 'co-closer';
    case 'co-setter': return 'co-setter';
    case 'trainer': return 'trainer';
  }
}

/** Render the rep-tier deal-submitted email. PRIVACY: this function
 *  must never reference kilo margin, baseline rates, or other-party
 *  commission amounts. Adding such a reference here would defeat the
 *  type-level guarantee — keep the boundary strict. */
export function renderDealSubmittedRepEmail(data: RepDealEmailData): {
  subject: string;
  html: string;
} {
  const myTotal = data.myCommission.m1 + data.myCommission.m2 + (data.myCommission.m3 ?? 0);
  const partyLines: string[] = [];
  if (data.parties.closerName && data.recipientRole !== 'closer') {
    partyLines.push(`Closer: ${escapeHtml(data.parties.closerName)}`);
  }
  if (data.parties.setterName && data.recipientRole !== 'setter') {
    partyLines.push(`Setter: ${escapeHtml(data.parties.setterName)}`);
  }
  if (data.parties.trainerName && data.recipientRole !== 'trainer') {
    partyLines.push(`Trainer: ${escapeHtml(data.parties.trainerName)}`);
  }
  if (data.parties.coCloserNames && data.parties.coCloserNames.length > 0) {
    partyLines.push(`Co-closers: ${data.parties.coCloserNames.map(escapeHtml).join(', ')}`);
  }
  if (data.parties.coSetterNames && data.parties.coSetterNames.length > 0) {
    partyLines.push(`Co-setters: ${data.parties.coSetterNames.map(escapeHtml).join(', ')}`);
  }

  const partiesBlock = partyLines.length > 0
    ? `<p style="margin:0 0 12px 0;font-size:13px;color:#3f4757;">${partyLines.join('<br/>')}</p>`
    : '';

  const m3Line = data.myCommission.m3 != null && data.myCommission.m3 > 0
    ? `<tr><td style="padding:4px 0;color:#5a6378;">M3</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.myCommission.m3)}</td></tr>`
    : '';

  const subject = `New deal: ${data.customerName} — you're on as ${formatRole(data.recipientRole)}`;
  const html = renderNotificationEmail({
    heading: `You're on a new deal — ${escapeHtml(data.customerName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">Hi ${escapeHtml(data.recipientFirstName)} — a new deal was submitted and you're attributed as <strong>${formatRole(data.recipientRole)}</strong>.</p>
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;">
        <strong>Customer:</strong> ${escapeHtml(data.customerName)}<br/>
        <strong>Sold date:</strong> ${escapeHtml(data.soldDate)}<br/>
        <strong>System size:</strong> ${data.kWSize.toFixed(2)} kW<br/>
        <strong>Sale price:</strong> ${formatMoney(data.salePrice)}
      </p>
      ${partiesBlock}
      <p style="margin:0 0 8px 0;font-weight:600;">Your projected commission:</p>
      <table role="presentation" style="width:100%;max-width:300px;border-collapse:collapse;font-size:14px;margin:0 0 12px 0;">
        <tr><td style="padding:4px 0;color:#5a6378;">M1</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.myCommission.m1)}</td></tr>
        <tr><td style="padding:4px 0;color:#5a6378;">M2</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.myCommission.m2)}</td></tr>
        ${m3Line}
        <tr><td style="padding:8px 0 0 0;border-top:1px solid #e5e7ee;color:#0f1322;font-weight:700;">Total</td><td style="padding:8px 0 0 0;border-top:1px solid #e5e7ee;text-align:right;font-weight:700;">${formatMoney(myTotal)}</td></tr>
      </table>
    `,
    cta: { label: 'Open deal in Kilo', url: data.projectUrl },
    footerNote: 'Sent because you have deal submission notifications turned on. Manage at /dashboard/preferences.',
  });
  return { subject, html };
}

/** Render the admin-tier deal-submitted email. Includes kilo margin
 *  and full commission attribution. Admin audience only. */
export function renderDealSubmittedAdminEmail(data: AdminDealEmailData): {
  subject: string;
  html: string;
} {
  const partyLines: string[] = [
    `<strong>Closer:</strong> ${escapeHtml(data.closerName)}`,
  ];
  if (data.setterName) partyLines.push(`<strong>Setter:</strong> ${escapeHtml(data.setterName)}`);
  if (data.trainerName) partyLines.push(`<strong>Trainer:</strong> ${escapeHtml(data.trainerName)}`);
  if (data.coCloserNames && data.coCloserNames.length > 0) {
    partyLines.push(`<strong>Co-closers:</strong> ${data.coCloserNames.map(escapeHtml).join(', ')}`);
  }
  if (data.coSetterNames && data.coSetterNames.length > 0) {
    partyLines.push(`<strong>Co-setters:</strong> ${data.coSetterNames.map(escapeHtml).join(', ')}`);
  }

  // Kilo margin is NEVER rendered here — it's admin-internal data that
  // shouldn't travel through email. Admin views margin in-app where the
  // privacy gate enforces access. (Policy decision 2026-05-11.)
  const commissionRows = data.isSubDealer
    ? `<tr><td style="padding:4px 0;color:#5a6378;">Sub-dealer payout</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.closerTotal)}</td></tr>`
    : `
        <tr><td style="padding:4px 0;color:#5a6378;">Closer total</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.closerTotal)}</td></tr>
        <tr><td style="padding:4px 0;color:#5a6378;">Setter total</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.setterTotal)}</td></tr>
        ${data.trainerPayout > 0 ? `<tr><td style="padding:4px 0;color:#5a6378;">Trainer override</td><td style="padding:4px 0;text-align:right;font-weight:600;">${formatMoney(data.trainerPayout)}</td></tr>` : ''}
      `;

  const subject = `New deal: ${data.customerName} (${data.kWSize.toFixed(1)} kW)`;
  const html = renderNotificationEmail({
    heading: `New deal submitted — ${escapeHtml(data.customerName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;">${partyLines.join('<br/>')}</p>
      <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;">
        <strong>Installer:</strong> ${escapeHtml(data.installer)}${data.financer ? ` &middot; <strong>Financer:</strong> ${escapeHtml(data.financer)}` : ''}<br/>
        <strong>Sold date:</strong> ${escapeHtml(data.soldDate)}<br/>
        <strong>System size:</strong> ${data.kWSize.toFixed(2)} kW @ $${data.netPPW.toFixed(2)}/W<br/>
        <strong>Sale price:</strong> ${formatMoney(data.salePrice)}
      </p>
      <p style="margin:0 0 8px 0;font-weight:600;">Commission breakdown:</p>
      <table role="presentation" style="width:100%;max-width:340px;border-collapse:collapse;font-size:14px;margin:0 0 12px 0;">
        ${commissionRows}
      </table>
    `,
    cta: { label: 'Open deal in Kilo', url: data.projectUrl },
    footerNote: 'Sent because you have deal submission notifications turned on. Manage at /dashboard/preferences.',
  });
  return { subject, html };
}
