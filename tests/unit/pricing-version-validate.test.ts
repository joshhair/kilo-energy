import { describe, it, expect } from 'vitest';
import {
  validateTiers,
  validateWindowGraph,
  businessToday,
  type PricingTierInput,
  type VersionWindow,
} from '@/lib/pricing/validate-version';

// A well-formed Enfin-shaped tier grid (real prod shape: starts at minKW=1).
const goodTiers: PricingTierInput[] = [
  { minKW: 1, maxKW: 5, closerPerW: 2.9, setterPerW: 3.0, kiloPerW: 2.4, subDealerPerW: null },
  { minKW: 5, maxKW: 10, closerPerW: 2.7, setterPerW: 2.8, kiloPerW: 2.1, subDealerPerW: null },
  { minKW: 10, maxKW: 13, closerPerW: 2.6, setterPerW: 2.7, kiloPerW: 2.0, subDealerPerW: null },
  { minKW: 13, maxKW: null, closerPerW: 2.55, setterPerW: 2.65, kiloPerW: 2.0, subDealerPerW: null },
];

describe('validateTiers', () => {
  it('accepts a well-formed contiguous grid (minKW starts at 1)', () => {
    expect(validateTiers(goodTiers)).toEqual({ ok: true, errors: [] });
  });
  it('requires at least one tier', () => {
    expect(validateTiers([]).ok).toBe(false);
  });
  it('rejects a kW-band gap', () => {
    const t = structuredClone(goodTiers); t[1].minKW = 6; // 5→6 gap
    const r = validateTiers(t);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/gap\/overlap/);
  });
  it('rejects a kW-band overlap', () => {
    const t = structuredClone(goodTiers); t[1].minKW = 4; t[0].maxKW = 5; // overlap
    expect(validateTiers(t).ok).toBe(false);
  });
  it('requires the highest tier to be open-ended', () => {
    const t = structuredClone(goodTiers); t[3].maxKW = 20;
    expect(validateTiers(t).ok).toBe(false);
  });
  it('rejects a non-last open-ended tier', () => {
    const t = structuredClone(goodTiers); t[1].maxKW = null;
    expect(validateTiers(t).ok).toBe(false);
  });
  it('rejects rates <= 0', () => {
    const t = structuredClone(goodTiers); t[0].closerPerW = 0;
    expect(validateTiers(t).ok).toBe(false);
  });
  it('rejects loss-making closer <= kilo', () => {
    const t = structuredClone(goodTiers); t[0].closerPerW = 2.4; t[0].setterPerW = 2.5; t[0].kiloPerW = 2.4;
    const r = validateTiers(t);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/loss-making/);
  });
  it('enforces setter = closer + 0.10', () => {
    const t = structuredClone(goodTiers); t[0].setterPerW = 3.5; // != 2.9+0.10
    expect(validateTiers(t).ok).toBe(false);
  });
  it('accepts a single open-ended tier', () => {
    expect(validateTiers([{ minKW: 0, maxKW: null, closerPerW: 2.5, setterPerW: 2.6, kiloPerW: 2.0 }]).ok).toBe(true);
  });
});

describe('validateWindowGraph', () => {
  const FIXED_TODAY = '2026-06-16';
  const v1: VersionWindow = { id: 'v1', effectiveFrom: '2026-04-29', effectiveTo: null };

  it('accepts a future-dated publish over one open version', () => {
    const r = validateWindowGraph([v1], '2026-07-01', { today: FIXED_TODAY });
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it('rejects a past/today date when retroactive not allowed', () => {
    expect(validateWindowGraph([v1], '2026-06-16', { today: FIXED_TODAY }).ok).toBe(false);
    expect(validateWindowGraph([v1], '2026-06-01', { today: FIXED_TODAY }).ok).toBe(false);
  });
  it('allows a retroactive date when explicitly enabled', () => {
    expect(validateWindowGraph([v1], '2026-05-01', { today: FIXED_TODAY, allowRetroactive: true }).ok).toBe(true);
  });
  it('rejects a malformed date', () => {
    expect(validateWindowGraph([v1], '07/01/2026', { today: FIXED_TODAY }).ok).toBe(false);
  });
  it('rejects a duplicate effectiveFrom', () => {
    const existing: VersionWindow[] = [{ id: 'a', effectiveFrom: '2026-04-29', effectiveTo: '2026-06-30' }, { id: 'b', effectiveFrom: '2026-07-01', effectiveTo: null }];
    expect(validateWindowGraph(existing, '2026-07-01', { today: FIXED_TODAY }).ok).toBe(false);
  });
  it('flags pre-existing multiple open versions', () => {
    const messy: VersionWindow[] = [{ id: 'a', effectiveFrom: '2026-04-29', effectiveTo: null }, { id: 'b', effectiveFrom: '2026-05-01', effectiveTo: null }];
    const r = validateWindowGraph(messy, '2026-07-01', { today: FIXED_TODAY });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/open versions/);
  });
});

describe('businessToday', () => {
  it('formats as YYYY-MM-DD in the business timezone (Pacific), not UTC', () => {
    // 2026-06-17T05:30Z is still 2026-06-16 22:30 in Pacific (UTC-7 in June).
    expect(businessToday(new Date('2026-06-17T05:30:00Z'))).toBe('2026-06-16');
    // 2026-06-17T07:30Z is 2026-06-17 00:30 Pacific — the day has rolled over.
    expect(businessToday(new Date('2026-06-17T07:30:00Z'))).toBe('2026-06-17');
  });
});
