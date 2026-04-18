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
  additionalClosers?: ReadonlyArray<SerializedProjectParty>;
  additionalSetters?: ReadonlyArray<SerializedProjectParty>;
  // Future (Batch 2): kiloMargin?: number; kiloRevenue?: number;
}

const ZEROED_PARTY = (p: SerializedProjectParty): SerializedProjectParty => ({
  ...p,
  m1Amount: 0,
  m2Amount: 0,
  m3Amount: null,
});

/**
 * Apply role-aware scrubbing to a serialized Project DTO based on the
 * viewer's relationship to that specific project. Enforces:
 *
 *   - admin / pm  → full visibility (passthrough)
 *   - closer      → own breakdown visible; co-setter amounts zeroed (sum
 *                   still derivable from primary setterM1/M2/M3 on the
 *                   top level, which the closer IS allowed to see as a
 *                   total). Trainer assignment hidden.
 *   - setter      → own setter amounts visible; closer amounts and co-closer
 *                   amounts zeroed; trainer hidden.
 *   - trainer     → trainer fields preserved; closer + setter amounts zeroed.
 *   - sub-dealer  → passthrough (sub-dealers see their own deals as primary
 *                   closer; distinct commission path).
 *   - none        → defense in depth, everything zeroed (shouldn't reach
 *                   here if query filters are correct).
 *
 * Also strips `kiloPerW` from any `baselineOverride` for non-admin/pm.
 *
 * Pure function — does not mutate the input. Extra fields on the DTO pass
 * through unchanged; missing fields are skipped.
 */
export function scrubProjectForViewer<T extends ScrubbableProjectDTO>(
  project: T,
  relationship: ProjectRelationship,
): T {
  if (relationship === 'admin' || relationship === 'pm') {
    return project;
  }

  const scrubbed: T = { ...project };

  // Trainer assignment on a project is admin pay-config, not rep-facing.
  // Hide for any non-admin/pm viewer regardless of relationship.
  if ('trainerId' in scrubbed) scrubbed.trainerId = undefined;
  if ('trainerName' in scrubbed) scrubbed.trainerName = undefined;
  if ('trainerRate' in scrubbed) scrubbed.trainerRate = undefined;

  // baselineOverride.kiloPerW is installer wholesale — reps never see it.
  if (scrubbed.baselineOverride && typeof scrubbed.baselineOverride === 'object') {
    const bo = { ...(scrubbed.baselineOverride as Record<string, unknown>) };
    delete bo.kiloPerW;
    scrubbed.baselineOverride = bo;
  }

  switch (relationship) {
    case 'closer': {
      // Closer sees own breakdown + setter TOTAL (the top-level setterM1/M2/M3
      // stay visible so the client can sum them). Co-setter amounts zeroed.
      if (scrubbed.additionalSetters) {
        scrubbed.additionalSetters = scrubbed.additionalSetters.map(ZEROED_PARTY);
      }
      return scrubbed;
    }
    case 'setter': {
      // Setter sees own setter amounts only. Zero closer amounts and hide
      // co-closer structure; zero co-setter amounts (other setters).
      scrubbed.m1Amount = 0;
      scrubbed.m2Amount = 0;
      scrubbed.m3Amount = null;
      scrubbed.additionalClosers = [];
      if (scrubbed.additionalSetters) {
        scrubbed.additionalSetters = scrubbed.additionalSetters.map(ZEROED_PARTY);
      }
      return scrubbed;
    }
    case 'trainer': {
      // Trainer-on-project: trainer fields preserved above (for admin viewing
      // trainer info). A rep who is the project's trainer should see the
      // trainer rate only, not closer/setter commission.
      scrubbed.m1Amount = 0;
      scrubbed.m2Amount = 0;
      scrubbed.m3Amount = null;
      scrubbed.setterM1Amount = 0;
      scrubbed.setterM2Amount = 0;
      scrubbed.setterM3Amount = null;
      scrubbed.additionalClosers = [];
      scrubbed.additionalSetters = [];
      return scrubbed;
    }
    case 'sub-dealer': {
      // Sub-dealers have their own commission path (subDealerPerW) and see
      // their deals as primary. Passthrough — no scrubbing required beyond
      // the trainer + baseline kiloPerW already stripped above.
      return scrubbed;
    }
    case 'none':
    default: {
      // Defense in depth: if a rep somehow got a project they're not on in
      // their response set (blitz view of other reps' deals), strip all
      // financials.
      scrubbed.netPPW = 0;
      scrubbed.m1Amount = 0;
      scrubbed.m2Amount = 0;
      scrubbed.m3Amount = null;
      scrubbed.setterM1Amount = 0;
      scrubbed.setterM2Amount = 0;
      scrubbed.setterM3Amount = null;
      scrubbed.additionalClosers = [];
      scrubbed.additionalSetters = [];
      return scrubbed;
    }
  }
}
