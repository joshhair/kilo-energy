# ADR 002 — Server-authoritative commission math

**Date**: 2026-04-18
**Status**: Accepted
**Supersedes**: the client-computes-at-submit model that existed pre-2b

## Context

Originally, the new-deal form computed commission amounts client-
side at deal submission time using `splitCloserSetterPay`, then
POSTed those amounts to the server which stored them verbatim. The
server trusted the client's numbers.

PATCH `/api/projects/[id]` then allowed editing `netPPW`, `kWSize`,
`installer`, `closerId`, `setterId`, etc. — but did NOT recompute
commission. The stored amounts from submission persisted unchanged.

**The Timothy Salunga bug**: a deal was submitted at `netPPW=4.75`,
producing $5,280 closer + $4,752 setter. Later, admin edited netPPW
down to $3.85. Stored amounts stayed at the 4.75 values. Timothy
got paid the wrong amount.

This was not a one-off — ANY deal whose math-inputs were edited
after submission carried stale commission.

## Decision

Commission amounts are computed server-side on every mutation that
could affect them. The server is authoritative; client-supplied
amounts are silently overridden.

- **POST `/api/projects`**: client still sends computed amounts (for
  the preview the user saw), but server recomputes and writes its
  own. Client's view of "what I submitted" matches "what was
  stored" because the formula is deterministic.
- **PATCH `/api/projects/[id]`**: if any field in
  `COMMISSION_INPUT_KEYS` (netPPW, kWSize, installer, productType,
  closerId, setterId, trainerId, trainerRate, baselineOverride,
  additionalClosers, additionalSetters, soldDate) is in the body,
  server recomputes all six commission amounts and overwrites
  whatever the client sent.

Pricing version resolution uses the project's locked
`installerPricingVersionId` or `productPricingVersionId` — historical
deals stay at historical rates. Re-lock happens only on explicit
installer/product/soldDate change.

## Alternatives considered

1. **Client-authoritative, server validation only** — too fragile;
   clients are mutable, servers aren't.

2. **Client optimistic, server recompute on background job** —
   adds latency and a consistency window where stored values lie.

3. **Force every mutation through the new-deal form** — can't
   realistically; admin needs to edit live deals. Migrating to
   "all edits go through the submit flow" is a product regression.

## Consequences

- `lib/commission-server.ts` is the canonical server-side entry
  point. The PATCH route calls `computeProjectCommission(inputs,
  deps)`.
- Every math-input field change triggers a full recompute. Cost is
  a few lookups + pure arithmetic; negligible vs the DB write.
- Client's preview math (via `splitCloserSetterPay`) must stay in
  sync with server's. Both sides call the same `lib/commission.ts`
  function, parameterized differently. If client and server
  diverge, the tests catch it.
- Nightly reconcile cron (`scripts/reconcile-project-commission.mts`)
  compares stored vs computed across the full prod dataset to
  catch drift fast.
