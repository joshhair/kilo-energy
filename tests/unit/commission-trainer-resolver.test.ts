/**
 * Tests for resolveTrainerRate — the single source of truth for the effective
 * per-watt trainer override on a deal.
 *
 * Precedence under test:
 *   1. Per-project override (project.trainerId + project.trainerRate).
 *   2. Rep-level TrainerAssignment tier chain, stepping by prior Trainer
 *      PayrollEntries attributed to this trainer-trainee pair.
 *   3. Nothing (rate = 0).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTrainerRate,
  type TrainerResolverAssignment,
  type TrainerResolverPayrollEntry,
  type TrainerResolverProject,
} from '@/lib/commission';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLOSER_ID = 'rep_closer';
const TRAINER_ID = 'rep_trainer';
const PROJECT_ID = 'proj_under_test';

/** Synthesizes N prior Trainer PayrollEntries on distinct projects. */
function priorTrainerEntries(count: number, trainerId = TRAINER_ID): TrainerResolverPayrollEntry[] {
  const entries: TrainerResolverPayrollEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      repId: trainerId,
      projectId: `prior_proj_${i}`,
      paymentStage: 'Trainer',
    });
  }
  return entries;
}

const baseProject: TrainerResolverProject = { id: PROJECT_ID };

// ─── Test 1: project-level override short-circuits the tier chain ──────────

describe('resolveTrainerRate — per-project override precedence', () => {
  it('1. project trainerId + trainerRate wins over the tier chain', () => {
    const project: TrainerResolverProject = {
      id: PROJECT_ID,
      trainerId: 'rep_ad_hoc_trainer',
      trainerRate: 0.15,
    };
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 10, ratePerW: 0.30 }],
    };
    const out = resolveTrainerRate(project, CLOSER_ID, [assignment], priorTrainerEntries(3));
    expect(out.rate).toBe(0.15);
    expect(out.trainerId).toBe('rep_ad_hoc_trainer');
    expect(out.reason).toBe('project-override');
  });
});

// ─── Tests 2-5: tier-chain walk with prior-payroll-based counting ──────────

describe('resolveTrainerRate — tier chain', () => {
  it('2. single tier, within cap → returns the tier rate', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 10, ratePerW: 0.30 }],
    };
    // 3 prior deals consumed; cap is 10, so tier 0 is still active.
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], priorTrainerEntries(3));
    expect(out.rate).toBe(0.30);
    expect(out.trainerId).toBe(TRAINER_ID);
    expect(out.reason).toBe('active-tier-0');
  });

  it('3. single tier, cap hit exactly → returns 0 with reason "maxed"', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 10, ratePerW: 0.30 }],
    };
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], priorTrainerEntries(10));
    expect(out.rate).toBe(0);
    expect(out.trainerId).toBeNull();
    expect(out.reason).toBe('maxed');
  });

  it('4. tier + perpetuity, cap hit → falls through to perpetuity rate', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [
        { upToDeal: 10, ratePerW: 0.30 },
        { upToDeal: null, ratePerW: 0.10 },
      ],
    };
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], priorTrainerEntries(10));
    expect(out.rate).toBe(0.10);
    expect(out.trainerId).toBe(TRAINER_ID);
    expect(out.reason).toBe('active-tier-1');
  });

  it('5. two capped tiers, all capacity consumed → returns 0 ("maxed")', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [
        { upToDeal: 10, ratePerW: 0.30 },
        { upToDeal: 20, ratePerW: 0.10 },
      ],
    };
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], priorTrainerEntries(20));
    expect(out.rate).toBe(0);
    expect(out.trainerId).toBeNull();
    expect(out.reason).toBe('maxed');
  });
});

// ─── Test 6: no override, no assignment ────────────────────────────────────

describe('resolveTrainerRate — nothing applies', () => {
  it('6. no project override and no matching TrainerAssignment → rate = 0', () => {
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [], []);
    expect(out.rate).toBe(0);
    expect(out.trainerId).toBeNull();
    expect(out.reason).toBe('none');
  });
});

