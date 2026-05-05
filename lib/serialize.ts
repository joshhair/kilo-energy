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
/**
 * Flattens relational objects that Prisma `include`s might have
 * attached (installer, financer) down to their `.name` string. Client
 * types in lib/data.ts declare these as strings, so sending the raw
 * Prisma object causes React error #31 ("Objects are not valid as a
 * React child") when any view renders {project.installer} directly.
 * Applied inside serializeProject so every endpoint that returns a
 * project DTO gets consistent shape regardless of what it `include`d.
 */
function flattenNamed(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'name' in (v as object)) {
    const name = (v as { name: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

/**
 * Builds a "First Last" display name from a Prisma user relation, or
 * null when the relation is absent. Used to derive repName/setterName/
 * trainerName/subDealerName from the include'd join.
 */
function personFullName(v: unknown): string | null {
  if (v == null || typeof v !== 'object') return null;
  const obj = v as { firstName?: unknown; lastName?: unknown };
  const first = typeof obj.firstName === 'string' ? obj.firstName : '';
  const last = typeof obj.lastName === 'string' ? obj.lastName : '';
  const joined = `${first} ${last}`.trim();
  return joined || null;
}

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
  const maybeInstaller = (rest as { installer?: unknown }).installer;
  const maybeFinancer = (rest as { financer?: unknown }).financer;
  const maybeCloser = (rest as { closer?: unknown }).closer;
  const maybeSetter = (rest as { setter?: unknown }).setter;
  const maybeTrainer = (rest as { trainer?: unknown }).trainer;
  const maybeSubDealer = (rest as { subDealer?: unknown }).subDealer;

  // Only rewrite when the field is actually present AND an object shape.
  // Pre-normalized strings or undefineds pass through unchanged.
  const installerOverride = (maybeInstaller != null && typeof maybeInstaller !== 'string')
    ? { installer: flattenNamed(maybeInstaller) }
    : {};
  const financerOverride = (maybeFinancer != null && typeof maybeFinancer !== 'string')
    ? { financer: flattenNamed(maybeFinancer) }
    : {};

  // Person relations (closer/setter/trainer/subDealer) get flattened to
  // *Name string fields matching the client's Project type. Only derive
  // when the relation is present; caller can still set *Name directly.
  const nameOverrides: Record<string, string | undefined> = {};
  const closerName = personFullName(maybeCloser);
  const setterName = personFullName(maybeSetter);
  const trainerName = personFullName(maybeTrainer);
  const subDealerName = personFullName(maybeSubDealer);
  if (closerName) nameOverrides.repName = closerName;
  if (setterName) nameOverrides.setterName = setterName;
  if (trainerName) nameOverrides.trainerName = trainerName;
  if (subDealerName) nameOverrides.subDealerName = subDealerName;

  return {
    ...rest,
    ...installerOverride,
    ...financerOverride,
    ...nameOverrides,
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

/** A co-closer / co-setter row serialized for the wire. The user join is
 *  required here — we expose the display name inline so the client doesn't
 *  have to look it up in the reps list. */
export interface SerializedProjectParty {
  userId: string;
  userName: string;
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
  position: number;
}

export function serializeProjectParty(row: {
  userId: string;
  user?: { firstName: string; lastName: string } | null;
  m1AmountCents: number;
  m2AmountCents: number;
  m3AmountCents: number | null;
  position: number;
}): SerializedProjectParty {
  const userName = row.user ? `${row.user.firstName} ${row.user.lastName}` : '';
  return {
    userId: row.userId,
    userName,
    m1Amount: toDollars(fromCents(row.m1AmountCents)),
    m2Amount: toDollars(fromCents(row.m2AmountCents)),
    m3Amount: row.m3AmountCents == null ? null : toDollars(fromCents(row.m3AmountCents)),
    position: row.position,
  };
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

// ─── Viewer-aware scrubbing ────────────────────────────────────────────

import type { ProjectRelationship } from './api-auth';
import { applyProjectVisibility } from './fieldVisibility';

/** Shape a serialized Project DTO must minimally have for the scrubber to
 *  operate. Fields not present on the DTO are ignored. Keeps the scrubber
 *  generic so it can apply to the /api/data shape, /api/projects/[id] shape,
 *  and /api/blitzes/[id] shape without strict typing coupling. */
interface ScrubbableProjectDTO {
  netPPW?: number;
  m1Paid?: boolean;
  m1Amount?: number;
  m2Paid?: boolean;
  m2Amount?: number;
  m3Paid?: boolean;
  m3Amount?: number | null;
  setterM1Amount?: number | null;
  setterM2Amount?: number | null;
  setterM3Amount?: number | null;
  baselineOverride?: unknown;
  trainerId?: string | null;
  trainerName?: string | null;
  trainerRate?: number | null;
  noChainTrainer?: boolean;
  additionalClosers?: ReadonlyArray<SerializedProjectParty>;
  additionalSetters?: ReadonlyArray<SerializedProjectParty>;
  // Future (Batch 2): kiloMargin?: number; kiloRevenue?: number;
}

/**
 * Apply role-aware scrubbing to a serialized Project DTO based on the
 * viewer's relationship to that specific project.
 *
 * Behavior is driven by `ProjectFieldVisibility` in lib/fieldVisibility.ts
 * — a declarative matrix of (field × relationship) → action. This function
 * is a thin wrapper that delegates to `applyProjectVisibility` and
 * preserves the original typed signature for existing callers.
 *
 * Why the indirection: before fieldVisibility.ts, this function had ~60
 * lines of imperative switch/delete logic. Every time a new sensitive
 * field was added to the Project model, someone had to remember to
 * scrub it in N branches. The Timothy/Gary/Paul/Brenda bug class traced
 * back to "data is right, imperative scrubber missed a case." The
 * matrix makes that structurally impossible: a field missing from the
 * matrix either passes through (safe for non-sensitive fields) or the
 * characterization test at tests/unit/field-visibility.test.ts fails.
 *
 * Pure function — does not mutate the input. Extra fields on the DTO
 * pass through unchanged; missing fields are skipped.
 */
export function scrubProjectForViewer<T extends ScrubbableProjectDTO>(
  project: T,
  relationship: ProjectRelationship,
): T {
  return applyProjectVisibility(project as unknown as Record<string, unknown>, relationship) as unknown as T;
}
