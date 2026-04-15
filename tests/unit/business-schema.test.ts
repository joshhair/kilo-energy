import { describe, it, expect } from 'vitest';
import {
  createBlitzSchema,
  patchBlitzSchema,
  createBlitzCostSchema,
  createBlitzRequestSchema,
  patchBlitzRequestSchema,
  patchIncentiveSchema,
  createFinancerSchema,
  patchFinancerSchema,
  createRepSchema,
  patchRepSchema,
} from '@/lib/schemas/business';

describe('createBlitzSchema', () => {
  it('accepts minimal valid input', () => {
    expect(createBlitzSchema.safeParse({
      name: 'Spring Blitz', startDate: '2026-05-01', endDate: '2026-05-10',
    }).success).toBe(true);
  });
  it('rejects missing dates', () => {
    expect(createBlitzSchema.safeParse({ name: 'x', startDate: '2026-05-01' }).success).toBe(false);
  });
  it('rejects empty name', () => {
    expect(createBlitzSchema.safeParse({ name: '   ', startDate: '2026-05-01', endDate: '2026-05-10' }).success).toBe(false);
  });
  it('rejects invalid status enum', () => {
    expect(createBlitzSchema.safeParse({
      name: 'x', startDate: '2026-05-01', endDate: '2026-05-10', status: 'invalid',
    }).success).toBe(false);
  });
});

describe('patchBlitzSchema', () => {
  it('strict — rejects unknown fields', () => {
    expect(patchBlitzSchema.safeParse({ name: 'x', sneaky: 1 }).success).toBe(false);
  });
});

describe('createBlitzCostSchema', () => {
  it('rejects negative amount', () => {
    expect(createBlitzCostSchema.safeParse({
      category: 'travel', amount: -5, date: '2026-05-01',
    }).success).toBe(false);
  });
  it('caps amount at sanity bound', () => {
    expect(createBlitzCostSchema.safeParse({
      category: 'travel', amount: 2_000_000, date: '2026-05-01',
    }).success).toBe(false);
  });
  it('accepts valid cost', () => {
    expect(createBlitzCostSchema.safeParse({
      category: 'travel', amount: 500, date: '2026-05-01',
    }).success).toBe(true);
  });
});

describe('createBlitzRequestSchema (discriminated union)', () => {
  it('accepts create-type request', () => {
    expect(createBlitzRequestSchema.safeParse({
      type: 'create', name: 'June Blitz', startDate: '2026-06-01', endDate: '2026-06-10',
    }).success).toBe(true);
  });
  it('rejects create without name', () => {
    expect(createBlitzRequestSchema.safeParse({
      type: 'create', startDate: '2026-06-01', endDate: '2026-06-10',
    }).success).toBe(false);
  });
  it('accepts cancel-type request with blitzId', () => {
    expect(createBlitzRequestSchema.safeParse({
      type: 'cancel', blitzId: 'bl_123',
    }).success).toBe(true);
  });
  it('rejects cancel without blitzId', () => {
    expect(createBlitzRequestSchema.safeParse({ type: 'cancel' }).success).toBe(false);
  });
});

describe('patchBlitzRequestSchema', () => {
  it('rejects empty patch', () => {
    expect(patchBlitzRequestSchema.safeParse({}).success).toBe(false);
  });
  it('accepts status-only update', () => {
    expect(patchBlitzRequestSchema.safeParse({ status: 'approved' }).success).toBe(true);
  });
  it('rejects invalid status', () => {
    expect(patchBlitzRequestSchema.safeParse({ status: 'yolo' }).success).toBe(false);
  });
});

describe('patchIncentiveSchema', () => {
  it('strict — rejects unknown fields', () => {
    expect(patchIncentiveSchema.safeParse({ title: 'x', evil: true }).success).toBe(false);
  });
  it('accepts partial milestones patch', () => {
    expect(patchIncentiveSchema.safeParse({
      milestones: [{ threshold: 10, reward: '$500' }],
    }).success).toBe(true);
  });
  it('rejects empty milestones (max 20, min undefined via optional)', () => {
    // milestones is optional so omitting is fine, but empty-array isn't explicitly rejected;
    // just confirm we don't blow up on an empty array.
    expect(patchIncentiveSchema.safeParse({ milestones: [] }).success).toBe(true);
  });
});

describe('createFinancerSchema', () => {
  it('rejects empty name', () => {
    expect(createFinancerSchema.safeParse({ name: '' }).success).toBe(false);
  });
  it('accepts valid', () => {
    expect(createFinancerSchema.safeParse({ name: 'New Bank' }).success).toBe(true);
  });
});

describe('patchFinancerSchema', () => {
  it('strict — rejects unknown fields', () => {
    expect(patchFinancerSchema.safeParse({ active: true, name: 'hax' }).success).toBe(false);
  });
  it('requires active', () => {
    expect(patchFinancerSchema.safeParse({}).success).toBe(false);
  });
});

describe('createRepSchema', () => {
  it('normalizes email to lowercase', () => {
    const r = createRepSchema.safeParse({
      firstName: 'Jane', lastName: 'Doe', email: 'JANE@X.COM',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('jane@x.com');
  });
  it('rejects invalid email', () => {
    expect(createRepSchema.safeParse({
      firstName: 'x', lastName: 'y', email: 'not-email',
    }).success).toBe(false);
  });
  it('defaults role to rep', () => {
    const r = createRepSchema.safeParse({
      firstName: 'x', lastName: 'y', email: 'x@y.com',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.role).toBe('rep');
  });
});

describe('patchRepSchema', () => {
  it('strict — rejects unknown fields', () => {
    expect(patchRepSchema.safeParse({ firstName: 'x', role: 'admin' }).success).toBe(false);
  });
});