// ─── Tests 7 & 8: isActiveTraining does NOT alter earnings ─────────────────
// Graduation (isActiveTraining = false) only changes the UI surface where
// trainees appear. The override still earns whenever the tier chain has
// capacity — and still stops earning when all capped tiers are exhausted.

describe('resolveTrainerRate — residuals / graduated trainees', () => {
  it('7. graduated trainee with only capped tiers, capacity exhausted → rate = 0', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [
        { upToDeal: 10, ratePerW: 0.30 },
        { upToDeal: 20, ratePerW: 0.10 },
      ],
      isActiveTraining: false,
    };
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], priorTrainerEntries(20));
    expect(out.rate).toBe(0);
    expect(out.reason).toBe('maxed');
  });

  it('8. graduated trainee with perpetuity tier still earning → rate = perpetuity rate', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [
        { upToDeal: 10, ratePerW: 0.30 },
        { upToDeal: null, ratePerW: 0.05 },
      ],
      isActiveTraining: false,
    };
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], priorTrainerEntries(100));
    expect(out.rate).toBe(0.05);
    expect(out.trainerId).toBe(TRAINER_ID);
    expect(out.reason).toBe('active-tier-1');
  });
});

// ─── Bonus coverage — payroll counting rules that the spec calls out ──────

describe('resolveTrainerRate — counting rules', () => {
  it('does NOT count the current deal toward prior-deal consumption', () => {
    // 9 prior deals on other projects + 1 existing Trainer entry for the
    // current project (e.g., the M2 entry when we re-enter to draft M3).
    // The current-project entry must NOT consume a tier slot.
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 10, ratePerW: 0.30 }],
    };
    const entries: TrainerResolverPayrollEntry[] = [
      ...priorTrainerEntries(9),
      // Same-project Trainer entry — must be ignored.
      { repId: TRAINER_ID, projectId: PROJECT_ID, paymentStage: 'Trainer' },
    ];
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], entries);
    expect(out.rate).toBe(0.30);
    expect(out.reason).toBe('active-tier-0');
  });

  it('de-duplicates multi-entry deals (M2 + M3 both emit for the same project)', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 2, ratePerW: 0.30 }],
    };
    // Two prior deals, each with two Trainer entries (M2 + M3). That's 4
    // rows but only 2 distinct projects → still under cap.
    const entries: TrainerResolverPayrollEntry[] = [
      { repId: TRAINER_ID, projectId: 'prior_0', paymentStage: 'Trainer' },
      { repId: TRAINER_ID, projectId: 'prior_0', paymentStage: 'Trainer' },
      { repId: TRAINER_ID, projectId: 'prior_1', paymentStage: 'Trainer' },
      { repId: TRAINER_ID, projectId: 'prior_1', paymentStage: 'Trainer' },
    ];
    // 2 distinct prior projects, cap is 2 → consumed === cap → maxed.
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], entries);
    expect(out.rate).toBe(0);
    expect(out.reason).toBe('maxed');
  });

  it('ignores non-Trainer payroll entries', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 2, ratePerW: 0.30 }],
    };
    const entries: TrainerResolverPayrollEntry[] = [
      { repId: TRAINER_ID, projectId: 'prior_0', paymentStage: 'M2' },
      { repId: TRAINER_ID, projectId: 'prior_1', paymentStage: 'M3' },
      { repId: TRAINER_ID, projectId: 'prior_2', paymentStage: 'Bonus' },
    ];
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], entries);
    expect(out.rate).toBe(0.30);
    expect(out.reason).toBe('active-tier-0');
  });

  it('ignores Trainer entries earned by a different trainer', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 2, ratePerW: 0.30 }],
    };
    const entries: TrainerResolverPayrollEntry[] = [
      { repId: 'other_trainer', projectId: 'prior_0', paymentStage: 'Trainer' },
      { repId: 'other_trainer', projectId: 'prior_1', paymentStage: 'Trainer' },
    ];
    const out = resolveTrainerRate(baseProject, CLOSER_ID, [assignment], entries);
    expect(out.rate).toBe(0.30);
    expect(out.reason).toBe('active-tier-0');
  });

  it('returns 0/none when closerRepId is null', () => {
    const assignment: TrainerResolverAssignment = {
      id: 'ta1',
      trainerId: TRAINER_ID,
      traineeId: CLOSER_ID,
      tiers: [{ upToDeal: 10, ratePerW: 0.30 }],
    };
    const out = resolveTrainerRate(baseProject, null, [assignment], []);
    expect(out.rate).toBe(0);
    expect(out.trainerId).toBeNull();
    expect(out.reason).toBe('none');
  });
});

