// Phase 3 A2 — pure draft-then-publish state for the pricing editor.
//
// This is the ONLY place draft math lives: seed from the active version, edit
// mutates the DRAFT only (never the server / context), derive dirty + delta +
// validity, and build the publish payload. No React, no IO — fully unit-tested
// in draftPricingReducer.test.ts. The editor component is a thin view over this.
//
// Why a string `raw` per cell: the old inline editor did parseFloat(x) || 0,
// which silently turned an empty/garbage cell into 0 (a real rate) — the bug
// class that caused bad pricing. Here empty closer/kilo is INVALID, not 0, and
// blocks publish. setterPerW is never edited — it is always derived as
// closer + 0.10.

import { pickEffectiveVersion, type EffectiveWindow } from '@/lib/pricing/active-version';
import { validateTiers, type PricingTierInput } from '@/lib/pricing/validate-version';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Inputs (decoupled from lib/data types so the reducer stays testable) ──────
export interface SeedTier {
  minKW: number;
  maxKW: number | null;
  closerPerW: number;
  setterPerW: number;
  kiloPerW: number;
  subDealerPerW?: number | null;
}
export interface SeedProduct {
  id: string;
  name: string;
  tiers: ReadonlyArray<SeedTier>;
}
export interface SeedVersion extends EffectiveWindow {
  id: string;
  productId: string;
  tiers: ReadonlyArray<SeedTier>;
}

// ── Draft state ──────────────────────────────────────────────────────────────
/** A single editable rate. `raw` is the live input string; `seed` is the
 *  immutable seeded baseline (null = originally absent, e.g. no sub-dealer). */
export interface DraftCellValue {
  raw: string;
  seed: number | null;
}
export interface DraftTier {
  minKW: number;
  maxKW: number | null;
  closerPerW: DraftCellValue; // required
  kiloPerW: DraftCellValue;   // required
  subDealerPerW: DraftCellValue; // optional: seed null + raw '' = absent
}
export interface DraftProductState {
  productId: string;
  name: string;
  seedVersionId: string | null;
  tiers: DraftTier[];
}
export interface DraftState {
  byProductId: Record<string, DraftProductState>;
  productOrder: string[];
  seedVersionIds: Record<string, string | null>;
}

export type CellField = 'closer' | 'kilo' | 'subDealer';
export type DraftAction =
  | { type: 'SET_CELL'; productId: string; tierIndex: number; field: CellField; raw: string }
  | { type: 'RESET_PRODUCT'; productId: string }
  | { type: 'RESET_ALL' }
  | { type: 'RESEED'; seed: DraftState }
  | { type: 'BULK_ADJUST_CLOSER'; delta: number }
  | { type: 'BULK_SPREAD'; spreadByTierIndex: Record<number, number> };

// ── Pure helpers ─────────────────────────────────────────────────────────────
export type ParseResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: 'empty' | 'nan' };

/** Parse a rate input. Required fields: empty => invalid. Optional fields
 *  (sub-dealer): empty => null (cleared/absent), which is valid. */
export function parseRate(raw: string, opts: { optional?: boolean } = {}): ParseResult {
  const t = (raw ?? '').trim();
  if (t === '') return opts.optional ? { ok: true, value: null } : { ok: false, reason: 'empty' };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, reason: 'nan' };
  return { ok: true, value: n };
}

export const deriveSetter = (closer: number): number => round2(closer + 0.1);

const cell = (seed: number | null): DraftCellValue => ({ raw: seed == null ? '' : String(seed), seed });

function seedTierToDraft(t: SeedTier): DraftTier {
  return {
    minKW: t.minKW,
    maxKW: t.maxKW ?? null,
    closerPerW: cell(t.closerPerW),
    kiloPerW: cell(t.kiloPerW),
    subDealerPerW: cell(t.subDealerPerW == null ? null : t.subDealerPerW),
  };
}

/** Build draft state from each product's CURRENTLY-EFFECTIVE version (never a
 *  future-dated one). Falls back to product.tiers when no version is effective. */
export function seedDraftFromActive(
  products: ReadonlyArray<SeedProduct>,
  versions: ReadonlyArray<SeedVersion>,
  now: Date,
): DraftState {
  const byProductId: Record<string, DraftProductState> = {};
  const productOrder: string[] = [];
  const seedVersionIds: Record<string, string | null> = {};
  for (const p of products) {
    const active = pickEffectiveVersion(versions.filter((v) => v.productId === p.id), now);
    const seedTiers = active?.tiers ?? p.tiers;
    byProductId[p.id] = {
      productId: p.id,
      name: p.name,
      seedVersionId: active?.id ?? null,
      tiers: seedTiers.map(seedTierToDraft),
    };
    productOrder.push(p.id);
    seedVersionIds[p.id] = active?.id ?? null;
  }
  return { byProductId, productOrder, seedVersionIds };
}

