// Exhaustive scrubber characterization — every (field × viewer-relationship)
// combination gets an assertion. These tests PIN the current
// scrubProjectForViewer behavior so the upcoming refactor to a
// declarative config-based scrubber (lib/fieldVisibility.ts) is proven
// to preserve existing RBAC semantics to the byte.
//
// If any test here fails after the refactor, the scrubber's behavior
// drifted. Fix the config or the applier — do NOT loosen the test.

import { describe, it, expect } from 'vitest';
import { scrubProjectForViewer } from '@/lib/serialize';
import type { ProjectRelationship } from '@/lib/api-auth';

const ALL_RELATIONSHIPS: ProjectRelationship[] = [
  'admin',
  'pm',
  'closer',
  'setter',
  'trainer',
  'sub-dealer',
  'none',
];

// A fully-populated project DTO with every sensitive field present.
// Tests assert what each relationship sees of this DTO.
function sampleProject() {
  return {
    id: 'proj_1',
    customerName: 'Test Customer',
    netPPW: 3.85,
    m1Paid: true,
    m1Amount: 1000,
    m2Paid: false,
    m2Amount: 2323.20,
    m3Paid: false,
    m3Amount: 580.80,
    setterM1Amount: 1000,
    setterM2Amount: 1100.80,
    setterM3Amount: 275.20,
    baselineOverride: { closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.20 },
    trainerId: 'trainer_1',
    trainerName: 'Paul Tupou',
    trainerRate: 0.10,
    additionalClosers: [
      { userId: 'cc_1', userName: 'Co Closer', m1Amount: 100, m2Amount: 232.32, m3Amount: 58.08, position: 1 },
    ],
    additionalSetters: [
      { userId: 'cs_1', userName: 'Co Setter', m1Amount: 100, m2Amount: 110.08, m3Amount: 27.52, position: 1 },
    ],
  };
}

