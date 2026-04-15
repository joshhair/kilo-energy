/**
 * money.ts — exact-cent money arithmetic.
 *
 * Why this exists: JavaScript's IEEE 754 doubles silently lose precision on
 * long chains of money multiplication and addition. `0.1 + 0.2 !== 0.3`.
 * For a commission app that processes thousands of deals and sums their
 * payouts, that drift accumulates and eventually produces $1234.56999999.
 *
 * Strategy: represent money as an **integer count of cents**. All arithmetic
 * happens in integer space; rounding happens ONLY at the dollar↔cent
 * boundary. The DB still stores dollars as floats (Prisma Float), so the
 * conversion at the edge (`fromDollars` / `toDollars`) is the only place
 * float math is allowed.
 *
 * Contract:
 *   - A `Money` value is an integer number of cents (positive, negative, zero).
 *   - `fromDollars(d)` rounds to the nearest cent. This is the ONLY rounding.
 *   - `add/sub/mul/divideAllocate/sum/split` are pure integer ops; no drift.
 *   - `toDollars(m)` is the only float-producing output — used at DB writes.
 *
 * Not a dinero.js clone. Smaller, zero deps, matches how this codebase
 * already thinks about money (numbers in dollars).
 */

export type Money = { readonly cents: number };

// Normalize -0 → +0 so Money values are a canonical form. Downstream
// equality checks (Object.is, toBe in vitest) treat -0 !== 0, which
// bit us on property tests where a zero commission naturally arose
// via multiplication of a negative near-zero.
const norm = (n: number): number => (n === 0 ? 0 : n);

/** Construct a Money from a dollar amount. Rounds half-up to the nearest cent. */
export function fromDollars(dollars: number): Money {
  if (!Number.isFinite(dollars)) return { cents: 0 };
  return { cents: norm(Math.round(dollars * 100)) };
}

/** Construct a Money directly from an integer cent count. */
export function fromCents(cents: number): Money {
  if (!Number.isFinite(cents)) return { cents: 0 };
  return { cents: norm(Math.round(cents)) };
}

/** Emit a float dollar amount. The only float-producing operation. */
export function toDollars(m: Money): number {
  return norm(m.cents / 100);
}

export const ZERO: Money = { cents: 0 };

export function add(a: Money, b: Money): Money {
  return { cents: a.cents + b.cents };
}

export function sub(a: Money, b: Money): Money {
  return { cents: a.cents - b.cents };
}

/** Multiply money by a unitless scalar (e.g. "80%", "kW", "watts per dollar").
 *  Rounds to the nearest cent at the boundary — the scalar is the only
 *  place float sneaks in, and we contain it to a single rounding. */
export function mul(a: Money, scalar: number): Money {
  if (!Number.isFinite(scalar)) return ZERO;
  return { cents: Math.round(a.cents * scalar) };
}

/** max(a, 0) — floors at zero, used for "no negative commissions". */
export function nonNegative(a: Money): Money {
  return a.cents >= 0 ? a : ZERO;
}

export function max(a: Money, b: Money): Money {
  return a.cents >= b.cents ? a : b;
}

export function min(a: Money, b: Money): Money {
  return a.cents <= b.cents ? a : b;
}

export function eq(a: Money, b: Money): boolean {
  return a.cents === b.cents;
}

export function gt(a: Money, b: Money): boolean {
  return a.cents > b.cents;
}

export function gte(a: Money, b: Money): boolean {
  return a.cents >= b.cents;
}

/** Sum an array of Money with zero drift. A plain float-reduce over
 *  thousands of commission amounts can accumulate cent errors; this
 *  never loses a cent because the addition happens in integers. */
export function sum(arr: readonly Money[]): Money {
  let total = 0;
  for (const m of arr) total += m.cents;
  return { cents: total };
}

/** Split a Money into `n` roughly-equal parts that sum **exactly** to the
 *  original. The "remainder" cents are distributed one-per-part starting
 *  from index 0 — matches dinero.js's allocate semantics.
 *
 *  splitEvenly($10.01, 3) → [$3.34, $3.34, $3.33]  (sums to $10.01)
 *
 *  Used for the closer/setter 50/50 split so the two halves sum exactly
 *  to the whole, even when the whole has an odd cent. */
export function splitEvenly(a: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error(`splitEvenly: parts must be a positive integer, got ${parts}`);
  }
  const base = Math.trunc(a.cents / parts);
  const remainder = a.cents - base * parts;
  const remSign = Math.sign(remainder);
  const remMag = Math.abs(remainder);
  const result: Money[] = [];
  for (let i = 0; i < parts; i++) {
    // Hand out one extra cent to the first |remainder| parts.
    result.push({ cents: base + (i < remMag ? remSign : 0) });
  }
  return result;
}

/** Allocate a Money according to weights (e.g. [60, 40] for a 60/40 split).
 *  Never drops a cent; the remainder is distributed largest-weight-first. */
export function allocate(a: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new Error('allocate: weights must be non-empty');
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) throw new Error('allocate: total weight must be > 0');

  // First pass: floor each share.
  const shares = weights.map((w) => Math.floor((a.cents * w) / totalWeight));
  const assigned = shares.reduce((s, c) => s + c, 0);
  const remainder = a.cents - assigned;

  // Distribute remainder to the largest-weight buckets first so the split
  // feels fair (tie-break on index order).
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((x, y) => y.w - x.w || x.i - y.i)
    .map((x) => x.i);

  const remSign = Math.sign(remainder);
  let remaining = Math.abs(remainder);
  let k = 0;
  while (remaining > 0 && k < order.length) {
    shares[order[k]] += remSign;
    remaining--;
    k = (k + 1) % order.length;
  }

  return shares.map((c) => ({ cents: c }));
}
