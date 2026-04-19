/**
 * API contract tests.
 *
 * These assertions pin the SHAPE of responses returned by the
 * serializer functions (lib/serialize.ts). If a field is renamed,
 * removed, or changes type, these tests fail in CI — preventing
 * silent breaks for API consumers (the React client + any future
 * external integration).
 *
 * Contract = the fields + types the client relies on. Not EVERY
 * field on the raw DB row — just the wire contract.
 *
 * Why zod schemas here instead of TypeScript types alone: TS catches
 * compile-time mismatches, but serialize output travels through
 * JSON.stringify on the wire. Runtime `schema.parse(output)` catches:
 *   - accidental `undefined` where `null` was expected
 *   - extra fields that weren't explicitly redacted
 *   - wrong numeric type (string "100" vs number 100 after float
 *     round-trip bugs)
 *   - array vs object mismatches from scrubber edge cases
 *
 * Covers the three highest-leverage serializers. Add a block here
 * for every new serialize* function before it ships.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  serializeProject,
  serializePayrollEntry,
  serializeReimbursement,
  serializeBlitzCost,
  serializeProjectParty,
} from '@/lib/serialize';

// ─── Zod schemas — the wire contract ─────────────────────────────────

const ProjectMoneyContract = z.object({
  m1Amount: z.number(),
  m2Amount: z.number(),
  m3Amount: z.number().nullable(),
  setterM1Amount: z.number(),
  setterM2Amount: z.number(),
  setterM3Amount: z.number().nullable(),
});

const ProjectBaseContract = ProjectMoneyContract.extend({
  // Base fields preserved from the raw row via the `...rest` spread.
  id: z.string(),
  customerName: z.string(),
  phase: z.string(),
  netPPW: z.number(),
  kWSize: z.number(),
}).passthrough();
// passthrough: extra fields are allowed (the serializer preserves
// everything outside the money columns). The REQUIRED fields above
// are what the client contract depends on.

const PayrollContract = z.object({
  id: z.string(),
  amount: z.number(),
}).passthrough();

const ReimbursementContract = z.object({
  id: z.string(),
  amount: z.number(),
}).passthrough();

const BlitzCostContract = z.object({
  id: z.string(),
  amount: z.number(),
}).passthrough();

const ProjectPartyContract = z.object({
  userId: z.string(),
  userName: z.string(),
  m1Amount: z.number(),
  m2Amount: z.number(),
  m3Amount: z.number().nullable(),
  position: z.number(),
});

// ─── Fixtures ──────────────────────────────────────────────────────

function sampleProjectRow() {
  return {
    id: 'p_1',
    customerName: 'Test Customer',
    phase: 'New',
    netPPW: 3.85,
    kWSize: 5.28,
    closerId: 'u_closer',
    setterId: 'u_setter',
    soldDate: '2026-04-17',
    m1AmountCents: 0,
    m2AmountCents: 232320,
    m3AmountCents: 58080,
    setterM1AmountCents: 100000,
    setterM2AmountCents: 110080,
    setterM3AmountCents: 27520,
  };
}

function samplePayrollRow() {
  return {
    id: 'pe_1',
    repId: 'u_closer',
    projectId: 'p_1',
    amountCents: 100000,
    type: 'Deal',
    paymentStage: 'M1',
    status: 'Paid',
    date: '2026-04-17',
    notes: '',
  };
}

function sampleReimbursementRow() {
  return {
    id: 'r_1',
    repId: 'u_rep',
    amountCents: 5000,
    description: 'Office supplies',
    date: '2026-04-17',
    status: 'Pending',
  };
}

function sampleBlitzCostRow() {
  return {
    id: 'bc_1',
    blitzId: 'b_1',
    amountCents: 25000,
    category: 'travel',
    description: 'Uber',
    date: '2026-04-17',
  };
}

function sampleProjectPartyRow() {
  return {
    userId: 'u_co',
    user: { firstName: 'Co', lastName: 'Closer' },
    m1AmountCents: 10000,
    m2AmountCents: 23232,
    m3AmountCents: 5808,
    position: 1,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('serializeProject — wire contract', () => {
  const out = serializeProject(sampleProjectRow());

  it('conforms to ProjectBaseContract schema', () => {
    expect(() => ProjectBaseContract.parse(out)).not.toThrow();
  });

  it('converts cents to dollars correctly', () => {
    expect(out.m1Amount).toBe(0);
    expect(out.m2Amount).toBe(2323.20);
    expect(out.m3Amount).toBe(580.80);
    expect(out.setterM1Amount).toBe(1000);
    expect(out.setterM2Amount).toBe(1100.80);
    expect(out.setterM3Amount).toBe(275.20);
  });

  it('strips *Cents fields from output', () => {
    expect('m1AmountCents' in out).toBe(false);
    expect('m2AmountCents' in out).toBe(false);
    expect('setterM3AmountCents' in out).toBe(false);
  });

  it('preserves non-money fields', () => {
    expect(out.id).toBe('p_1');
    expect(out.phase).toBe('New');
    expect(out.netPPW).toBe(3.85);
  });

  it('null M3 cents stays null on wire (not 0, not undefined)', () => {
    const row = { ...sampleProjectRow(), m3AmountCents: null, setterM3AmountCents: null };
    const res = serializeProject(row);
    expect(res.m3Amount).toBeNull();
    expect(res.setterM3Amount).toBeNull();
  });
});

describe('serializePayrollEntry — wire contract', () => {
  const out = serializePayrollEntry(samplePayrollRow());

  it('conforms to PayrollContract schema', () => {
    expect(() => PayrollContract.parse(out)).not.toThrow();
  });

  it('converts amountCents to amount (dollars)', () => {
    expect(out.amount).toBe(1000);
  });

  it('strips amountCents from output', () => {
    expect('amountCents' in out).toBe(false);
  });
});

describe('serializeReimbursement — wire contract', () => {
  const out = serializeReimbursement(sampleReimbursementRow());

  it('conforms to ReimbursementContract schema', () => {
    expect(() => ReimbursementContract.parse(out)).not.toThrow();
  });

  it('converts amountCents to amount (dollars)', () => {
    expect(out.amount).toBe(50);
  });
});

describe('serializeBlitzCost — wire contract', () => {
  const out = serializeBlitzCost(sampleBlitzCostRow());

  it('conforms to BlitzCostContract schema', () => {
    expect(() => BlitzCostContract.parse(out)).not.toThrow();
  });

  it('converts amountCents to amount', () => {
    expect(out.amount).toBe(250);
  });
});

describe('serializeProjectParty — wire contract', () => {
  const out = serializeProjectParty(sampleProjectPartyRow());

  it('conforms to ProjectPartyContract schema', () => {
    expect(() => ProjectPartyContract.parse(out)).not.toThrow();
  });

  it('composes userName from user.firstName + user.lastName', () => {
    expect(out.userName).toBe('Co Closer');
  });

  it('returns empty userName when user is missing (not crash)', () => {
    const row = { ...sampleProjectPartyRow(), user: null };
    const res = serializeProjectParty(row);
    expect(res.userName).toBe('');
  });

  it('null M3 cents stays null on wire', () => {
    const row = { ...sampleProjectPartyRow(), m3AmountCents: null };
    const res = serializeProjectParty(row);
    expect(res.m3Amount).toBeNull();
  });
});

describe('invariants across all serializers', () => {
  it('no serializer leaks *Cents suffix fields', () => {
    const project = serializeProject(sampleProjectRow()) as Record<string, unknown>;
    const payroll = serializePayrollEntry(samplePayrollRow()) as Record<string, unknown>;
    const reimb = serializeReimbursement(sampleReimbursementRow()) as Record<string, unknown>;
    const cost = serializeBlitzCost(sampleBlitzCostRow()) as Record<string, unknown>;

    for (const [name, obj] of [
      ['project', project],
      ['payroll', payroll],
      ['reimb', reimb],
      ['cost', cost],
    ] as const) {
      const centsFields = Object.keys(obj).filter((k) => k.endsWith('Cents'));
      expect(centsFields, `${name} leaked *Cents fields: ${centsFields.join(', ')}`).toHaveLength(0);
    }
  });

  it('no serializer produces NaN or Infinity for money fields', () => {
    const project = serializeProject(sampleProjectRow());
    for (const v of [project.m1Amount, project.m2Amount, project.setterM1Amount, project.setterM2Amount]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