describe('scrubProjectForViewer — field visibility contract', () => {
  describe('admin / pm — full passthrough', () => {
    for (const rel of ['admin', 'pm'] as const) {
      it(`${rel} sees everything unmodified`, () => {
        const p = sampleProject();
        const out = scrubProjectForViewer(p, rel);
        expect(out).toEqual(p);
      });
    }
  });

  describe('closer', () => {
    const p = sampleProject();
    const out = scrubProjectForViewer(p, 'closer');

    it('preserves own closer amounts (m1/m2/m3)', () => {
      expect(out.m1Amount).toBe(1000);
      expect(out.m2Amount).toBe(2323.20);
      expect(out.m3Amount).toBe(580.80);
    });
    it('preserves top-level setter amounts (so closer can sum setter total)', () => {
      expect(out.setterM1Amount).toBe(1000);
      expect(out.setterM2Amount).toBe(1100.80);
      expect(out.setterM3Amount).toBe(275.20);
    });
    it('zeroes co-setter amounts but keeps party identity (userId/userName/position)', () => {
      expect(out.additionalSetters).toHaveLength(1);
      expect(out.additionalSetters?.[0].userId).toBe('cs_1');
      expect(out.additionalSetters?.[0].userName).toBe('Co Setter');
      expect(out.additionalSetters?.[0].position).toBe(1);
      expect(out.additionalSetters?.[0].m1Amount).toBe(0);
      expect(out.additionalSetters?.[0].m2Amount).toBe(0);
      expect(out.additionalSetters?.[0].m3Amount).toBeNull();
    });
    it('preserves additionalClosers (co-closer structure visible to primary closer)', () => {
      expect(out.additionalClosers).toEqual(p.additionalClosers);
    });
    it('hides trainer identity + rate', () => {
      expect(out.trainerId).toBeUndefined();
      expect(out.trainerName).toBeUndefined();
      expect(out.trainerRate).toBeUndefined();
    });
    it('strips kiloPerW from baselineOverride', () => {
      const bo = out.baselineOverride as Record<string, unknown>;
      expect(bo.closerPerW).toBe(2.85);
      expect(bo.setterPerW).toBe(2.95);
      expect(bo.kiloPerW).toBeUndefined();
    });
  });

  describe('setter', () => {
    const p = sampleProject();
    const out = scrubProjectForViewer(p, 'setter');

    it('zeroes closer amounts', () => {
      expect(out.m1Amount).toBe(0);
      expect(out.m2Amount).toBe(0);
      expect(out.m3Amount).toBeNull();
    });
    it('preserves own setter amounts', () => {
      expect(out.setterM1Amount).toBe(1000);
      expect(out.setterM2Amount).toBe(1100.80);
      expect(out.setterM3Amount).toBe(275.20);
    });
    it('hides co-closer structure entirely (empty array)', () => {
      expect(out.additionalClosers).toEqual([]);
    });
    it('zeroes co-setter amounts but keeps party identity', () => {
      expect(out.additionalSetters).toHaveLength(1);
      expect(out.additionalSetters?.[0].m1Amount).toBe(0);
      expect(out.additionalSetters?.[0].m2Amount).toBe(0);
      expect(out.additionalSetters?.[0].m3Amount).toBeNull();
      expect(out.additionalSetters?.[0].userId).toBe('cs_1');
    });
    it('hides trainer', () => {
      expect(out.trainerId).toBeUndefined();
      expect(out.trainerName).toBeUndefined();
      expect(out.trainerRate).toBeUndefined();
    });
    it('strips kiloPerW', () => {
      expect((out.baselineOverride as Record<string, unknown>).kiloPerW).toBeUndefined();
    });
  });

  describe('trainer', () => {
    const p = sampleProject();
    const out = scrubProjectForViewer(p, 'trainer');

    it('zeroes closer amounts', () => {
      expect(out.m1Amount).toBe(0);
      expect(out.m2Amount).toBe(0);
      expect(out.m3Amount).toBeNull();
    });
    it('zeroes setter amounts', () => {
      expect(out.setterM1Amount).toBe(0);
      expect(out.setterM2Amount).toBe(0);
      expect(out.setterM3Amount).toBeNull();
    });
    it('hides co-closer + co-setter structure entirely', () => {
      expect(out.additionalClosers).toEqual([]);
      expect(out.additionalSetters).toEqual([]);
    });
    it('hides trainer identity fields (even though viewer IS trainer)', () => {
      // Current behavior: trainer-on-project doesn't see their own trainerId
      // populated on the DTO — amount is derived from trainerRate+kW downstream.
      // Documenting this as current behavior; field-visibility contract can
      // revisit if we want trainer to see trainerRate on wire.
      expect(out.trainerId).toBeUndefined();
      expect(out.trainerName).toBeUndefined();
      expect(out.trainerRate).toBeUndefined();
    });
    it('strips kiloPerW', () => {
      expect((out.baselineOverride as Record<string, unknown>).kiloPerW).toBeUndefined();
    });
  });

  describe('sub-dealer', () => {
    const p = sampleProject();
    const out = scrubProjectForViewer(p, 'sub-dealer');

    it('preserves closer amounts (SD sees their deal as primary)', () => {
      expect(out.m1Amount).toBe(1000);
      expect(out.m2Amount).toBe(2323.20);
      expect(out.m3Amount).toBe(580.80);
    });
    it('preserves setter amounts', () => {
      expect(out.setterM1Amount).toBe(1000);
      expect(out.setterM2Amount).toBe(1100.80);
      expect(out.setterM3Amount).toBe(275.20);
    });
    it('hides trainer identity', () => {
      expect(out.trainerId).toBeUndefined();
      expect(out.trainerName).toBeUndefined();
      expect(out.trainerRate).toBeUndefined();
    });
    it('strips kiloPerW', () => {
      expect((out.baselineOverride as Record<string, unknown>).kiloPerW).toBeUndefined();
    });
    it('preserves co-parties', () => {
      expect(out.additionalClosers).toEqual(p.additionalClosers);
      expect(out.additionalSetters).toEqual(p.additionalSetters);
    });
  });

  describe('none (defense in depth)', () => {
    const p = sampleProject();
    const out = scrubProjectForViewer(p, 'none');

    it('zeroes netPPW', () => {
      expect(out.netPPW).toBe(0);
    });
    it('zeroes all commission amounts', () => {
      expect(out.m1Amount).toBe(0);
      expect(out.m2Amount).toBe(0);
      expect(out.m3Amount).toBeNull();
      expect(out.setterM1Amount).toBe(0);
      expect(out.setterM2Amount).toBe(0);
      expect(out.setterM3Amount).toBeNull();
    });
    it('empties co-party arrays', () => {
      expect(out.additionalClosers).toEqual([]);
      expect(out.additionalSetters).toEqual([]);
    });
    it('hides trainer', () => {
      expect(out.trainerId).toBeUndefined();
      expect(out.trainerName).toBeUndefined();
      expect(out.trainerRate).toBeUndefined();
    });
    it('strips kiloPerW', () => {
      expect((out.baselineOverride as Record<string, unknown>).kiloPerW).toBeUndefined();
    });
  });

  describe('kiloMargin — internal P&L, admin/pm only', () => {
    it('passes through for admin', () => {
      const p = { ...sampleProject(), kiloMargin: 0.45 };
      const out = scrubProjectForViewer(p, 'admin');
      expect(out.kiloMargin).toBe(0.45);
    });
    it('passes through for pm', () => {
      const p = { ...sampleProject(), kiloMargin: 0.45 };
      const out = scrubProjectForViewer(p, 'pm');
      expect(out.kiloMargin).toBe(0.45);
    });
    for (const rel of ['closer', 'setter', 'trainer', 'sub-dealer', 'vendor_pm', 'none'] as const) {
      it(`is stripped for ${rel}`, () => {
        const p = { ...sampleProject(), kiloMargin: 0.45 };
        const out = scrubProjectForViewer(p as unknown as ReturnType<typeof sampleProject>, rel);
        expect((out as Record<string, unknown>).kiloMargin).toBeUndefined();
      });
    }
    it('is stripped from baselineOverride for non-admin/pm', () => {
      const p = sampleProject();
      (p.baselineOverride as Record<string, unknown>).kiloMargin = 0.45;
      for (const rel of ['closer', 'setter', 'trainer', 'sub-dealer', 'none'] as const) {
        const out = scrubProjectForViewer(p, rel);
        expect((out.baselineOverride as Record<string, unknown>).kiloMargin).toBeUndefined();
      }
    });
  });

  describe('invariants across all relationships', () => {
    it('returns a new object — never mutates the input', () => {
      for (const rel of ALL_RELATIONSHIPS) {
        const p = sampleProject();
        const copy = sampleProject();
        scrubProjectForViewer(p, rel);
        expect(p).toEqual(copy);
      }
    });

    it('passes through unknown fields unchanged', () => {
      for (const rel of ALL_RELATIONSHIPS) {
        const p = { ...sampleProject(), customField: 'keep me' } as ReturnType<typeof sampleProject> & { customField: string };
        const out = scrubProjectForViewer(p, rel);
        expect((out as { customField: string }).customField).toBe('keep me');
      }
    });

    it('handles missing optional fields gracefully (no crash)', () => {
      for (const rel of ALL_RELATIONSHIPS) {
        expect(() => scrubProjectForViewer({ id: 'p1' } as unknown as ReturnType<typeof sampleProject>, rel)).not.toThrow();
      }
    });
  });
});
