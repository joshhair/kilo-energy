/**
 * ics.ts — RFC-5545 iCalendar generator for blitz events.
 *
 * Pure function that takes a blitz description and returns a
 * .ics file body suitable for inclusion in an HTTP response with
 * `Content-Type: text/calendar`. Tested via snapshot in
 * tests/unit/ics.test.ts.
 *
 * # Format choices
 *
 * - **All-day events** (DTSTART;VALUE=DATE) for the start and end
 *   dates. Blitzes are multi-day team activities, not specific
 *   hour-bound meetings. iOS Calendar and Google Calendar both
 *   render all-day events natively without time-zone gymnastics.
 * - **TRANSP:OPAQUE** — marks the calendar block as busy.
 * - **STATUS:CONFIRMED / CANCELLED / TENTATIVE** mirrors the blitz
 *   status field so calendar clients can grey out cancelled events.
 * - **ORGANIZER** is set to the blitz creator's email so reply-to
 *   semantics work (calendar clients let attendees email the
 *   organizer back from the event).
 * - **UID** uses the blitz id directly — stable across edits, so
 *   re-importing the .ics updates the existing calendar entry
 *   instead of creating a duplicate. This is the canonical RFC-5545
 *   pattern.
 *
 * # Line folding
 *
 * RFC-5545 mandates lines no longer than 75 octets. Long descriptions
 * are folded at 73 chars with a continuation prefix of `\r\n ` (CRLF
 * + space). The `foldLine` helper handles this.
 *
 * # Line endings
 *
 * The spec requires CRLF (\r\n) line endings, not bare \n. iCal
 * parsers in the wild are forgiving but some strict ones (Outlook)
 * reject \n-only files. We use \r\n throughout.
 */

export interface BlitzIcsInput {
  /** Stable blitz ID. Used as the iCalendar UID — re-import updates
   *  the existing calendar entry rather than creating a duplicate. */
  id: string;
  /** Display name of the blitz (will become SUMMARY in the event). */
  name: string;
  /** Free-text description. Multi-line is supported (folded per RFC). */
  description?: string | null;
  /** YYYY-MM-DD start date (inclusive). */
  startDate: string;
  /** YYYY-MM-DD end date (inclusive — iCal DTEND for all-day events is
   *  exclusive, so we add 1 day internally). */
  endDate: string;
  /** Optional location string — appears in LOCATION field. */
  location?: string | null;
  /** Status: 'upcoming' | 'active' | 'completed' | 'cancelled'.
   *  Maps to RFC-5545 STATUS: confirmed / cancelled / tentative. */
  status?: string;
  /** Optional organizer name + email — used for ORGANIZER + reply-to. */
  organizer?: { name: string; email: string } | null;
  /** ISO timestamp the event was last updated (server-side). Used as
   *  DTSTAMP + LAST-MODIFIED. Defaults to "now" when omitted. */
  updatedAt?: string;
}

/**
 * Fold a long line into RFC-5545 compliant continuation form. Lines
 * longer than 73 characters are split with `\r\n ` (CRLF + space) at
 * the fold point.
 */
function foldLine(line: string): string {
  if (line.length <= 73) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (i === 0) {
      out += line.slice(0, 73);
      i = 73;
    } else {
      out += '\r\n ' + line.slice(i, i + 72);
      i += 72;
    }
  }
  return out;
}

/**
 * Escape special characters in iCalendar TEXT values. Per RFC-5545:
 *   ; , \ → backslash-escaped
 *   newlines → \n literal (two chars)
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function formatDateNoDashes(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, '');
}

/** Add one day to a YYYY-MM-DD string. Used for the exclusive DTEND
 *  on all-day events (an Apr 1 → Apr 3 blitz becomes DTEND Apr 4). */
function addOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Format an ISO timestamp as iCal UTC (YYYYMMDDTHHMMSSZ). */
function formatUtcTimestamp(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${da}T${h}${mi}${s}Z`;
}

function mapStatus(status: string | undefined): string {
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'upcoming') return 'TENTATIVE';
  return 'CONFIRMED'; // 'active', 'completed', or anything else
}

/**
 * Generate the .ics body for a blitz event. Returns a string with
 * CRLF line endings ready to be sent as `text/calendar`.
 */
export function generateBlitzIcs(input: BlitzIcsInput): string {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const dtstamp = formatUtcTimestamp(updatedAt);
  const dtstart = formatDateNoDashes(input.startDate);
  const dtend = formatDateNoDashes(addOneDay(input.endDate));
  const status = mapStatus(input.status);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // PRODID is required by RFC-5545. Use a recognizable Kilo identifier.
    'PRODID:-//Kilo Energy//Blitz Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldLine(`UID:blitz-${input.id}@kiloenergies.com`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    foldLine(`SUMMARY:${escapeText(input.name)}`),
  ];

  if (input.location) {
    lines.push(foldLine(`LOCATION:${escapeText(input.location)}`));
  }
  if (input.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeText(input.description)}`));
  }
  if (input.organizer) {
    const cnEscaped = escapeText(input.organizer.name);
    lines.push(foldLine(`ORGANIZER;CN=${cnEscaped}:mailto:${input.organizer.email}`));
  }

  lines.push(
    `STATUS:${status}`,
    'TRANSP:OPAQUE',
    `LAST-MODIFIED:${dtstamp}`,
    'END:VEVENT',
    'END:VCALENDAR',
  );

  // Per RFC-5545 spec — CRLF line endings, including trailing.
  return lines.join('\r\n') + '\r\n';
}
