import { describe, it, expect } from 'vitest';
import { computeAvgCommissionPerDeal, forecastBlitzEarnings } from '@/lib/blitz-forecast';
import type { PipelineProject } from '@/lib/aggregators';

const REP = 'rep_A';
function project(overrides: Partial<PipelineProject> = {}): PipelineProject {
  return {
    soldDate: '2026-05-01',
    phase: 'Installed',
    repId: REP,
    setterId: null,
    m1Amount: 1000,
    m2Amount: 2000,
    m3Amount: 500,
    setterM1Amount: 0,
    setterM2Amount: 0,
    setterM3Amount: 0,
    additionalClosers: [],
    additionalSetters: [],
    ...overrides,
  };
}

describe('computeAvgCommissionPerDeal', () => {
  it('returns 0 with no repId', () => {
    expect(computeAvgCommissionPerDeal([project()], null)).toBe(0);
  });

  it('averages closer m1+m2+m3 across viewer-closed deals', () => {
    const projects = [
      project({ m1Amount: 1000, m2Amount: 2000, m3Amount: 500 }), // 3500
      project({ m1Amount: 2000, m2Amount: 3000, m3Amount: 1000 }), // 6000
    ];
    expect(computeAvgCommissionPerDeal(projects, REP)).toBe((3500 + 6000) / 2);
  });

  it('excludes cancelled deals', () => {
    const projects = [
      project({ m1Amount: 1000, m2Amount: 2000, m3Amount: 500 }), // 3500
      project({ phase: 'Cancelled', m1Amount: 99999 }), // ignored
    ];
    expect(computeAvgCommissionPerDeal(projects, REP)).toBe(3500);
  });

  it('uses setter fields when viewer is the setter', () => {
    const p = project({
      repId: 'other',
      setterId: REP,
      m1Amount: 0,
      m2Amount: 0,
      setterM1Amount: 500,
      setterM2Amount: 1000,
      setterM3Amount: 250,
    });
    expect(computeAvgCommissionPerDeal([p], REP)).toBe(1750);
  });

  it('uses co-closer row when viewer is a co-closer', () => {
    const p = project({
      repId: 'other',
      setterId: 'rep_setter',
      additionalClosers: [{ userId: REP, m1Amount: 100, m2Amount: 200, m3Amount: 50 }],
    });
    expect(computeAvgCommissionPerDeal([p], REP)).toBe(350);
  });

  it('returns 0 when viewer has no qualifying deals', () => {
    const p = project({ repId: 'other', setterId: 'other2' });
    expect(computeAvgCommissionPerDeal([p], REP)).toBe(0);
  });
});

describe('forecastBlitzEarnings', () => {
  it('returns 0 forecast when expectedDeals is 0', () => {
    const result = forecastBlitzEarnings({
      projects: [project(), project(), project()],
      repId: REP,
      expectedDeals: 0,
    });
    expect(result.forecast).toBe(0);
  });

  it('uses rep avg when ≥ 3 qualifying deals', () => {
    const projects = [
      project({ m1Amount: 1000, m2Amount: 2000, m3Amount: 500 }), // 3500
      project({ m1Amount: 1000, m2Amount: 2000, m3Amount: 500 }), // 3500
      project({ m1Amount: 1000, m2Amount: 2000, m3Amount: 500 }), // 3500
    ];
    const result = forecastBlitzEarnings({
      projects,
      repId: REP,
      expectedDeals: 5,
      fallbackAvgPerDeal: 9999,
    });
    expect(result.avgPerDeal).toBe(3500);
    expect(result.forecast).toBe(17500);
    expect(result.usedFallback).toBe(false);
  });

  it('uses fallback when rep has < 3 deals', () => {
    const projects = [project({ m1Amount: 1000, m2Amount: 2000, m3Amount: 500 })];
    const result = forecastBlitzEarnings({
      projects,
      repId: REP,
      expectedDeals: 5,
      fallbackAvgPerDeal: 2000,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.avgPerDeal).toBe(2000);
    expect(result.forecast).toBe(10000);
  });

  it('uses fallback when rep has 0 deals', () => {
    const result = forecastBlitzEarnings({
      projects: [],
      repId: REP,
      expectedDeals: 5,
      fallbackAvgPerDeal: 2500,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.forecast).toBe(12500);
  });

  it('returns 0 with no fallback and no rep history', () => {
    const result = forecastBlitzEarnings({ projects: [], repId: REP, expectedDeals: 5 });
    expect(result.forecast).toBe(0);
  });
});
