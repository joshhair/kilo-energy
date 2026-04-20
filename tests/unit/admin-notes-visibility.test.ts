import { describe, it, expect } from 'vitest';
import { applyProjectVisibility } from '@/lib/fieldVisibility';

/**
 * adminNotes (Batch 5) must never reach rep/trainer/sub-dealer/none
 * viewers. These are the server-side RBAC tests on the scrubber that
 * back up the UI hides — a rep cannot inspect network responses to
 * find the field.
 */

const dto = {
  customerName: 'ACME',
  phase: 'Installed',
  notes: 'rep-visible context',
  adminNotes: 'SENSITIVE — admin-only reference',
};

describe('adminNotes visibility', () => {
  it('admin sees adminNotes passthrough', () => {
    const scrubbed = applyProjectVisibility(dto, 'admin');
    expect(scrubbed.adminNotes).toBe('SENSITIVE — admin-only reference');
  });

  it('pm sees adminNotes passthrough', () => {
    const scrubbed = applyProjectVisibility(dto, 'pm');
    expect(scrubbed.adminNotes).toBe('SENSITIVE — admin-only reference');
  });

  it.each(['closer', 'setter', 'trainer', 'sub-dealer', 'none'] as const)(
    '%s relationship: adminNotes is stripped (undefined)',
    (rel) => {
      const scrubbed = applyProjectVisibility(dto, rel);
      expect(scrubbed.adminNotes).toBeUndefined();
    },
  );

  it('rep-visible `notes` passes through regardless of relationship', () => {
    // Every relationship should still see the ordinary notes; only
    // adminNotes is gated.
    for (const rel of ['admin', 'pm', 'closer', 'setter', 'trainer', 'sub-dealer', 'none'] as const) {
      const scrubbed = applyProjectVisibility(dto, rel);
      expect(scrubbed.notes).toBe('rep-visible context');
    }
  });
});
