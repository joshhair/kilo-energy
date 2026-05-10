// Audited fields contract — pin the AUDITED_FIELDS.Project list so a
// future refactor can't silently drop a field that needs forensic
// coverage. Each entry corresponds to a field whose change must be
// captured in the audit log diff.
//
// Background: when a closer mis-tags a deal at submit time (e.g. forgets
// to set leadSource='blitz' so the deal misses the blitz report), an
// admin retroactively edits the project. The diff has to land in the
// audit log so blitz-attribution disputes have a paper trail.

import { describe, it, expect } from 'vitest';
import { AUDITED_FIELDS } from '@/lib/audit';

describe('AUDITED_FIELDS.Project', () => {
  it('includes commission-affecting fields', () => {
    const fields = new Set<string>(AUDITED_FIELDS.Project);
    for (const key of [
      'phase',
      'm1AmountCents', 'm2AmountCents', 'm3AmountCents',
      'setterM1AmountCents', 'setterM2AmountCents', 'setterM3AmountCents',
      'closerId', 'setterId', 'subDealerId',
      'netPPW', 'kWSize',
      'installerId', 'financerId',
      'cancellationReason',
    ]) {
      expect(fields, `missing ${key}`).toContain(key);
    }
  });

  it('includes lead-source attribution fields', () => {
    // Added 2026-05-10. Required for the "retroactively claim a blitz"
    // edit flow to land in the audit log.
    const fields = new Set<string>(AUDITED_FIELDS.Project);
    expect(fields).toContain('leadSource');
    expect(fields).toContain('blitzId');
  });

  it('does not silently drop fields (pin the count)', () => {
    // 17 = the contract as of 2026-05-10. Adding a field bumps this
    // intentionally; dropping one without intent fails this test loud.
    expect(AUDITED_FIELDS.Project.length).toBe(17);
  });
});
