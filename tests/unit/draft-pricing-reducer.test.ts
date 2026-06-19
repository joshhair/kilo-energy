import { describe, it, expect } from 'vitest';
import {
  seedDraftFromActive, draftReducer, parseRate, deriveSetter,
  isCellDirty, cellDelta, isProductDirty, isDraftDirty,
  productValidationErrors, isProductValid, validProductsForPublish, canPublish,
  hasStaleSeed, buildPublishPayload, buildPublishDiff,
  type SeedProduct, type SeedVersion,
} from '@/app/dashboard/settings/sections/pricing/draftPricingReducer';

const NOW = new Date('2026-06-16T12:00:00Z');

const TIERS = [
  { minKW: 1, maxKW: 5, closerPerW: 2.9, setterPerW: 3.0, kiloPerW: 2.4 },
  { minKW: 5, maxKW: 10, closerPerW: 2.7, setterPerW: 2.8, kiloPerW: 2.1 },
  { minKW: 10, maxKW: 13, closerPerW: 2.6, setterPerW: 2.7, kiloPerW: 2.0 },
  { minKW: 13, maxKW: null, closerPerW: 2.55, setterPerW: 2.65, kiloPerW: 2.0 },
];
const products: SeedProduct[] = [{ id: 'p1', name: 'Q.TRON', tiers: TIERS }];
const versions: SeedVersion[] = [
  { id: 'v1', productId: 'p1', effectiveFrom: '2026-01-01', effectiveTo: null, tiers: TIERS },
  // A FUTURE version that must never be the seed source.
  { id: 'vFuture', productId: 'p1', effectiveFrom: '2027-01-01', effectiveTo: null, tiers: TIERS.map((t) => ({ ...t, closerPerW: 9 })) },
];
const seed = () => seedDraftFromActive(products, versions, NOW);

