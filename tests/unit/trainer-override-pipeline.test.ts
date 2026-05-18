/**
 * Unit tests for computeTrainerOverridePipeline.
 *
 * Trainer override is per-kW commission paid to a trainer on their trainee's
 * active deals. This helper powers both the Dashboard "In Pipeline" stat
 * and the My Pay "Pipeline" headline so they reconcile (the prod bug that
 * triggered this work: Hunter's Dashboard showed $218K, My Pay $145K — a
 * $73K trainer-override gap).
 */

import { describe, it, expect } from 'vitest';
import { computeTrainerOverridePipeline } from '@/lib/period-projection';
import type { TrainerAssignment } from '@/lib/data';

const TODAY = '2026-05-18';

type Inputs = Parameters<typeof computeTrainerOverridePipeline>[0];
type Project = Inputs['projects'][number];

const TRAINER = 'trainer1';
const TRAINEE = 'trainee1';

function assignment(overrides: Partial<TrainerAssignment> = {}): TrainerAssignment {
  return {
    id: 'a1',
    trainerId: TRAINER,
    traineeId: TRAINEE,
    tiers: [{ upToDeal: null, ratePerW: 0.10 }], // $0.10/W perpetual
    ...overrides,
  };
}

function traineeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    phase: 'Installed',
    kWSize: 10,
    installer: 'EXO', // installPayPct 80 → fully-paid signal is m3Paid
    repId: TRAINEE,
    setterId: null,
    m1Paid: false,
    m2Paid: false,
    m3Paid: false,
    additionalClosers: [],
    additionalSetters: [],
    ...overrides,
  };
}

