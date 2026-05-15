/**
 * ics.test.ts — RFC-5545 generator coverage.
 */

import { describe, it, expect } from 'vitest';
import { generateBlitzIcs } from '@/lib/ics';

describe('generateBlitzIcs', () => {
  const baseInput = {
    id: 'blitz_abc123',
    name: 'Phoenix Blitz',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    location: 'Phoenix, AZ',
    description: 'Team blitz at the Phoenix office.',
    status: 'upcoming',
    organizer: { name: 'Josh Hair', email: 'josh@kiloenergies.com' },
    updatedAt: '2026-05-14T18:00:00.000Z',
  };

  it('produces a valid RFC-5545 envelope', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Kilo Energy//Blitz Calendar//EN');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('uses CRLF line endings (not bare \\n)', () => {
    const ics = generateBlitzIcs(baseInput);
    // Strict parsers (Outlook) reject \n-only files. Verify CRLFs are present.
    expect(ics).toMatch(/\r\n/);
    // Bare \n with no preceding \r would be a bug
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('UID is stable + uses the blitz id', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('UID:blitz-blitz_abc123@kiloenergies.com');
    // Re-running with same input → same UID → calendar update not duplicate
    const ics2 = generateBlitzIcs(baseInput);
    const uid1 = ics.match(/UID:[^\r\n]+/)?.[0];
    const uid2 = ics2.match(/UID:[^\r\n]+/)?.[0];
    expect(uid1).toBe(uid2);
  });

  it('all-day event: DTEND is exclusive (+1 day from endDate)', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260601');
    // endDate is 2026-06-05, so DTEND is 2026-06-06 (exclusive)
    expect(ics).toContain('DTEND;VALUE=DATE:20260606');
  });

  it('single-day blitz: DTEND is start+1', () => {
    const ics = generateBlitzIcs({ ...baseInput, startDate: '2026-06-01', endDate: '2026-06-01' });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260601');
    expect(ics).toContain('DTEND;VALUE=DATE:20260602');
  });

  it('month-boundary endDate rolls to next month', () => {
    const ics = generateBlitzIcs({ ...baseInput, startDate: '2026-06-30', endDate: '2026-06-30' });
    expect(ics).toContain('DTEND;VALUE=DATE:20260701');
  });

  it('year-boundary endDate rolls to next year', () => {
    const ics = generateBlitzIcs({ ...baseInput, startDate: '2026-12-31', endDate: '2026-12-31' });
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('SUMMARY contains the blitz name', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('SUMMARY:Phoenix Blitz');
  });

  it('LOCATION + DESCRIPTION are included when present', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('LOCATION:Phoenix\\, AZ');
    expect(ics).toContain('DESCRIPTION:Team blitz at the Phoenix office.');
  });

  it('omits LOCATION / DESCRIPTION when null', () => {
    const ics = generateBlitzIcs({ ...baseInput, location: null, description: null });
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('ORGANIZER includes mailto + CN', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('ORGANIZER;CN=Josh Hair:mailto:josh@kiloenergies.com');
  });

  it('escapes special characters in text fields', () => {
    const ics = generateBlitzIcs({
      ...baseInput,
      name: 'Blitz; needs, escaping \\',
      description: 'Line 1\nLine 2',
    });
    expect(ics).toContain('SUMMARY:Blitz\\; needs\\, escaping \\\\');
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
  });

  it('status mapping — cancelled → CANCELLED', () => {
    const ics = generateBlitzIcs({ ...baseInput, status: 'cancelled' });
    expect(ics).toContain('STATUS:CANCELLED');
  });

  it('status mapping — upcoming → TENTATIVE', () => {
    const ics = generateBlitzIcs({ ...baseInput, status: 'upcoming' });
    expect(ics).toContain('STATUS:TENTATIVE');
  });

  it('status mapping — active → CONFIRMED', () => {
    const ics = generateBlitzIcs({ ...baseInput, status: 'active' });
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('status mapping — completed → CONFIRMED', () => {
    const ics = generateBlitzIcs({ ...baseInput, status: 'completed' });
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('TRANSP:OPAQUE marks event as busy', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('TRANSP:OPAQUE');
  });

  it('DTSTAMP uses provided updatedAt in UTC YYYYMMDDTHHMMSSZ format', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toContain('DTSTAMP:20260514T180000Z');
    expect(ics).toContain('LAST-MODIFIED:20260514T180000Z');
  });

  it('long SUMMARY is folded with CRLF + space', () => {
    const longName = 'A'.repeat(200);
    const ics = generateBlitzIcs({ ...baseInput, name: longName });
    // The folded line should have continuation markers
    expect(ics).toMatch(/SUMMARY:A+\r\n /);
  });

  it('ends with trailing CRLF', () => {
    const ics = generateBlitzIcs(baseInput);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
  });
});
