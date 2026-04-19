# ADR 006 — Separate desktop + mobile files, shared logic

**Date**: 2026-04-19
**Status**: Accepted (reaffirmed during A+ planning)

## Context

Every screen in the app has two implementations: a desktop file
(e.g. `app/dashboard/projects/[id]/page.tsx`) and a mobile file
(`app/dashboard/mobile/MobileProjectDetail.tsx`). The desktop file
dispatches to the mobile file via `useMediaQuery` at breakpoint.

During A+ planning, the question came up: should we unify into
responsive components?

## Decision

Keep the parallel-file structure. Share business logic through
hooks (`useApp`) + utility modules (`commissionHelpers.ts`,
`commission.ts`, etc.). Extract VISUAL primitives (StatTile,
CommissionHero, TrainerRow, EmptyState) into a shared responsive
library when there's clear duplication. But page-level layout and
information architecture stay separate.

## Alternatives considered

1. **Fully responsive single component** (the pushed-back option).
   The merger would either (a) collapse one aesthetic onto the
   other, degrading the loser, or (b) require breakpoint-conditional
   rendering within one file that's more complex than the two
   separate files combined. Reviewed and rejected.

2. **Mobile-first with desktop media queries** — possible, but
   inverts the current investment. Desktop is where admin does
   most work; mobile is rep/on-the-go. Different primary use cases
   justify different primary layouts.

3. **Share via render-prop / headless components** — overkill for
   this scale. The logic is already in hooks; the parallel files
   handle pure presentation.

## Consequences

- Every feature change potentially touches two files. The cost is
  real but bounded: ~2× the edit work for UI changes, 0× for
  business-logic changes (shared).
- Mobile screens can be shaped for touch + single-task flows
  without carrying desktop-density baggage.
- Desktop screens can be data-dense without compromising mobile
  readability.
- Shared primitives emerge organically — when the same component
  shape appears in both desktop and mobile, extract it. Over time,
  this naturally moves shared UI into a library.
- The Timothy-class parity bugs (data visible on one side but not
  the other) are prevented not by structural unification but by
  the field-visibility contract (ADR 005) enforcing server-level
  consistency.
