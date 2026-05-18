/**
 * Unit tests for viewerPipelineRemaining + viewerRemainingByMilestone.
 *
 * This is the shared helper that powers both the Dashboard "In Pipeline"
 * stat and the My Pay "Pipeline" headline. The two surfaces silently
 * diverged for months before this unification — keep them honest.
 */

import { describe, it, expect } from 'vitest';
import {
  viewerPipelineRemaining,
  viewerRemainingByMilestone,
  buildPipelineMaps,
} from '@/lib/period-projection';

const TODAY = '2026-05-18';

type P = Parameters<typeof viewerPipelineRemaining>[0][number];

function project(overrides: Partial<P> & { id: string }): P {
  return {
    id: overrides.id,
    repId: 'r1',
    setterId: null,
    m1Amount: 500,
    m2Amount: 1000,
    m3Amount: 300,
    setterM1Amount: 0,
    setterM2Amount: 0,
    setterM3Amount: 0,
    additionalClosers: [],
    additionalSetters: [],
    ...overrides,
  } as P;
}

describe('viewerPipelineRemaining', () => {
  it('returns 0 across the board for a rep with no active projects', () => {
    const r = viewerPipelineRemaining([], 'r1', [], TODAY);
    expect(r).toEqual({ total: 0, m1: 0, m2: 0, m3: 0 });
  });

  it('counts the full role-aware milestone amounts when no payroll exists', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [], TODAY);
    expect(r).toEqual({ total: 1800, m1: 500, m2: 1000, m3: 300 });
  });

  it('subtracts paid milestone amounts per-stage', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 500 },
    ], TODAY);
    expect(r).toEqual({ total: 1300, m1: 0, m2: 1000, m3: 300 });
  });

  it('honors chargebacks via the payroll-net map (negative entry offsets M1)', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 500 },
      { projectId: 'p1', paymentStage: 'M1', status: 'Pending', date: '2026-04-01', amount: -200 },
    ], TODAY);
    // net M1 expected = 500 + (-200) = 300; paid stays at 500; remaining = max(0, 300-500) = 0
    expect(r.m1).toBe(0);
  });

  it('clamps per-stage so an overpayment on one milestone does NOT silently subtract from another', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [
      // Overpaid M1 by $200
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 700 },
    ], TODAY);
    // Project-total clamp would give max(0, 1800 - 700) = $1100.
    // Per-stage clamp gives max(0, 500-700) + 1000 + 300 = $1300.
    // We prefer per-stage so the breakdown stays additive.
    expect(r).toEqual({ total: 1300, m1: 0, m2: 1000, m3: 300 });
  });

  it('attributes setter milestones to the setter, not the closer', () => {
    const p = project({
      id: 'p1',
      repId: 'closer',
      setterId: 'setter',
      setterM1Amount: 250,
      setterM2Amount: 400,
      setterM3Amount: 150,
    });
    expect(viewerPipelineRemaining([p], 'setter', [], TODAY).total).toBe(800);
    expect(viewerPipelineRemaining([p], 'closer', [], TODAY).total).toBe(1800);
  });

  it('attributes additionalCloser amounts when the viewer is a co-closer', () => {
    const p = project({
      id: 'p1',
      additionalClosers: [{ userId: 'co1', m1Amount: 100, m2Amount: 200, m3Amount: 50 }],
    });
    expect(viewerPipelineRemaining([p], 'co1', [], TODAY).total).toBe(350);
  });

  it('ignores payroll entries for other reps (caller must pre-filter, but the per-project key still works)', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 500 },
    ], TODAY);
    expect(r.m1).toBe(0);
  });

  it('skips Trainer-stage payroll entries (those are tracked separately)', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [
      { projectId: 'p1', paymentStage: 'Trainer', status: 'Paid', date: '2026-02-01', amount: 200 },
    ], TODAY);
    expect(r).toEqual({ total: 1800, m1: 500, m2: 1000, m3: 300 });
  });

  it('ignores future-dated Paid entries (date > today)', () => {
    const p = project({ id: 'p1' });
    const r = viewerPipelineRemaining([p], 'r1', [
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2027-01-01', amount: 500 },
    ], TODAY);
    expect(r.m1).toBe(500);
  });

  it('breakdown rows always sum to total exactly', () => {
    const projects = [
      project({ id: 'p1' }),
      project({ id: 'p2', m1Amount: 750, m2Amount: 800, m3Amount: 0 }),
      project({ id: 'p3', m1Amount: 0, m2Amount: 0, m3Amount: 1200 }),
    ];
    const r = viewerPipelineRemaining(projects, 'r1', [
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-01-01', amount: 500 },
      { projectId: 'p2', paymentStage: 'M2', status: 'Paid', date: '2026-02-01', amount: 800 },
    ], TODAY);
    expect(r.m1 + r.m2 + r.m3).toBe(r.total);
  });
});

describe('buildPipelineMaps', () => {
  it('puts Paid entries into BOTH the net map and the paid map', () => {
    const { netByProjectStage, paidByProjectStage } = buildPipelineMaps([
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 500 },
    ], TODAY);
    expect(netByProjectStage.get('p1:M1')).toBe(500);
    expect(paidByProjectStage.get('p1:M1')).toBe(500);
  });

  it('puts non-Paid entries ONLY into the net map', () => {
    const { netByProjectStage, paidByProjectStage } = buildPipelineMaps([
      { projectId: 'p1', paymentStage: 'M1', status: 'Pending', date: '2026-02-01', amount: 500 },
    ], TODAY);
    expect(netByProjectStage.get('p1:M1')).toBe(500);
    expect(paidByProjectStage.has('p1:M1')).toBe(false);
  });

  it('skips entries with no projectId or non-M stage', () => {
    const { netByProjectStage } = buildPipelineMaps([
      { projectId: null, paymentStage: 'M1', status: 'Paid', date: '2026-02-01', amount: 500 },
      { projectId: 'p1', paymentStage: 'Bonus', status: 'Paid', date: '2026-02-01', amount: 250 },
      { projectId: 'p1', paymentStage: 'Trainer', status: 'Paid', date: '2026-02-01', amount: 100 },
    ], TODAY);
    expect(netByProjectStage.size).toBe(0);
  });
});

describe('viewerRemainingByMilestone', () => {
  it('returns m1/m2/m3 breakdown matching pipeline total', () => {
    const p = {
      id: 'p1',
      repId: 'r1',
      setterId: null,
      m1Amount: 500,
      m2Amount: 1000,
      m3Amount: 300,
      setterM1Amount: 0,
      setterM2Amount: 0,
      setterM3Amount: 0,
      additionalClosers: [],
      additionalSetters: [],
    };
    const maps = buildPipelineMaps([
      { projectId: 'p1', paymentStage: 'M1', status: 'Paid', date: '2026-01-01', amount: 500 },
    ], TODAY);
    const r = viewerRemainingByMilestone(p, 'r1', maps.netByProjectStage, maps.paidByProjectStage);
    expect(r).toEqual({ m1: 0, m2: 1000, m3: 300 });
  });
});