const fieldKey = (f: CellField): 'closerPerW' | 'kiloPerW' | 'subDealerPerW' =>
  f === 'closer' ? 'closerPerW' : f === 'kilo' ? 'kiloPerW' : 'subDealerPerW';

const resetTier = (t: DraftTier): DraftTier => ({
  ...t,
  closerPerW: cell(t.closerPerW.seed),
  kiloPerW: cell(t.kiloPerW.seed),
  subDealerPerW: cell(t.subDealerPerW.seed),
});
const resetProduct = (p: DraftProductState): DraftProductState => ({ ...p, tiers: p.tiers.map(resetTier) });

// ── Reducer ──────────────────────────────────────────────────────────────────
export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'RESEED':
      return action.seed;
    case 'RESET_ALL': {
      const byProductId: Record<string, DraftProductState> = {};
      for (const id of state.productOrder) byProductId[id] = resetProduct(state.byProductId[id]);
      return { ...state, byProductId };
    }
    case 'RESET_PRODUCT': {
      const p = state.byProductId[action.productId];
      if (!p) return state;
      return { ...state, byProductId: { ...state.byProductId, [action.productId]: resetProduct(p) } };
    }
    case 'SET_CELL': {
      const p = state.byProductId[action.productId];
      if (!p) return state;
      const key = fieldKey(action.field);
      const tiers = p.tiers.map((t, i) =>
        i === action.tierIndex ? { ...t, [key]: { ...t[key], raw: action.raw } } : t,
      );
      return { ...state, byProductId: { ...state.byProductId, [action.productId]: { ...p, tiers } } };
    }
    case 'BULK_ADJUST_CLOSER': {
      // Re-applied off the SEED baseline so repeated adjusts replace, not stack.
      const byProductId: Record<string, DraftProductState> = {};
      for (const id of state.productOrder) {
        const p = state.byProductId[id];
        byProductId[id] = {
          ...p,
          tiers: p.tiers.map((t) => t.closerPerW.seed == null ? t : {
            ...t,
            closerPerW: { ...t.closerPerW, raw: String(round2(t.closerPerW.seed + action.delta)) },
          }),
        };
      }
      return { ...state, byProductId };
    }
    case 'BULK_SPREAD': {
      // closer = current kilo + spread[tierIndex] (kilo as the anchor floor).
      const byProductId: Record<string, DraftProductState> = {};
      for (const id of state.productOrder) {
        const p = state.byProductId[id];
        byProductId[id] = {
          ...p,
          tiers: p.tiers.map((t, i) => {
            const spread = action.spreadByTierIndex[i];
            if (spread == null) return t;
            const kiloParsed = parseRate(t.kiloPerW.raw);
            const kilo = kiloParsed.ok && kiloParsed.value != null ? kiloParsed.value : t.kiloPerW.seed;
            if (kilo == null) return t;
            return { ...t, closerPerW: { ...t.closerPerW, raw: String(round2(kilo + spread)) } };
          }),
        };
      }
      return { ...state, byProductId };
    }
    default:
      return state;
  }
}

// ── Selectors ────────────────────────────────────────────────────────────────
const isOptional = (f: CellField) => f === 'subDealer';

export function isCellDirty(c: DraftCellValue, field: CellField): boolean {
  const p = parseRate(c.raw, { optional: isOptional(field) });
  if (p.ok) {
    if (p.value == null) return c.seed != null; // cleared an optional that had a value
    return c.seed == null ? true : round2(p.value) !== round2(c.seed);
  }
  // Unparseable/empty-required edit is still "dirty" so Reset is offered.
  return c.raw.trim() !== (c.seed == null ? '' : String(c.seed));
}

export function cellDelta(c: DraftCellValue, field: CellField): number | null {
  const p = parseRate(c.raw, { optional: isOptional(field) });
  if (!p.ok || p.value == null || c.seed == null) return null;
  const d = round2(p.value - c.seed);
  return d === 0 ? null : d;
}

export function isTierDirty(t: DraftTier): boolean {
  return isCellDirty(t.closerPerW, 'closer') || isCellDirty(t.kiloPerW, 'kilo') || isCellDirty(t.subDealerPerW, 'subDealer');
}
export function isProductDirty(p: DraftProductState): boolean {
  return p.tiers.some(isTierDirty);
}
export function isDraftDirty(state: DraftState): boolean {
  return state.productOrder.some((id) => isProductDirty(state.byProductId[id]));
}

/** Validation: parse failures surface their own clear message; fully-parsed
 *  tiers delegate to the SHARED validateTiers (contiguity, closer>kilo, etc.). */
