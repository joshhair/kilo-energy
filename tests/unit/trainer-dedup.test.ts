/**
 * Trainer single-fire rule — when the SAME trainer is reached via BOTH
 * the closer's chain AND the setter's chain on the same deal, only ONE
 * trainer-stage entry should fire per milestone. Anything else over-pays
 * the trainer (and double-deducts from the closer).
 *
 * Bug history: 3 projects on prod found via
 * scripts/prod-read/audit-trainer-double-pay.mts where Paul Tupou was
 * project-level trainer AND had a residual TrainerAssignment with the
 * setter — engine emitted 2 entries. Engine fix landed alongside this
 * test file.
 */

import { describe, it, expect } from 'vitest';
import { computeProjectedTrainerLegs } from '@/lib/trainer-projection';

const CLOSER = 'closer1';
const SETTER = 'setter1';
const TRAINER = 'trainer1';
const TRAINER2 = 'trainer2';

const baseProject = {
  id: 'proj1',
  trainerId: null,
  trainerRate: null,
  repId: CLOSER,
  setterId: SETTER,
  kWSize: 10,
};

function makeAssignment(trainerId: string, traineeId: string, rate: number) {
  return {
    id: `asg-${trainerId}-${traineeId}`,
    trainerId,
    traineeId,
    isActiveTraining: true,
    tiers: [{ upToDeal: null, ratePerW: rate }],
  };
}

describe('computeProjectedTrainerLegs — single-trainer dedup rule', () => {
  it('emits ONE leg when the same trainer is on both closer + setter via TrainerAssignment chain', () => {
    const legs = computeProjectedTrainerLegs(
      baseProject,
      [
        makeAssignment(TRAINER, CLOSER, 0.10),
        makeAssignment(TRAINER, SETTER, 0.10),
      ],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].trainerId).toBe(TRAINER);
    expect(legs[0].rate).toBe(0.10);
    expect(legs[0].amount).toBe(1000); // 0.10 × 10 × 1000
    // Closer leg is what fires (combined) — setter is suppressed
    expect(legs[0].leg).toBe('closer-trainer');
  });

  it('emits ONE leg when same trainer is on closer via project-override AND on setter via assignment', () => {
    // Project-level override: trainer T at $0.10/W.
    // Setter has independent assignment also pointing to T at $0.05/W.
    // Per override-applies-to-setter rule (project-transitions.ts), the
    // setter leg's rate is bumped to the project override's rate ($0.10).
    // The dedup then collapses to ONE leg at $0.10.
    const legs = computeProjectedTrainerLegs(
      { ...baseProject, trainerId: TRAINER, trainerRate: 0.10 },
      [
        makeAssignment(TRAINER, SETTER, 0.05),
      ],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].rate).toBe(0.10);
    expect(legs[0].trainerId).toBe(TRAINER);
  });

  it('emits TWO legs when closer + setter have DIFFERENT trainers', () => {
    const legs = computeProjectedTrainerLegs(
      baseProject,
      [
        makeAssignment(TRAINER, CLOSER, 0.10),
        makeAssignment(TRAINER2, SETTER, 0.10),
      ],
      [],
    );
    expect(legs).toHaveLength(2);
    const trainerIds = legs.map((l) => l.trainerId).sort();
    expect(trainerIds).toEqual([TRAINER, TRAINER2].sort());
  });

  it('emits ONE leg when only the closer has a trainer', () => {
    const legs = computeProjectedTrainerLegs(
      baseProject,
      [makeAssignment(TRAINER, CLOSER, 0.10)],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].leg).toBe('closer-trainer');
  });

  it('emits ONE leg when only the setter has a trainer', () => {
    const legs = computeProjectedTrainerLegs(
      baseProject,
      [makeAssignment(TRAINER, SETTER, 0.10)],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].leg).toBe('setter-trainer');
    expect(legs[0].trainerId).toBe(TRAINER);
  });

  it('emits NO legs when nobody has a trainer', () => {
    const legs = computeProjectedTrainerLegs(baseProject, [], []);
    expect(legs).toHaveLength(0);
  });

  it('handles solo deals (no setter) — closer leg fires at full amount', () => {
    const soloProject = { ...baseProject, setterId: null };
    const legs = computeProjectedTrainerLegs(
      soloProject,
      [makeAssignment(TRAINER, CLOSER, 0.10)],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].trainerId).toBe(TRAINER);
    expect(legs[0].amount).toBe(1000);
  });

  it('self-trainer-with-setter: closer is their own trainer + setter present → setter leg owns it (one fire)', () => {
    // Closer is also their own trainer — closer leg is suppressed by the
    // existing self-trainer-with-setter guard.
    const legs = computeProjectedTrainerLegs(
      baseProject,
      [
        makeAssignment(CLOSER, CLOSER, 0.10), // closer-as-trainer (degenerate but possible)
        makeAssignment(CLOSER, SETTER, 0.10), // closer pays setter
      ],
      [],
    );
    // setter-trainer leg only — closer-trainer leg suppressed.
    expect(legs).toHaveLength(1);
    expect(legs[0].leg).toBe('setter-trainer');
    expect(legs[0].trainerId).toBe(CLOSER);
  });

  it('regression: prod bug — Paul Tupou as project trainer + Nick Gleave (setter) has Paul as residual trainer', () => {
    // The exact shape that prod-read found 3 instances of.
    const project = {
      id: 'lee-strauch-deal',
      trainerId: 'paul-tupou', // project-level override
      trainerRate: 0.10,
      repId: 'josh-hair', // closer
      setterId: 'nick-gleave',
      kWSize: 10.12,
    };
    const legs = computeProjectedTrainerLegs(
      project,
      [
        // Nick has a residual TrainerAssignment with Paul at $0.10/W
        makeAssignment('paul-tupou', 'nick-gleave', 0.10),
      ],
      [],
    );
    // Before fix: 2 legs (closer-trainer + setter-trainer), both for Paul.
    // After fix: 1 leg.
    expect(legs).toHaveLength(1);
    expect(legs[0].trainerId).toBe('paul-tupou');
    expect(legs[0].amount).toBeCloseTo(0.10 * 10.12 * 1000, 2); // = 1012
  });
});