// ─── Multi-trainee scoping (live pay-bug fix) ──────────────────────────────
// A trainer with several trainees: each trainee's tier must count ONLY the
// trainee's own deals (closer or setter), not the trainer's combined count.
// Without projectParties the count is unscoped (legacy/buggy); with it, scoped.

describe('resolveTrainerRate — multi-trainee count scoping', () => {
  const TRAINEE_B = 'rep_b';
  const TRAINEE_C = 'rep_c';
  // 0.30 for the first 2 of the TRAINEE's own deals, then 0.10 forever.
  const assignment: TrainerResolverAssignment = {
    id: 'ta1', trainerId: TRAINER_ID, traineeId: TRAINEE_B,
    tiers: [{ upToDeal: 2, ratePerW: 0.30 }, { upToDeal: null, ratePerW: 0.10 }],
  };
  // Trainer earned on ONE of B's deals + THREE of C's deals.
  const entries: TrainerResolverPayrollEntry[] = [
    { repId: TRAINER_ID, projectId: 'b_deal_0', paymentStage: 'Trainer' },
    { repId: TRAINER_ID, projectId: 'c_deal_0', paymentStage: 'Trainer' },
    { repId: TRAINER_ID, projectId: 'c_deal_1', paymentStage: 'Trainer' },
    { repId: TRAINER_ID, projectId: 'c_deal_2', paymentStage: 'Trainer' },
  ];
  const parties: ReadonlyMap<string, { closerId: string | null; setterId: string | null }> = new Map([
    ['b_deal_0', { closerId: TRAINEE_B, setterId: null }],
    ['c_deal_0', { closerId: TRAINEE_C, setterId: null }],
    ['c_deal_1', { closerId: TRAINEE_C, setterId: null }],
    ['c_deal_2', { closerId: TRAINEE_C, setterId: null }],
  ]);

  it('legacy (no projectParties) over-counts → B underpaid (documents the bug)', () => {
    // 4 combined → past the upToDeal:2 cap → drops to tier 1 (0.10).
    const out = resolveTrainerRate(baseProject, TRAINEE_B, [assignment], entries);
    expect(out.rate).toBe(0.10);
    expect(out.reason).toBe('active-tier-1');
  });

  it('scoped (with projectParties) counts only B\'s own deal → B keeps tier 0', () => {
    // Only b_deal_0 counts → 1 < 2 → tier 0 (0.30). The fix.
    const out = resolveTrainerRate(baseProject, TRAINEE_B, [assignment], entries, parties);
    expect(out.rate).toBe(0.30);
    expect(out.reason).toBe('active-tier-0');
  });

  it('counts deals where the trainee was the SETTER too (any-party union)', () => {
    // B was the setter (not closer) on two more deals → 3 of B's own deals → past cap.
    const setterEntries: TrainerResolverPayrollEntry[] = [
      ...entries,
      { repId: TRAINER_ID, projectId: 'b_setter_0', paymentStage: 'Trainer' },
      { repId: TRAINER_ID, projectId: 'b_setter_1', paymentStage: 'Trainer' },
    ];
    const setterParties = new Map(parties);
    setterParties.set('b_setter_0', { closerId: 'someone', setterId: TRAINEE_B });
    setterParties.set('b_setter_1', { closerId: 'someone', setterId: TRAINEE_B });
    const out = resolveTrainerRate(baseProject, TRAINEE_B, [assignment], setterEntries, setterParties);
    // B's own deals = b_deal_0 + b_setter_0 + b_setter_1 = 3 ≥ 2 → tier 1 (0.10).
    expect(out.rate).toBe(0.10);
    expect(out.reason).toBe('active-tier-1');
  });
});
