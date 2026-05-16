/**
 * Tests for trainer-projection.ts.
 *
 * Locks in the McMorrow-class fix: even when a project has no
 * Trainer-stage PayrollEntry rows (typical before phase=Installed),
 * the projected leg amounts derived from the assignment chain are
 * surfaced. Mirrors the install-time generator in
 * lib/context/project-transitions.ts:480-557.
 */
import { describe, it, expect } from 'vitest';
import {
  computeProjectedTrainerLegs,
  sumProjectedTrainerPayForRep,
  type TrainerProjectionInput,
} from '@/lib/trainer-projection';
import type { TrainerResolverAssignment } from '@/lib/commission';

const hunter = 'u_hunter';
const chris = 'u_chris';
const kenneth = 'u_kenneth';
const senior = 'u_senior';
const project: TrainerProjectionInput = {
  id: 'p_mcmorrow',
  trainerId: null,
  trainerRate: null,
  repId: hunter,        // closer = Hunter
  setterId: chris,      // setter = Chris
  kWSize: 14.96,
};
const hunterTrainsChris: TrainerResolverAssignment = {
  id: 'a_hch',
  trainerId: hunter,
  traineeId: chris,
  tiers: [
    { upToDeal: 28, ratePerW: 0.20 },
    { upToDeal: null, ratePerW: 0.40 },
  ],
};
const seniorTrainsHunter: TrainerResolverAssignment = {
  id: 'a_sh',
  trainerId: senior,
  traineeId: hunter,
  tiers: [{ upToDeal: 10, ratePerW: 0.10 }],
};

describe('computeProjectedTrainerLegs', () => {
  it('McMorrow shape: no closer chain, setter chain to Hunter → one setter-trainer leg at tier-0 rate', () => {
    const legs = computeProjectedTrainerLegs(project, [hunterTrainsChris], []);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      trainerId: hunter,
      rate: 0.20,
      leg: 'setter-trainer',
      hasEntry: false,
      paid: false,
    });
    // Amount = 0.20 × 14.96 × 1000 = 2992.00
    expect(legs[0].amount).toBeCloseTo(2992.0, 2);
  });

  it('closer also has a chain trainer → two legs (closer + setter)', () => {
    const legs = computeProjectedTrainerLegs(project, [hunterTrainsChris, seniorTrainsHunter], []);
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.leg).sort()).toEqual(['closer-trainer', 'setter-trainer']);
    const closerLeg = legs.find((l) => l.leg === 'closer-trainer')!;
    expect(closerLeg.trainerId).toBe(senior);
    expect(closerLeg.rate).toBe(0.10);
  });

  it('per-project override + setter chain matching the override target → setter leg uses override rate', () => {
    const legs = computeProjectedTrainerLegs(
      { ...project, trainerId: hunter, trainerRate: 0.10 },
      [hunterTrainsChris],
      [],
    );
    const setterLeg = legs.find((l) => l.leg === 'setter-trainer')!;
    expect(setterLeg.trainerId).toBe(hunter);
    expect(setterLeg.rate).toBe(0.10);  // override beat tier-0's 0.20
    expect(setterLeg.reason).toBe('project-override');
  });

  it('closer is also the project-override trainer + setter present → only setter leg (no double-pay)', () => {
    // The closer-trainer leg would resolve via project-override (resolveTrainerRate step 1) since
    // trainerId/trainerRate are set; but our self-trainer-with-setter guard suppresses it so the
    // setter-trainer leg owns the override. Net: exactly one leg paid to Hunter.
    const legs = computeProjectedTrainerLegs(
      { ...project, trainerId: hunter, trainerRate: 0.10 },
      [hunterTrainsChris],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].leg).toBe('setter-trainer');
    expect(legs[0].trainerId).toBe(hunter);
  });

  it('self-gen (no setter) + closer is also trainer → closer-trainer leg fires (self-loop intentional)', () => {
    const selfGenProject: TrainerProjectionInput = { ...project, setterId: null };
    const legs = computeProjectedTrainerLegs(
      { ...selfGenProject, trainerId: hunter, trainerRate: 0.10 },
      [],
      [],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].leg).toBe('closer-trainer');
    expect(legs[0].trainerId).toBe(hunter);
  });

  it('tier exhausted → 0 legs', () => {
    const consumedEntries = Array.from({ length: 28 }, (_, i) => ({
      repId: hunter,
      projectId: `p_prior_${i}`,
      paymentStage: 'Trainer',
    }));
    const chainNoCarryOver: TrainerResolverAssignment = {
      ...hunterTrainsChris,
      tiers: [{ upToDeal: 28, ratePerW: 0.20 }],  // no perpetuity tier
    };
    const legs = computeProjectedTrainerLegs(project, [chainNoCarryOver], consumedEntries);
    expect(legs).toHaveLength(0);
  });

  it('hasEntry/paid reflect existing PayrollEntry state', () => {
    const entries = [
      { repId: hunter, projectId: project.id, paymentStage: 'Trainer', status: 'Paid' },
    ];
    const legs = computeProjectedTrainerLegs(project, [hunterTrainsChris], entries);
    expect(legs[0].hasEntry).toBe(true);
    expect(legs[0].paid).toBe(true);
  });

  it('no setter, no closer chain → 0 legs', () => {
    const noSetter: TrainerProjectionInput = { ...project, setterId: null };
    const legs = computeProjectedTrainerLegs(noSetter, [], []);
    expect(legs).toHaveLength(0);
  });

  it('non-matching project override (override target != setter chain trainer) → setter leg uses chain rate, not override', () => {
    const someoneElse = 'u_someone_else';
    const legs = computeProjectedTrainerLegs(
      { ...project, trainerId: someoneElse, trainerRate: 0.50 },
      [hunterTrainsChris],
      [],
    );
    // Closer-trainer leg fires from the project-override (resolver step 1 short-circuits regardless of trainee chain)
    // Setter-trainer leg uses chain (Hunter @ 0.20), not the override
    const setterLeg = legs.find((l) => l.leg === 'setter-trainer');
    expect(setterLeg?.trainerId).toBe(hunter);
    expect(setterLeg?.rate).toBe(0.20);
  });
});

describe('sumProjectedTrainerPayForRep', () => {
  it('returns 0 when repId is null', () => {
    expect(sumProjectedTrainerPayForRep([{ trainerId: hunter, rate: 0.2, amount: 100, leg: 'setter-trainer', reason: 'x', paid: false, hasEntry: false }], null)).toBe(0);
  });
  it('sums amounts for legs targeting the same repId', () => {
    const legs = [
      { trainerId: hunter, rate: 0.2, amount: 100, leg: 'setter-trainer' as const, reason: 'x', paid: false, hasEntry: false },
      { trainerId: hunter, rate: 0.1, amount: 50, leg: 'closer-trainer' as const, reason: 'y', paid: false, hasEntry: false },
      { trainerId: kenneth, rate: 0.4, amount: 200, leg: 'setter-trainer' as const, reason: 'z', paid: false, hasEntry: false },
    ];
    expect(sumProjectedTrainerPayForRep(legs, hunter)).toBe(150);
    expect(sumProjectedTrainerPayForRep(legs, kenneth)).toBe(200);
    expect(sumProjectedTrainerPayForRep(legs, 'u_nobody')).toBe(0);
  });
});
