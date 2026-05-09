/**
 * Notification email body — generic template used by every Phase 3 event
 * fired through `notify()`. One layout, three slots: heading, message
 * paragraph, optional CTA button to the relevant project.
 *
 * Brand consistent with installer-handoff.ts: plain inlined HTML, dark-on-
 * light palette that survives every mail client we test against, single
 * load-bearing CTA. Caller composes subject; this is body only.
 *
 * Why one shared template (vs. one per event): the variation between
 * "you were @-mentioned" and "your pay moved to Pending" is paragraph
 * copy, not layout. A shared template means brand changes happen in one
 * place and per-event copy stays where it belongs (the call site).
 */

export interface NotificationEmailInput {
  /** "You were @-mentioned" — appears as h1, capped at ~60 chars. */
  heading: string;
  /** Free-form HTML paragraph. Caller must escape any user-supplied
   *  content (firstName, project customerName, message snippet). */
  bodyHtml: string;
  /** Optional CTA. Omit for events that don't have a destination. */
  cta?: { label: string; url: string };
  /** Footer line — usually "Sent because you have <event> turned on. Manage at /dashboard/preferences." */
  footerNote?: string;
}

export function renderNotificationEmail(input: NotificationEmailInput): string {
  const { heading, bodyHtml, cta, footerNote } = input;
  const ctaBlock = cta
    ? `
      <p style="margin:20px 0 0 0;">
        <a href="${cta.url}" style="display:inline-block;background:#1de9b6;color:#0f1322;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">
          ${cta.label}
        </a>
      </p>
    `
    : '';
  const footerBlock = footerNote
    ? `<p style="margin:20px 0 0 0;font-size:11px;color:#8a92a8;line-height:1.5;">${footerNote}</p>`
    : '';

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f1322;background:#ffffff;margin:0;padding:0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="display:inline-flex;align-items:baseline;gap:4px;margin-bottom:24px;">
      <span style="font-weight:900;letter-spacing:-0.04em;font-size:18px;color:#0f1322;">kilo</span>
      <span style="font-weight:300;letter-spacing:0.25em;text-transform:uppercase;font-size:9px;color:#0f1322;">ENERGY</span>
    </div>
    <h1 style="margin:0 0 12px 0;font-size:18px;font-weight:600;color:#0f1322;">${heading}</h1>
    <div style="font-size:14px;line-height:1.55;color:#0f1322;">${bodyHtml}</div>
    ${ctaBlock}
    <hr style="border:none;border-top:1px solid #e5e7ee;margin:28px 0 16px 0;" />
    ${footerBlock}
  </div>
</body></html>`;
}

/** Best-effort HTML escape for short user-supplied strings (names, snippets).
 *  Not meant for arbitrary HTML — just defangs the four characters that
 *  break inline rendering inside attribute values + text content. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
