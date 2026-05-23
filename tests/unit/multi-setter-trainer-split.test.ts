/**
 * Multi-setter / multi-trainer split — verifies resolveTrainerLegs walks
 * every party on the deal (primary + co-) and produces a leg per (party,
 * trainer) pair, with shares computed from each party's M2 share of their
 * side's total.
 *
 * Anchor scenario: Bryce/Patrick/Tyson 2026-05-23 — two setters split
 * 50/50, with separate trainers (Hunter for Patrick, Paul for Tyson).
 * Each trainer should get $0.10/W × kW × installPct × 0.5, NOT $0/W for
 * one of them as the pre-2026-05-23 system did.
 *
 * History: project_kilo_setter_regression memory documents the four
 * silent-drop incidents that preceded this rule change.
 */
import { describe, it, expect } from 'vitest';
import { resolveTrainerLegs } from '@/lib/commission';

const HUNTER = 'hunter';
const PAUL = 'paul';
const PATRICK = 'patrick';
const TYSON = 'tyson';
const ALICE = 'alice';
const BOB = 'bob';
const TRAINER_X = 'trainerX';

function asg(trainerId: string, traineeId: string, rate: number) {
  return {
    id: `${trainerId}->${traineeId}`,
    trainerId,
    traineeId,
    isActiveTraining: true,
    tiers: [{ upToDeal: null, ratePerW: rate }],
  };
}

const noEntries: never[] = [];
const baseProject = { id: 'proj1', trainerId: null, trainerRate: null };
const nameLookup = (id: string) => `name-of-${id}`;