export function productValidationErrors(p: DraftProductState): string[] {
  const errors: string[] = [];
  const tiers: PricingTierInput[] = [];
  p.tiers.forEach((t, i) => {
    const where = `tier ${i + 1}`;
    const closer = parseRate(t.closerPerW.raw);
    const kilo = parseRate(t.kiloPerW.raw);
    const sd = parseRate(t.subDealerPerW.raw, { optional: true });
    if (!closer.ok) errors.push(`${where}: closer $/W must be a number.`);
    if (!kilo.ok) errors.push(`${where}: kilo $/W must be a number.`);
    if (!sd.ok) errors.push(`${where}: sub-dealer $/W must be a number or blank.`);
    if (closer.ok && closer.value != null && kilo.ok && kilo.value != null) {
      tiers.push({
        minKW: t.minKW,
        maxKW: t.maxKW,
        closerPerW: round2(closer.value),
        setterPerW: deriveSetter(closer.value),
        kiloPerW: round2(kilo.value),
        subDealerPerW: sd.ok && sd.value != null ? round2(sd.value) : null,
      });
    }
  });
  // Only run grid-level validation if every tier parsed (else the parse errors
  // above are the actionable message and a partial tier list is meaningless).
  if (errors.length === 0) errors.push(...validateTiers(tiers).errors);
  return errors;
}
export function isProductValid(p: DraftProductState): boolean {
  return productValidationErrors(p).length === 0;
}

/** Products that are BOTH dirty AND valid — the publish set. */
export function validProductsForPublish(state: DraftState): DraftProductState[] {
  return state.productOrder
    .map((id) => state.byProductId[id])
    .filter((p) => isProductDirty(p) && isProductValid(p));
}

/** Publish is allowed only when something is dirty and EVERY dirty product is
 *  valid (a single invalid product would 400 the whole atomic batch). */
export function canPublish(state: DraftState): boolean {
  const dirty = state.productOrder.map((id) => state.byProductId[id]).filter(isProductDirty);
  return dirty.length > 0 && dirty.every(isProductValid);
}

/** True if the active version under any product changed since seeding (someone
 *  else published) — drives the stale-draft banner + publish block. */
export function hasStaleSeed(state: DraftState, currentVersions: ReadonlyArray<SeedVersion>, now: Date): boolean {
  return state.productOrder.some((id) => {
    const active = pickEffectiveVersion(currentVersions.filter((v) => v.productId === id), now);
    return (active?.id ?? null) !== (state.seedVersionIds[id] ?? null);
  });
}

// ── Impact preview (A3) ──────────────────────────────────────────────────────
export type DiffField = 'closer' | 'kilo' | 'subDealer';
export interface TierDiff {
  tierLabel: string;
  field: DiffField;
  from: number | null;
  to: number | null;
  delta: number | null;
}
export interface ProductDiff {
  productId: string;
  name: string;
  changes: TierDiff[];
}
const tierBandLabel = (t: { minKW: number; maxKW: number | null }) =>
  t.maxKW == null ? `${t.minKW}+ kW` : `${t.minKW}–${t.maxKW} kW`;

/** Per-product old→new tier changes for the publish confirm preview. Only the
 *  dirty+valid products (the ones that will actually publish) and only the cells
 *  that changed. seed = the rate the active version currently has. */
export function buildPublishDiff(state: DraftState): ProductDiff[] {
  const fields: DiffField[] = ['closer', 'kilo', 'subDealer'];
  return validProductsForPublish(state)
    .map((p) => {
      const changes: TierDiff[] = [];
      p.tiers.forEach((t) => {
        const label = tierBandLabel(t);
        for (const field of fields) {
          const c = field === 'closer' ? t.closerPerW : field === 'kilo' ? t.kiloPerW : t.subDealerPerW;
          if (!isCellDirty(c, field)) continue;
          const parsed = parseRate(c.raw, { optional: field === 'subDealer' });
          const to = parsed.ok ? parsed.value : null;
          const from = c.seed;
          changes.push({ tierLabel: label, field, from, to, delta: to != null && from != null ? round2(to - from) : null });
        }
      });
      return { productId: p.productId, name: p.name, changes };
    })
    .filter((d) => d.changes.length > 0);
}

export interface PublishProduct {
  productId: string;
  tiers: Array<{ minKW: number; maxKW: number | null; closerPerW: number; setterPerW: number; kiloPerW: number; subDealerPerW: number | null }>;
}
/** Build the bulk-version-create products[] from the valid+dirty draft. */
export function buildPublishPayload(state: DraftState): PublishProduct[] {
  return validProductsForPublish(state).map((p) => ({
    productId: p.productId,
    tiers: p.tiers.map((t) => {
      // Safe: validProductsForPublish guarantees these parse to finite numbers.
      const closerP = parseRate(t.closerPerW.raw);
      const kiloP = parseRate(t.kiloPerW.raw);
      const closer = closerP.ok && closerP.value != null ? round2(closerP.value) : 0;
      const kilo = kiloP.ok && kiloP.value != null ? round2(kiloP.value) : 0;
      const sdParsed = parseRate(t.subDealerPerW.raw, { optional: true });
      const sd = sdParsed.ok && sdParsed.value != null ? round2(sdParsed.value) : null;
      return { minKW: t.minKW, maxKW: t.maxKW, closerPerW: closer, setterPerW: deriveSetter(closer), kiloPerW: kilo, subDealerPerW: sd };
    }),
  }));
}
