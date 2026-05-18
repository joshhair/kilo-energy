/**
 * added-to-pipeline.test.ts — coverage for sumAddedToPipeline.
 *
 * Locks in the role-aware commission resolution + period filtering +
 * Cancelled-phase exclusion that the historical-period dashboard
 * cards depend on. The aggregator is pure (`isInPeriodFn` is
 * injected) so these tests don't need wall-clock control.
 */

import { describe, it, expect } from 'vitest';
import { sumAddedToPipeline, type PipelineProject } from '@/lib/aggregators';

const REP = 'rep_A';
const SETTER = 'rep_B';
const OTHER = 'rep_C';

function project(overrides: Partial<PipelineProject> = {}): PipelineProject {
  return {
    soldDate: '2026-05-15',
    phase: 'Installed',
    repId: REP,
    setterId: SETTER,
    m1Amount: 1000,
    m2Amount: 2000,
    m3Amount: 500,
    setterM1Amount: 800,
    setterM2Amount: 1200,
    setterM3Amount: 300,
    additionalClosers: [],
    additionalSetters: [],
    ...overrides,
  };
}

const allIn = () => true;
const noneIn = () => false;

describe('sumAddedToPipeline', () => {
  it('returns 0 when repId is null', () => {
    expect(sumAddedToPipeline([project()], null, allIn)).toBe(0);
  });

  it('returns 0 for empty project list', () => {
    expect(sumAddedToPipeline([], REP, allIn)).toBe(0);
  });

  it('closer path — sums m1+m2+m3 for primary closer', () => {
    const result = sumAddedToPipeline([project()], REP, allIn);
    expect(result).toBe(1000 + 2000 + 500);
  });

  it('setter path — sums setterM1+M2+M3 for primary setter', () => {
    const result = sumAddedToPipeline([project()], SETTER, allIn);
    expect(result).toBe(800 + 1200 + 300);
  });

  it('co-closer path — sums that party row\'s m1+m2+m3', () => {
    const p = project({
      repId: OTHER,
      setterId: 'rep_setter',
      additionalClosers: [{ userId: REP, m1Amount: 250, m2Amount: 500, m3Amount: 125 }],
    });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(250 + 500 + 125);
  });

  it('co-setter path — sums that party row\'s m1+m2+m3', () => {
    const p = project({
      repId: OTHER,
      setterId: 'rep_setter',
      additionalSetters: [{ userId: REP, m1Amount: 100, m2Amount: 200, m3Amount: 50 }],
    });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(100 + 200 + 50);
  });

  it('not on deal at all — contributes 0', () => {
    const p = project({ repId: OTHER, setterId: 'rep_setter', additionalClosers: [], additionalSetters: [] });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(0);
  });

  it('Cancelled phase excluded even if rep is on the deal', () => {
    const p = project({ phase: 'Cancelled' });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(0);
  });

  it('On Hold phase counts (pipeline value still tracked)', () => {
    const p = project({ phase: 'On Hold' });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(1000 + 2000 + 500);
  });

  it('period filter — excludes out-of-period projects', () => {
    expect(sumAddedToPipeline([project()], REP, noneIn)).toBe(0);
  });

  it('period filter — uses isInPeriodFn per project', () => {
    const inPeriod = project({ soldDate: '2026-05-15' });
    const outOfPeriod = project({ soldDate: '2026-04-01', m1Amount: 9999 });
    const fn = (d: string) => d.startsWith('2026-05');
    const result = sumAddedToPipeline([inPeriod, outOfPeriod], REP, fn);
    expect(result).toBe(1000 + 2000 + 500);
  });

  it('m3Amount nullable — handles null gracefully', () => {
    const p = project({ m3Amount: null });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(1000 + 2000 + 0);
  });

  it('co-party m3Amount nullable — handles undefined gracefully', () => {
    const p = project({
      repId: OTHER,
      setterId: 'rep_setter',
      additionalClosers: [{ userId: REP, m1Amount: 250, m2Amount: 500 }], // m3Amount omitted
    });
    expect(sumAddedToPipeline([p], REP, allIn)).toBe(250 + 500);
  });

  it('mixed deals + roles — sums correctly across multiple projects', () => {
    const projects: PipelineProject[] = [
      project({ soldDate: '2026-05-01' }), // closer path: 3500
      project({ soldDate: '2026-05-05', repId: OTHER, setterId: SETTER }), // not REP's deal, REP is on it as nothing → 0
      project({
        soldDate: '2026-05-10',
        repId: 'rep_X',
        setterId: 'rep_Y',
        additionalClosers: [{ userId: REP, m1Amount: 200, m2Amount: 300, m3Amount: 100 }],
      }), // co-closer: 600
      project({ soldDate: '2026-04-30', m1Amount: 9999 }), // out of period
      project({ soldDate: '2026-05-20', phase: 'Cancelled' }), // cancelled
    ];
    const fn = (d: string) => d.startsWith('2026-05');
    const result = sumAddedToPipeline(projects, REP, fn);
    // 3500 (project 1) + 0 (project 2 — REP not on it) + 600 (project 3) + 0 (out of period) + 0 (cancelled)
    expect(result).toBe(3500 + 600);
  });
});
