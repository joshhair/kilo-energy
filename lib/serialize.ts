/**
 * serialize.ts — API boundary conversion between DB (integer cents) and
 * wire format (dollar numbers).
 *
 * Why this exists: the Prisma schema stores money as Int cents (migration
 * 2026-04-15) but the client contract is dollars. Every API handler must
 * convert at the seam. Centralizing it here means:
 *   - One place to audit the conversion is exhaustive
 *   - No handler forgets a field
 *   - A new money field on the schema is a single-line addition here
 *
 * Pairs with lib/money.ts which handles the arithmetic. These helpers
 * only do the edge translation; they do NOT do arithmetic.
 */

import { fromCents, toDollars, fromDollars } from './money';

// ─── Read side: DB row (cents) → wire format (dollars) ─────────────────

/** Map the 6 money columns on a Prisma Project row to dollar numbers.
 *  Null cents fields (m3 / setterM3) stay nullable on the wire. */
export function projectMoneyFromCents(row: {
  m1AmountCents: number;
  m2AmountCents: number;
  m3AmountCents: number | null;
  setterM1AmountCents: number;
  setterM2AmountCents: number;
  setterM3AmountCents: number | null;
}): {
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
  setterM1Amount: number;
  setterM2Amount: number;
  setterM3Amount: number | null;
} {
  return {
    m1Amount: toDollars(fromCents(row.m1AmountCents)),
    m2Amount: toDollars(fromCents(row.m2AmountCents)),
    m3Amount: row.m3AmountCents == null ? null : toDollars(fromCents(row.m3AmountCents)),
    setterM1Amount: toDollars(fromCents(row.setterM1AmountCents)),
    setterM2Amount: toDollars(fromCents(row.setterM2AmountCents)),
    setterM3Amount: row.setterM3AmountCents == null ? null : toDollars(fromCents(row.setterM3AmountCents)),
  };
}

/** Takes a Prisma Project row and returns a shallow clone with money fields
 *  replaced by their dollar equivalents. Drops the `*Cents` fields. */
export function serializeProject<T extends {
  m1AmountCents: number;
  m2AmountCents: number;
  m3AmountCents: number | null;
  setterM1AmountCents: number;
  setterM2AmountCents: number;
  setterM3AmountCents: number | null;
}>(row: T): Omit<T, 'm1AmountCents' | 'm2AmountCents' | 'm3AmountCents' | 'setterM1AmountCents' | 'setterM2AmountCents' | 'setterM3AmountCents'> & ReturnType<typeof projectMoneyFromCents> {
  const {
    m1AmountCents, m2AmountCents, m3AmountCents,
    setterM1AmountCents, setterM2AmountCents, setterM3AmountCents,
    ...rest
  } = row;
  return {
    ...rest,
    ...projectMoneyFromCents({
      m1AmountCents, m2AmountCents, m3AmountCents,
      setterM1AmountCents, setterM2AmountCents, setterM3AmountCents,
    }),
  };
}

export function serializePayrollEntry<T extends { amountCents: number }>(
  row: T,
): Omit<T, 'amountCents'> & { amount: number } {
  const { amountCents, ...rest } = row;
  return { ...rest, amount: toDollars(fromCents(amountCents)) };
}

export function serializeReimbursement<T extends { amountCents: number }>(
  row: T,
): Omit<T, 'amountCents'> & { amount: number } {
  const { amountCents, ...rest } = row;
  return { ...rest, amount: toDollars(fromCents(amountCents)) };
}

export function serializeBlitzCost<T extends { amountCents: number }>(
  row: T,
): Omit<T, 'amountCents'> & { amount: number } {
  const { amountCents, ...rest } = row;
  return { ...rest, amount: toDollars(fromCents(amountCents)) };
}

// ─── Write side: wire dollars → DB cents ───────────────────────────────

/** Convert a dollar value from a request body into integer cents for a
 *  Prisma write. Returns undefined for undefined input so you can spread
 *  the result into a `data` object without overwriting unset fields. */
export function dollarsToCents(dollars: number | null | undefined): number | undefined {
  if (dollars == null) return undefined;
  return fromDollars(dollars).cents;
}

/** Same but preserves null (for nullable money fields like m3AmountCents). */
export function dollarsToNullableCents(dollars: number | null | undefined): number | null | undefined {
  if (dollars === undefined) return undefined;
  if (dollars === null) return null;
  return fromDollars(dollars).cents;
}
