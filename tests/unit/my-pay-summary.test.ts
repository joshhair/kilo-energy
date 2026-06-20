/**
 * my-pay-summary.test.ts — locks the GET /api/my-pay number assembly.
 *
 * computeMyPaySummary is a pure orchestrator: it must reproduce the rep
 * dashboard's hero numbers by sequencing the shared aggregators /
 * period-projection helpers (the math itself is locked by
 * on-pace-projection.test.ts, pipeline-remaining.test.ts, etc.). These
 * cases assert the orchestrator wires those helpers correctly and scopes
 * to the rep's own data.
 */

import { describe, it, expect } from 'vitest';
import {
  computeMyPaySummary,
  type MyPaySummaryProject,
  type MyPaySummaryPayroll,
} from '@/lib/my-pay-summary';
import { viewerPipelineRemaining, computeTrainerOverridePipeline } from '@/lib/period-projection';
import { ACTIVE_PHASES } from '@/lib/data';

const REP = 'rep_A';
// 2026-06-15 19:00 UTC === 2026-06-15 12:00 PDT (Pacific). 2026-06-15 is a
// Monday, so the next Friday is 2026-06-19.
const NOW = new Date('2026-06-15T19:00:00Z');

const project = (over: Partial<MyPaySummaryProject>): MyPaySummaryProject => ({
  id: 'p', phase: 'Acceptance', soldDate: '2026-03-01', kWSize: 8, installer: 'X',
  repId: REP, setterId: null, trainerId: null,
  m1Amount: 0, m2Amount: 0, m3Amount: 0,
  setterM1Amount: 0, setterM2Amount: 0, setterM3Amount: 0,
  ...over,
});

const PAYROLL: MyPaySummaryPayroll[] = [
  { status: 'Paid', date: '2026-01-10', amount: 1000, repId: REP },     // counts toward lifetime
  { status: 'Paid', date: '2026-12-01', amount: 500, repId: REP },      // future-dated Paid → excluded (date > today)
  { status: 'Pending', date: '2026-06-19', amount: 800, repId: REP },   // lands on the next Friday
  { status: 'Pending', date: '2026-07-01', amount: 200, repId: REP },   // pending, not next Friday
];

const PROJECTS: MyPaySummaryProject[] = [
  project({ id: 'p1', phase: 'Acceptance', m1Amount: 500, m2Amount: 4000, m3Amount: 10000 }),
  project({ id: 'p2', phase: 'Cancelled', soldDate: '2026-02-01', m1Amount: 300, m2Amount: 1000, m3Amount: 2000 }),
];

describe('computeMyPaySummary', () => {
  const summary = computeMyPaySummary({
    payroll: PAYROLL, projects: PROJECTS,
    trainerAssignments: [], installerPayConfigs: {}, repId: REP, now: NOW,
  });

  it('lifetimeEarned = sumPaid as-of today (future-dated Paid excluded)', () => {
    expect(summary.lifetimeEarned).toBe(1000);
  });

  it('pending = sumPending (no date cutoff — future milestones still count)', () => {
    expect(summary.pending).toBe(1000);
  });

  it('nextPayout = sum of Pending landing on the next Friday', () => {
    expect(summary.nextPayout).toBe(800);
    expect(summary.nextPayoutLabel).toBe('Friday, June 19');
  });

  it('nextPayout is null when nothing pends on that Friday', () => {
    const s = computeMyPaySummary({
      payroll: PAYROLL.filter((p) => p.date !== '2026-06-19'),
      projects: [], trainerAssignments: [], installerPayConfigs: {}, repId: REP, now: NOW,
    });
    expect(s.nextPayout).toBeNull();
    expect(s.nextPayoutLabel).toBe('Friday, June 19'); // label still resolves
  });

  it('pipeline wires viewerPipelineRemaining + trainer override exactly', () => {
    const active = PROJECTS.filter((p) => (ACTIVE_PHASES as readonly string[]).includes(p.phase));
    const expected = viewerPipelineRemaining(active, REP, PAYROLL, '2026-06-15').total
      + computeTrainerOverridePipeline({
          trainerAssignments: [], projects: PROJECTS, payroll: PAYROLL,
          installerPayConfigs: {}, repId: REP, today: '2026-06-15',
        });
    expect(summary.pipeline).toBe(expected);
    expect(summary.pipeline).toBeGreaterThan(0); // P1 has unpaid milestones
  });

  it('onPace is at least the in-period commission earned, with year caption', () => {
    // P1 ($14,500 full commission) sold in-year; the cancelled P2 is excluded.
    expect(summary.onPace).toBeGreaterThanOrEqual(14_500);
    expect(summary.onPaceCaption).toBe('On Pace For 2026');
  });

  it('a cancelled deal does not count toward on-pace', () => {
    const onlyCancelled = computeMyPaySummary({
      payroll: [], projects: [project({ id: 'pc', phase: 'Cancelled', m1Amount: 9999, m2Amount: 9999, m3Amount: 9999 })],
      trainerAssignments: [], installerPayConfigs: {}, repId: REP, now: NOW,
    });
    expect(onlyCancelled.onPace).toBe(0);
    expect(onlyCancelled.pipeline).toBe(0); // Cancelled is not an active phase
  });

  // Regression guard for the chain-trainee parity fix: a trainee's deal (the
  // rep is the assignment trainer, NOT a party) must feed the trainer-override
  // pipeline, yet stay OUT of the rep's own pipeline-base + on-pace.
  it('trainee deals drive trainer-override pipeline but not on-pace', () => {
    const TRAINEE = 'trainee_X';
    const traineeDeal = project({
      id: 'tn1', repId: TRAINEE, phase: 'Installed', kWSize: 10, installer: 'EXO',
      m1Amount: 9999, m2Amount: 9999, m3Amount: 9999, // would explode on-pace if wrongly counted
    });
    const s = computeMyPaySummary({
      payroll: [],
      projects: [traineeDeal], // rep is NOT a party to this deal
      trainerAssignments: [{ id: 'a1', trainerId: REP, traineeId: TRAINEE, tiers: [{ upToDeal: null, ratePerW: 0.10 }] }],
      installerPayConfigs: {}, repId: REP, now: NOW,
    });
    // override = $0.10/W × 10kW × 1000 = $1000; base pipeline 0 (not a party).
    expect(s.pipeline).toBe(1000);
    // the trainee deal is excluded from the rep's own on-pace + lifetime.
    expect(s.onPace).toBe(0);
    expect(s.lifetimeEarned).toBe(0);
  });
});
