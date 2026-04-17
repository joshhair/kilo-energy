import { describe, it, expect } from 'vitest';
import { PHASES, type Phase } from '@/lib/data';
import { patchProjectSchema, createProjectSchema } from '@/lib/schemas/project';
import { patchRepSchema, createRepSchema, createUserInviteSchema } from '@/lib/schemas/business';
import { patchUserSchema } from '@/lib/schemas/user';

// Guardrail: the two enum sets the app uses (phase + repType) are declared
// in multiple places — UI type in lib/data.ts, DB-side Zod schemas in
// lib/schemas/*. When these drift, the UI happily sends values the API
// rejects with a Zod 400 — user sees "Failed to save …" with no obvious
// cause.
//
// History: commit 9752f6f fixed two such drifts that had been live for
// weeks. This test fails the build the moment either side is edited in
// isolation, so future changes MUST touch both sides together.

/** Dummy values for the other required fields on createProjectSchema so we
 *  can isolate-test whether a given phase parses. Any failure here means
 *  the non-phase fields drifted, not the enum. */
const baseCreateProject = {
  customerName: 'Enum Parity Test',
  closerId: 'rep_1',
  soldDate: '2026-01-01',
  installerId: 'ins_1',
  productType: 'Solar PV',
  kWSize: 10,
  netPPW: 3.5,
};

describe('Phase enum parity — UI PHASES ↔ API schema', () => {
  it('every UI phase is accepted by patchProjectSchema', () => {
    for (const phase of PHASES) {
      const result = patchProjectSchema.safeParse({ phase });
      expect(result.success, `patchProjectSchema rejected UI phase "${phase}"`).toBe(true);
    }
  });

  it('every UI phase is accepted by createProjectSchema', () => {
    for (const phase of PHASES) {
      const result = createProjectSchema.safeParse({ ...baseCreateProject, phase });
      expect(result.success, `createProjectSchema rejected UI phase "${phase}"`).toBe(true);
    }
  });

  it('schema rejects a made-up phase', () => {
    // Sanity: the enum is actually doing something.
    const result = patchProjectSchema.safeParse({ phase: 'Delivered' as unknown as Phase });
    expect(result.success).toBe(false);
  });
});

describe('repType enum parity — UI ↔ API schemas', () => {
  const UI_REP_TYPES = ['closer', 'setter', 'both'] as const;

  it('every UI repType is accepted by patchRepSchema (/api/reps/[id])', () => {
    for (const rt of UI_REP_TYPES) {
      const result = patchRepSchema.safeParse({ repType: rt });
      expect(result.success, `patchRepSchema rejected repType "${rt}"`).toBe(true);
    }
  });

  it('every UI repType is accepted by patchUserSchema (/api/users/[id])', () => {
    for (const rt of UI_REP_TYPES) {
      const result = patchUserSchema.safeParse({ repType: rt });
      expect(result.success, `patchUserSchema rejected repType "${rt}"`).toBe(true);
    }
  });

  it('every UI repType is accepted by createRepSchema', () => {
    for (const rt of UI_REP_TYPES) {
      const result = createRepSchema.safeParse({
        firstName: 'A', lastName: 'B', email: 'a@b.com', repType: rt,
      });
      expect(result.success, `createRepSchema rejected repType "${rt}"`).toBe(true);
    }
  });

  it('every UI repType is accepted by createUserInviteSchema', () => {
    for (const rt of UI_REP_TYPES) {
      const result = createUserInviteSchema.safeParse({
        firstName: 'A', lastName: 'B', email: 'a@b.com', repType: rt,
      });
      expect(result.success, `createUserInviteSchema rejected repType "${rt}"`).toBe(true);
    }
  });

  it('schemas reject dead legacy repType values', () => {
    // These values appeared in the schemas before commit 9752f6f. They
    // were never used by the UI, seed, or DB. If someone reintroduces
    // them this test will warn them.
    const DEAD = ['solo', 'self-gen', 'trainee', 'sub-dealer'];
    for (const bad of DEAD) {
      expect(patchRepSchema.safeParse({ repType: bad }).success).toBe(false);
      expect(patchUserSchema.safeParse({ repType: bad }).success).toBe(false);
    }
  });
});
