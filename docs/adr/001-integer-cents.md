# ADR 001 — Integer cents for money

**Date**: 2026-04-15
**Status**: Accepted

## Context

Every commission calculation involves multiplying per-watt rates by
kW × 1000, splitting results 50/50, and allocating remainders by
percentage. Done in float arithmetic, these operations accumulate
floating-point drift. A deal that SHOULD pay exactly $2,376.00 to
the closer might instead persist as $2,376.00000000002 — and when
that number gets summed across multiple projects for a payroll
period, the error compounds.

Precision bugs in money math don't just produce "off by a cent"
artifacts. They produce totals that don't balance: sum of
milestones ≠ stated total, closer half + setter half ≠ above-split,
etc. Users see "the numbers don't add up" and lose trust.

## Decision

All money is stored and manipulated as integer cents. The DB has
`m1AmountCents: Int`, never `m1Amount: Float`. A utility module
(`lib/money.ts`) wraps cents in a `Money` type with explicit
operations (`add`, `sub`, `splitEvenly`, `allocate`) that cannot
produce fractional-cent results.

Conversion happens only at two boundaries:
- **DB → wire**: `serializeProject` divides cents by 100 to produce
  dollar numbers for the client
- **Wire → DB**: `dollarsToCents` does the inverse on incoming body
  values, rounding to the nearest cent

Between those two edges, every operation stays in integer cents.
`splitEvenly(aboveSplit, 2)` guarantees the two halves sum exactly
to the whole. `allocate(remainder, [80, 20])` guarantees M2 + M3
equals remainder exactly.

## Alternatives considered

1. **Decimal.js or similar arbitrary-precision library** — correct
   but heavier. Adds a dep, serialization complexity, type-system
   friction. Integer cents covers 100% of what we need at a
   fraction of the overhead.

2. **Store as float, round on display** — the rejected default.
   Every edit round-trip accumulates error; two displays of the
   "same" number might diverge by a cent after enough edits.

3. **Store as DB DECIMAL type** — Turso/SQLite doesn't have a
   native DECIMAL type with the precision guarantees Postgres
   does. Integer cents gets us the same safety cross-DB.

## Consequences

- Every money field on Prisma models is `Int` with a `Cents` suffix.
- Test invariants assert `m1 + m2 + m3 === total` exactly, no
  tolerance.
- Adding a new money field requires adding the cents column +
  adding to the serializer + adding to the scrubber — three places.
  Mechanical but enforceable.
- Fast-check property tests verify `Money` operations maintain
  invariants across the full input space.
