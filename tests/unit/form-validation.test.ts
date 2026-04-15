import { describe, it, expect } from 'vitest';
import { validateField } from '../../app/dashboard/new-deal/components/shared';

describe('validateField — Step 1 (People) fields', () => {
  describe('customerName', () => {
    it('returns an error when empty', () => {
      expect(validateField('customerName', '')).toBe('Customer name is required');
    });

    it('returns an error when only whitespace', () => {
      expect(validateField('customerName', '   ')).toBe('Customer name is required');
    });

    it('returns empty string when a name is provided', () => {
      expect(validateField('customerName', 'John & Jane Smith')).toBe('');
    });

    it('returns empty string when name has leading/trailing whitespace but is non-empty', () => {
      expect(validateField('customerName', '  Alice  ')).toBe('');
    });
  });

  describe('soldDate', () => {
    it('returns an error when empty', () => {
      expect(validateField('soldDate', '')).toBe('Sold date is required');
    });

    it('returns empty string when a date is provided', () => {
      expect(validateField('soldDate', '2026-04-14')).toBe('');
    });
  });

  describe('repId (admin-only closer field)', () => {
    it('returns an error when empty', () => {
      expect(validateField('repId', '')).toBe('Closer is required');
    });

    it('returns empty string when an id is provided', () => {
      expect(validateField('repId', 'rep_123')).toBe('');
    });
  });

  it('s1Fields set covers customerName — validateField blocks empty value', () => {
    // Simulate handleNext iterating over s1Fields for a non-admin rep
    const s1Fields = ['customerName', 'soldDate'];
    const form: Record<string, string> = { customerName: '', soldDate: '2026-04-14' };
    const errors: Record<string, string> = {};
    let hasStepErrors = false;
    for (const field of s1Fields) {
      const error = validateField(field, form[field] ?? '');
      errors[field] = error;
      if (error) hasStepErrors = true;
    }
    expect(hasStepErrors).toBe(true);
    expect(errors.customerName).toBe('Customer name is required');
    expect(errors.soldDate).toBe('');
  });
});
