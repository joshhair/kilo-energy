import { describe, it, expect } from 'vitest';
import { deriveBlitzStatus } from '@/lib/blitzStatus';

describe('deriveBlitzStatus', () => {
  it('returns active when today is between startDate and endDate', () => {
    expect(deriveBlitzStatus({ status: 'upcoming', startDate: '2026-04-18', endDate: '2026-04-22' }, '2026-04-19')).toBe('active');
  });

  it('returns active when today === startDate (boundary)', () => {
    expect(deriveBlitzStatus({ status: 'upcoming', startDate: '2026-04-19', endDate: '2026-04-22' }, '2026-04-19')).toBe('active');
  });

  it('returns active when today === endDate (boundary — last day is still active)', () => {
    expect(deriveBlitzStatus({ status: 'upcoming', startDate: '2026-04-10', endDate: '2026-04-19' }, '2026-04-19')).toBe('active');
  });

  it('returns upcoming when today < startDate', () => {
    expect(deriveBlitzStatus({ status: 'upcoming', startDate: '2026-04-25', endDate: '2026-04-30' }, '2026-04-19')).toBe('upcoming');
  });

  it('returns completed when today > endDate', () => {
    expect(deriveBlitzStatus({ status: 'upcoming', startDate: '2026-04-01', endDate: '2026-04-10' }, '2026-04-19')).toBe('completed');
  });

  it('respects cancelled terminal status even if dates imply active', () => {
    expect(deriveBlitzStatus({ status: 'cancelled', startDate: '2026-04-18', endDate: '2026-04-22' }, '2026-04-19')).toBe('cancelled');
  });

  it('respects completed terminal status even if dates imply upcoming', () => {
    expect(deriveBlitzStatus({ status: 'completed', startDate: '2026-05-01', endDate: '2026-05-10' }, '2026-04-19')).toBe('completed');
  });

  it('falls back to stored status when dates are missing', () => {
    expect(deriveBlitzStatus({ status: 'active', startDate: null, endDate: null }, '2026-04-19')).toBe('active');
    expect(deriveBlitzStatus({ status: 'upcoming', startDate: null, endDate: '2026-04-22' }, '2026-04-19')).toBe('upcoming');
  });
});
