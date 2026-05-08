// Regression tests for createProjectSchema.
//
// Bug 2026-05-08: rep Rebekah C got "Failed to save new deal — Validation
// failed • installerintakeJson: Invalid input: expected string, received null"
// when submitting a non-BVI deal. Root cause: client coerced absent values to
// null (lib/context.tsx:1373 `|| null`) but schema is z.string().optional()
// which rejects null. Fix: client sends undefined (omits the field); schema
// stays strict so a future null arrival surfaces as a real failure.
// Don't let this regress.

import { describe, it, expect } from 'vitest';
import { createProjectSchema } from '@/lib/schemas/project';

const baseValidProject = {
  customerName: 'Test Customer',
  closerId: 'user_123',
  installerId: 'inst_123',
  financerId: 'fin_123',
  productType: 'Loan',
  kWSize: 8.5,
  netPPW: 3.20,
  soldDate: '2026-05-01',
};

describe('createProjectSchema — installerIntakeJson tolerance', () => {
  it('accepts string (BVI deal with intake)', () => {
    const result = createProjectSchema.safeParse({
      ...baseValidProject,
      installerIntakeJson: JSON.stringify({ exportType: 'NEM3' }),
    });
    expect(result.success).toBe(true);
  });

  it('accepts undefined (non-BVI deal, field omitted)', () => {
    const result = createProjectSchema.safeParse({
      ...baseValidProject,
      installerIntakeJson: undefined,
    });
    expect(result.success).toBe(true);
  });

  it('rejects null (the symptom we just fixed — surfacing a future regression)', () => {
    const result = createProjectSchema.safeParse({
      ...baseValidProject,
      installerIntakeJson: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts the field being absent entirely', () => {
    const result = createProjectSchema.safeParse(baseValidProject);
    expect(result.success).toBe(true);
  });

  it('rejects non-string non-null values (numbers, objects)', () => {
    expect(createProjectSchema.safeParse({ ...baseValidProject, installerIntakeJson: 42 }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...baseValidProject, installerIntakeJson: { foo: 'bar' } }).success).toBe(false);
  });

  it('rejects strings over the 20000-char cap', () => {
    const tooLong = 'x'.repeat(20001);
    const result = createProjectSchema.safeParse({ ...baseValidProject, installerIntakeJson: tooLong });
    expect(result.success).toBe(false);
  });
});