describe('computeTrainerOverridePipeline', () => {
  it('returns 0 for a rep with no trainer assignments', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [],
      projects: [traineeProject({ id: 'p1' })],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(0);
  });

  it('returns 0 when repId is null (no view-as target)', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1' })],
      payroll: [],
      installerPayConfigs: {},
      repId: null,
      today: TODAY,
    });
    expect(result).toBe(0);
  });

  it('computes override for a single active trainee deal: rate × kW × 1000', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1', kWSize: 10 })], // 0.10 × 10 × 1000 = $1000
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1000);
  });

  it('sums across multiple active trainee deals', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [
        traineeProject({ id: 'p1', kWSize: 8 }),  // $800
        traineeProject({ id: 'p2', kWSize: 12 }), // $1200
      ],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(2000);
  });

  it('subtracts already-paid Trainer-stage payroll', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1', kWSize: 10 })], // expected $1000
      payroll: [
        { projectId: 'p1', paymentStage: 'Trainer', status: 'Paid', date: '2026-02-01', amount: 400 },
      ],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(600);
  });

  it('IGNORES non-Trainer paid entries (M1/M2/M3 are tracked by base pipeline, not override)', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1', kWSize: 10 })],
      payroll: [
        { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 500 },
        { projectId: 'p1', paymentStage: 'M2', status: 'Paid', date: '2026-03-01', amount: 700 },
      ],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1000);
  });

  it('ignores Pending Trainer entries (only Paid subtracts)', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1', kWSize: 10 })],
      payroll: [
        { projectId: 'p1', paymentStage: 'Trainer', status: 'Pending', date: '2026-02-01', amount: 400 },
      ],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1000);
  });

  it('ignores future-dated Paid entries (date > today)', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1', kWSize: 10 })],
      payroll: [
        { projectId: 'p1', paymentStage: 'Trainer', status: 'Paid', date: '2027-01-01', amount: 400 },
      ],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1000);
  });

  it('clamps to 0 when over-paid (never goes negative)', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [traineeProject({ id: 'p1', kWSize: 10 })], // expected $1000
      payroll: [
        { projectId: 'p1', paymentStage: 'Trainer', status: 'Paid', date: '2026-02-01', amount: 1500 },
      ],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(0);
  });

  it('excludes Cancelled and On Hold trainee deals from the active set', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [
        traineeProject({ id: 'p1', kWSize: 10, phase: 'Cancelled' }), // skipped
        traineeProject({ id: 'p2', kWSize: 10, phase: 'On Hold' }),    // skipped
        traineeProject({ id: 'p3', kWSize: 10, phase: 'New' }),         // counts
      ],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1000);
  });

  it('progresses through tiers as the trainee completes deals (m3Paid for <100% installers)', () => {
    const tieredAssignment = assignment({
      tiers: [
        { upToDeal: 10, ratePerW: 0.10 },  // deals 0-9 → $0.10/W
        { upToDeal: null, ratePerW: 0.05 }, // deals 10+ → $0.05/W
      ],
    });
    // 10 trainee deals already fully paid out (m3Paid=true) → tier-2 rate.
    // ACTIVE_PHASES includes 'Completed', so completed deals also accrue
    // override at the new rate UNTIL a Trainer-stage payroll entry subtracts.
    const completed = Array.from({ length: 10 }, (_, i) =>
      traineeProject({ id: `done${i}`, phase: 'Completed', m3Paid: true })
    );
    const active = traineeProject({ id: 'active', kWSize: 10 });
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [tieredAssignment],
      projects: [...completed, active],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    // 11 trainee-active deals × 10kW × $0.05/W = $5,500
    expect(result).toBe(5500);
  });

  it('zeroes out completed trainee deals whose Trainer-stage payroll has been paid', () => {
    const tieredAssignment = assignment({
      tiers: [{ upToDeal: null, ratePerW: 0.05 }],
    });
    const completed = Array.from({ length: 3 }, (_, i) =>
      traineeProject({ id: `done${i}`, phase: 'Completed', m3Paid: true })
    );
    const active = traineeProject({ id: 'active', kWSize: 10 });
    // Each completed deal has its $500 Trainer override already paid.
    const payouts = completed.map((p) => ({
      projectId: p.id, paymentStage: 'Trainer' as const, status: 'Paid' as const,
      date: '2026-02-01', amount: 500,
    }));
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [tieredAssignment],
      projects: [...completed, active],
      payroll: payouts,
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    // 3 completed (paid) zero out + 1 active = $500
    expect(result).toBe(500);
  });

  it('uses m2Paid (not m3Paid) for tier progression when installer is 100% pay-at-install (SolarTech)', () => {
    const tieredAssignment = assignment({
      tiers: [
        { upToDeal: 2, ratePerW: 0.10 },
        { upToDeal: null, ratePerW: 0.05 },
      ],
    });
    // 2 SolarTech deals with m2Paid=true → tier-2 rate. All 3 trainee-active
    // deals (2 completed + 1 active) accrue at $0.05/W = $500 each.
    const completed = [
      traineeProject({ id: 'st1', installer: 'SolarTech', phase: 'Completed', m2Paid: true }),
      traineeProject({ id: 'st2', installer: 'SolarTech', phase: 'Completed', m2Paid: true }),
    ];
    const active = traineeProject({ id: 'active', kWSize: 10, installer: 'SolarTech' });
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [tieredAssignment],
      projects: [...completed, active],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1500);
  });

  it('honors per-rep installer-pay-pct overrides via installerPayConfigs', () => {
    const tieredAssignment = assignment({
      tiers: [
        { upToDeal: 2, ratePerW: 0.10 },
        { upToDeal: null, ratePerW: 0.05 },
      ],
    });
    // EXO is 80% by default → tier progresses on m3Paid. But override here
    // sets EXO to 100% → progresses on m2Paid. Two m2Paid trainee deals
    // should bump us to tier 2.
    const completed = [
      traineeProject({ id: 'exo1', installer: 'EXO', phase: 'Completed', m2Paid: true, m3Paid: false }),
      traineeProject({ id: 'exo2', installer: 'EXO', phase: 'Completed', m2Paid: true, m3Paid: false }),
    ];
    const active = traineeProject({ id: 'active', kWSize: 10, installer: 'EXO' });
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [tieredAssignment],
      projects: [...completed, active],
      payroll: [],
      installerPayConfigs: { 'EXO': { installPayPct: 100 } },
      repId: TRAINER,
      today: TODAY,
    });
    // 3 trainee-active deals × 10kW × $0.05/W = $1,500
    expect(result).toBe(1500);
  });

  it('aggregates across multiple trainer assignments for the same rep', () => {
    const trainee2 = 'trainee2';
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [
        assignment({ id: 'a1', traineeId: TRAINEE, tiers: [{ upToDeal: null, ratePerW: 0.10 }] }),
        assignment({ id: 'a2', traineeId: trainee2, tiers: [{ upToDeal: null, ratePerW: 0.05 }] }),
      ],
      projects: [
        traineeProject({ id: 'p1', kWSize: 10 }),                    // trainee1: $1000
        traineeProject({ id: 'p2', kWSize: 10, repId: trainee2 }),   // trainee2: $500
      ],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(1500);
  });

  it('returns 0 when overrideRate is 0 (rep blew through all tiers)', () => {
    const tieredAssignment = assignment({
      tiers: [{ upToDeal: 5, ratePerW: 0.10 }], // no perpetual tier — drops to 0
    });
    const completed = Array.from({ length: 5 }, (_, i) =>
      traineeProject({ id: `done${i}`, phase: 'Completed', m3Paid: true })
    );
    const active = traineeProject({ id: 'active', kWSize: 100 });
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [tieredAssignment],
      projects: [...completed, active],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(0);
  });

  it('attributes via additionalClosers / additionalSetters (co-party trainee deals)', () => {
    const result = computeTrainerOverridePipeline({
      trainerAssignments: [assignment()],
      projects: [
        traineeProject({ id: 'p1', kWSize: 10, repId: 'someoneElse', additionalClosers: [{ userId: TRAINEE }] }),
        traineeProject({ id: 'p2', kWSize: 10, repId: 'someoneElse', additionalSetters: [{ userId: TRAINEE }] }),
      ],
      payroll: [],
      installerPayConfigs: {},
      repId: TRAINER,
      today: TODAY,
    });
    expect(result).toBe(2000);
  });
});