describe('resolveTrainerLegs — multi-setter trainer split', () => {
  it('Bryce scenario: Patrick + Tyson 50/50, each with own trainer, same rate', () => {
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, m2Amount: 500 },
          { userId: TYSON, m2Amount: 500 },
        ],
        trainerAssignments: [
          asg(HUNTER, PATRICK, 0.10),
          asg(PAUL, TYSON, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    // Two legs (Hunter for Patrick, Paul for Tyson). Alice has no trainer.
    expect(legs).toHaveLength(2);
    const hunterLeg = legs.find((l) => l.trainerId === HUNTER);
    const paulLeg = legs.find((l) => l.trainerId === PAUL);
    expect(hunterLeg?.share).toBeCloseTo(0.5, 5);
    expect(paulLeg?.share).toBeCloseTo(0.5, 5);
    expect(hunterLeg?.traineeId).toBe(PATRICK);
    expect(paulLeg?.traineeId).toBe(TYSON);
    expect(hunterLeg?.side).toBe('setter');
    expect(paulLeg?.side).toBe('setter');
  });

  it('Two setters with different rates: each rate × their own share', () => {
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, m2Amount: 500 },
          { userId: TYSON, m2Amount: 500 },
        ],
        trainerAssignments: [
          asg(HUNTER, PATRICK, 0.10),
          asg(PAUL, TYSON, 0.08),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    const hunterLeg = legs.find((l) => l.trainerId === HUNTER);
    const paulLeg = legs.find((l) => l.trainerId === PAUL);
    expect(hunterLeg?.ratePerW).toBe(0.10);
    expect(paulLeg?.ratePerW).toBe(0.08);
    expect(hunterLeg?.share).toBeCloseTo(0.5, 5);
    expect(paulLeg?.share).toBeCloseTo(0.5, 5);
  });

  it('Three setters at 33/33/34 with three trainers — shares track amounts', () => {
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: 'p1', m2Amount: 330 },
          { userId: 'p2', m2Amount: 330 },
          { userId: 'p3', m2Amount: 340 },
        ],
        trainerAssignments: [
          asg('t1', 'p1', 0.10),
          asg('t2', 'p2', 0.10),
          asg('t3', 'p3', 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    expect(legs).toHaveLength(3);
    const total = legs.reduce((s, l) => s + l.share, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('Setter without a TrainerAssignment is silently skipped (their share stays with no leg)', () => {
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, m2Amount: 500 },
          { userId: TYSON, m2Amount: 500 }, // no trainer
        ],
        trainerAssignments: [asg(HUNTER, PATRICK, 0.10)],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].trainerId).toBe(HUNTER);
    expect(legs[0].share).toBeCloseTo(0.5, 5);
    // Hunter gets paid on Patrick's share only — total trainer pay < single-setter case.
    // That's correct: Tyson's untrained share doesn't generate trainer commission.
  });

  it('Per-project override short-circuits multi-party logic (single-leg whole-deal)', () => {
    const legs = resolveTrainerLegs(
      {
        project: { id: 'p', trainerId: TRAINER_X, trainerRate: 0.15 },
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, m2Amount: 500 },
          { userId: TYSON, m2Amount: 500 },
        ],
        trainerAssignments: [
          asg(HUNTER, PATRICK, 0.10),
          asg(PAUL, TYSON, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].trainerId).toBe(TRAINER_X);
    expect(legs[0].ratePerW).toBe(0.15);
    expect(legs[0].share).toBe(1.0);
    expect(legs[0].side).toBe('override');
    expect(legs[0].traineeId).toBeNull();
  });

  it('Same trainer for both setters: TWO legs (caller dedups by trainerId)', () => {
    // resolveTrainerLegs returns per-PARTY legs; aggregation/dedup happens
    // in the caller (computeTrainerLegsForMilestone in project-transitions).
    // This test pins the contract: same trainer twice = two legs, not one.
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, m2Amount: 500 },
          { userId: TYSON, m2Amount: 500 },
        ],
        trainerAssignments: [
          asg(HUNTER, PATRICK, 0.10),
          asg(HUNTER, TYSON, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.trainerId === HUNTER)).toBe(true);
    const totalShare = legs.reduce((s, l) => s + l.share, 0);
    expect(totalShare).toBeCloseTo(1.0, 5);
  });

  it('Single-setter deal (legacy path) — same output as pre-2026-05-23', () => {
    // Regression guard: single-setter deals must produce IDENTICAL legs
    // to what the system generated before the multi-party refactor.
    // Share = 1.0, rate = chain rate, side = 'setter'.
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [{ userId: BOB, m2Amount: 500 }],
        trainerAssignments: [
          asg(HUNTER, ALICE, 0.10),
          asg(PAUL, BOB, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    // Alice's trainer Hunter (closer leg, share=1.0) + Bob's trainer Paul (setter leg, share=1.0).
    expect(legs).toHaveLength(2);
    const hunterLeg = legs.find((l) => l.trainerId === HUNTER);
    const paulLeg = legs.find((l) => l.trainerId === PAUL);
    expect(hunterLeg?.share).toBe(1.0);
    expect(paulLeg?.share).toBe(1.0);
    expect(hunterLeg?.side).toBe('closer');
    expect(paulLeg?.side).toBe('setter');
  });

  it('Co-closer with own trainer also generates a leg (closer-side multi-party)', () => {
    // Mirror scenario on the closer side — two closers split 50/50, each
    // with different trainers. Same logic applies.
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [
          { userId: ALICE, m2Amount: 500 },
          { userId: BOB, m2Amount: 500 },
        ],
        setterParties: [],
        trainerAssignments: [
          asg(HUNTER, ALICE, 0.10),
          asg(PAUL, BOB, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    expect(legs).toHaveLength(2);
    const hunterLeg = legs.find((l) => l.trainerId === HUNTER);
    const paulLeg = legs.find((l) => l.trainerId === PAUL);
    expect(hunterLeg?.side).toBe('closer');
    expect(paulLeg?.side).toBe('closer');
    expect(hunterLeg?.share).toBeCloseTo(0.5, 5);
    expect(paulLeg?.share).toBeCloseTo(0.5, 5);
  });

  it('Trainee names propagate from the party.userName field for accurate notes', () => {
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, userName: 'Patrick Heaton', m2Amount: 500 },
          { userId: TYSON, userName: 'Tyson Smack', m2Amount: 500 },
        ],
        trainerAssignments: [
          asg(HUNTER, PATRICK, 0.10),
          asg(PAUL, TYSON, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    const hunterLeg = legs.find((l) => l.trainerId === HUNTER);
    const paulLeg = legs.find((l) => l.trainerId === PAUL);
    expect(hunterLeg?.traineeName).toBe('Patrick Heaton');
    expect(paulLeg?.traineeName).toBe('Tyson Smack');
  });

  it('Zero-amount party gets no leg even if they have a trainer', () => {
    const legs = resolveTrainerLegs(
      {
        project: baseProject,
        closerParties: [{ userId: ALICE, m2Amount: 1000 }],
        setterParties: [
          { userId: PATRICK, m2Amount: 1000 },
          { userId: TYSON, m2Amount: 0 }, // didn't actually earn anything
        ],
        trainerAssignments: [
          asg(HUNTER, PATRICK, 0.10),
          asg(PAUL, TYSON, 0.10),
        ],
        payrollEntries: noEntries,
      },
      nameLookup,
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].trainerId).toBe(HUNTER);
    expect(legs[0].share).toBe(1.0);
  });
});