describe('parseRate', () => {
  it('treats empty/whitespace as INVALID for required fields (not 0 — the old bug)', () => {
    expect(parseRate('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseRate('   ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('treats empty as null (cleared) for optional fields', () => {
    expect(parseRate('', { optional: true })).toEqual({ ok: true, value: null });
  });
  it('rejects non-numeric, accepts numbers incl. 0', () => {
    expect(parseRate('abc')).toEqual({ ok: false, reason: 'nan' });
    expect(parseRate('0')).toEqual({ ok: true, value: 0 });
    expect(parseRate('2.85')).toEqual({ ok: true, value: 2.85 });
  });
});

describe('deriveSetter', () => {
  it('is closer + 0.10, rounded to 2dp', () => {
    expect(deriveSetter(2.85)).toBe(2.95);
    expect(deriveSetter(3.45)).toBe(3.55);
    expect(deriveSetter(1.05)).toBe(1.15); // float precision
  });
});

describe('seedDraftFromActive', () => {
  it('seeds from the currently-effective version (never a future one)', () => {
    const s = seed();
    expect(s.seedVersionIds.p1).toBe('v1');
    expect(s.byProductId.p1.tiers[0].closerPerW.seed).toBe(2.9); // v1, not vFuture's 9
    expect(s.byProductId.p1.tiers[0].closerPerW.raw).toBe('2.9');
  });
  it('falls back to product.tiers when no version is effective; seedVersionId null', () => {
    const s = seedDraftFromActive(products, [], NOW);
    expect(s.seedVersionIds.p1).toBeNull();
    expect(s.byProductId.p1.seedVersionId).toBeNull();
    expect(s.byProductId.p1.tiers.length).toBe(4);
  });
  it('models an absent sub-dealer as seed null / raw empty', () => {
    const s = seed();
    expect(s.byProductId.p1.tiers[0].subDealerPerW).toEqual({ raw: '', seed: null });
  });
});

describe('SET_CELL', () => {
  it('mutates only the target cell.raw, leaving seed + siblings untouched', () => {
    const s0 = seed();
    const s1 = draftReducer(s0, { type: 'SET_CELL', productId: 'p1', tierIndex: 1, field: 'closer', raw: '2.5' });
    const t = s1.byProductId.p1.tiers[1];
    expect(t.closerPerW.raw).toBe('2.5');
    expect(t.closerPerW.seed).toBe(2.7); // seed untouched
    expect(t.kiloPerW.raw).toBe('2.1'); // sibling untouched
    expect(s1.byProductId.p1.tiers[0].closerPerW.raw).toBe('2.9'); // other tier untouched
    expect(s0.byProductId.p1.tiers[1].closerPerW.raw).toBe('2.7'); // original not mutated
  });
});

describe('dirty + delta', () => {
  it('isCellDirty: equal value (incl. 2.850 vs 2.85) is clean; change is dirty; cleared-required is dirty', () => {
    expect(isCellDirty({ raw: '2.7', seed: 2.7 }, 'closer')).toBe(false);
    expect(isCellDirty({ raw: '2.850', seed: 2.85 }, 'closer')).toBe(false);
    expect(isCellDirty({ raw: '2.5', seed: 2.7 }, 'closer')).toBe(true);
    expect(isCellDirty({ raw: '', seed: 2.7 }, 'closer')).toBe(true);
  });
  it('cellDelta: round2(value-seed) when parseable, null when empty/nan/zero', () => {
    expect(cellDelta({ raw: '2.5', seed: 2.7 }, 'closer')).toBe(-0.2);
    expect(cellDelta({ raw: '2.95', seed: 2.7 }, 'closer')).toBe(0.25);
    expect(cellDelta({ raw: '2.7', seed: 2.7 }, 'closer')).toBeNull();
    expect(cellDelta({ raw: '', seed: 2.7 }, 'closer')).toBeNull();
  });
  it('isProductDirty / isDraftDirty: false fresh, true after edit, false after reset', () => {
    const s0 = seed();
    expect(isDraftDirty(s0)).toBe(false);
    const s1 = draftReducer(s0, { type: 'SET_CELL', productId: 'p1', tierIndex: 0, field: 'closer', raw: '2.5' });
    expect(isProductDirty(s1.byProductId.p1)).toBe(true);
    expect(isDraftDirty(s1)).toBe(true);
    const s2 = draftReducer(s1, { type: 'RESET_PRODUCT', productId: 'p1' });
    expect(isDraftDirty(s2)).toBe(false);
  });
});

describe('validation', () => {
  it('empty closer yields a clear "must be a number" error (without delegating)', () => {
    const s = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 0, field: 'closer', raw: '' });
    const errs = productValidationErrors(s.byProductId.p1);
    expect(errs.join(' ')).toMatch(/tier 1: closer .* must be a number/);
    expect(isProductValid(s.byProductId.p1)).toBe(false);
  });
  it('loss-making closer <= kilo surfaces the shared validateTiers error + excludes from publish', () => {
    // set tier 1 closer to 2.0 (kilo is 2.4) -> loss-making
    const s = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 0, field: 'closer', raw: '2.0' });
    expect(productValidationErrors(s.byProductId.p1).join(' ')).toMatch(/loss-making|must exceed/);
    expect(validProductsForPublish(s).length).toBe(0);
    expect(canPublish(s)).toBe(false);
  });
  it('a fully-parsed, sane edit is valid and publishable', () => {
    const s = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 1, field: 'closer', raw: '2.5' });
    expect(isProductValid(s.byProductId.p1)).toBe(true);
    expect(canPublish(s)).toBe(true);
    expect(validProductsForPublish(s).map((p) => p.productId)).toEqual(['p1']);
  });
});

describe('reset / reseed', () => {
  it('RESET_ALL restores the whole draft to seed', () => {
    let s = seed();
    s = draftReducer(s, { type: 'SET_CELL', productId: 'p1', tierIndex: 0, field: 'closer', raw: '2.1' });
    s = draftReducer(s, { type: 'SET_CELL', productId: 'p1', tierIndex: 2, field: 'kilo', raw: '1.9' });
    expect(isDraftDirty(s)).toBe(true);
    s = draftReducer(s, { type: 'RESET_ALL' });
    expect(isDraftDirty(s)).toBe(false);
  });
  it('RESEED replaces state (post-publish), clearing dirty', () => {
    const dirty = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 0, field: 'closer', raw: '2.1' });
    const reseeded = draftReducer(dirty, { type: 'RESEED', seed: seed() });
    expect(isDraftDirty(reseeded)).toBe(false);
  });
});

