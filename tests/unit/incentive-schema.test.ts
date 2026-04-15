import { describe, it, expect } from 'vitest';
import { createIncentiveSchema } from '@/lib/schemas/incentive';

const baseValid = {
  title: 'Q2 Closer Bonus',
  type: 'company' as const,
  metric: 'deals' as const,
  period: 'quarter' as const,
  startDate: '2026-04-01',
  milestones: [{ threshold: 10, reward: '$500 cash' }],
};

describe('createIncentiveSchema', () => {
  it('accepts a minimal valid company incentive', () => {
    const r = createIncentiveSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
  });

  it('defaults active to true and description to ""', () => {
    const r = createIncentiveSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.active).toBe(true);
      expect(r.data.description).toBe('');
    }
  });

  it('rejects empty title', () => {
    const r = createIncentiveSchema.safeParse({ ...baseValid, title: '' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown metric', () => {
    const r = createIncentiveSchema.safeParse({ ...baseValid, metric: 'foo' });
    expect(r.success).toBe(false);
  });

  it('rejects empty milestones array', () => {
    const r = createIncentiveSchema.safeParse({ ...baseValid, milestones: [] });
    expect(r.success).toBe(false);
  });

  it('rejects negative milestone threshold', () => {
    const r = createIncentiveSchema.safeParse({
      ...baseValid,
      milestones: [{ threshold: -5, reward: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('requires targetRepId when type=personal', () => {
    const r = createIncentiveSchema.safeParse({ ...baseValid, type: 'personal' });
    expect(r.success).toBe(false);
  });

  it('accepts personal incentive with targetRepId', () => {
    const r = createIncentiveSchema.safeParse({ ...baseValid, type: 'personal', targetRepId: 'user_123' });
    expect(r.success).toBe(true);
  });

  it('normalizes empty-string targetRepId on company incentive', () => {
    const r = createIncentiveSchema.safeParse({ ...baseValid, targetRepId: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.targetRepId).toBeUndefined();
  });

  it('caps milestones at 20', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ threshold: i + 1, reward: 'x' }));
    const r = createIncentiveSchema.safeParse({ ...baseValid, milestones: tooMany });
    expect(r.success).toBe(false);
  });
});