describe('bulk transforms (draft-only)', () => {
  it('BULK_ADJUST_CLOSER adds delta off the SEED baseline (re-apply replaces, kilo untouched)', () => {
    let s = draftReducer(seed(), { type: 'BULK_ADJUST_CLOSER', delta: -0.1 });
    expect(s.byProductId.p1.tiers[0].closerPerW.raw).toBe('2.8'); // 2.9 - 0.1
    expect(s.byProductId.p1.tiers[0].kiloPerW.raw).toBe('2.4'); // kilo untouched
    // re-applying a different delta is off seed, not stacked
    s = draftReducer(s, { type: 'BULK_ADJUST_CLOSER', delta: -0.2 });
    expect(s.byProductId.p1.tiers[0].closerPerW.raw).toBe('2.7'); // 2.9 - 0.2, not 2.8 - 0.2
  });
  it('BULK_SPREAD sets closer = kilo + spread per tier index; valid when spread > 0', () => {
    const s = draftReducer(seed(), { type: 'BULK_SPREAD', spreadByTierIndex: { 0: 0.5, 1: 0.6, 2: 0.6, 3: 0.55 } });
    expect(s.byProductId.p1.tiers[0].closerPerW.raw).toBe('2.9'); // 2.4 + 0.5
    expect(s.byProductId.p1.tiers[1].closerPerW.raw).toBe('2.7'); // 2.1 + 0.6
    expect(isProductValid(s.byProductId.p1)).toBe(true);
  });
});

describe('hasStaleSeed', () => {
  it('false when active version ids still match the seed', () => {
    expect(hasStaleSeed(seed(), versions, NOW)).toBe(false);
  });
  it('true when a product\'s active version changed under us', () => {
    const changed: SeedVersion[] = [{ id: 'v2', productId: 'p1', effectiveFrom: '2026-06-01', effectiveTo: null, tiers: TIERS }];
    expect(hasStaleSeed(seed(), changed, NOW)).toBe(true);
  });
});

describe('buildPublishPayload', () => {
  it('emits the bulk-version-create tier shape with derived setter, only dirty+valid products', () => {
    const s = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 1, field: 'closer', raw: '2.5' });
    const payload = buildPublishPayload(s);
    expect(payload).toHaveLength(1);
    expect(payload[0].productId).toBe('p1');
    expect(payload[0].tiers).toHaveLength(4);
    expect(payload[0].tiers[1]).toMatchObject({ minKW: 5, maxKW: 10, closerPerW: 2.5, setterPerW: 2.6, kiloPerW: 2.1, subDealerPerW: null });
    expect(payload[0].tiers[3].maxKW).toBeNull(); // open-ended last tier preserved
  });
  it('returns empty when nothing dirty', () => {
    expect(buildPublishPayload(seed())).toEqual([]);
  });
});

describe('buildPublishDiff', () => {
  it('reports only changed cells per dirty+valid product, with old→new + delta', () => {
    let s = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 1, field: 'closer', raw: '2.5' });
    s = draftReducer(s, { type: 'SET_CELL', productId: 'p1', tierIndex: 2, field: 'kilo', raw: '1.9' });
    const diff = buildPublishDiff(s);
    expect(diff).toHaveLength(1);
    expect(diff[0].name).toBe('Q.TRON');
    expect(diff[0].changes).toHaveLength(2);
    const closer = diff[0].changes.find((c) => c.field === 'closer');
    expect(closer).toMatchObject({ tierLabel: '5–10 kW', from: 2.7, to: 2.5, delta: -0.2 });
    const kilo = diff[0].changes.find((c) => c.field === 'kilo');
    expect(kilo).toMatchObject({ tierLabel: '10–13 kW', from: 2.0, to: 1.9, delta: -0.1 });
  });
  it('excludes dirty-but-invalid products (they will not publish)', () => {
    const s = draftReducer(seed(), { type: 'SET_CELL', productId: 'p1', tierIndex: 0, field: 'closer', raw: '2.0' }); // loss-making
    expect(buildPublishDiff(s)).toEqual([]);
  });
  it('returns empty when nothing changed', () => {
    expect(buildPublishDiff(seed())).toEqual([]);
  });
});
