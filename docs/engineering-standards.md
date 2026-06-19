# Engineering standards — code organization

The bar: **small, cohesive, single-responsibility files; no mega files; feature
folders.** Netflix-grade — a new engineer should be able to open any file and
understand it without scrolling for ten minutes. This is now part of the
verification framework, not a vibe.

## The enforced gate: `check:file-size`

`scripts/check-file-size.mjs` (wired into `audit:pre-push` and unit-tested via
`tests/unit/file-size-gate.test.ts`) enforces a per-file line budget with the
same **ratchet** pattern as `check:primitives` / `check:sensitivity`:

- **`HARD_MAX` = 800 lines.** A NEW file over this **fails** the gate. Split it
  into cohesive modules — extract components/helpers into a feature folder.
  Adding it to `scripts/file-size.allowlist.json` is a last resort and needs a
  written reason.
- **Legacy files over 800 are allowlisted at their current size and may only
  SHRINK.** They can never grow past their recorded baseline. Every edit must
  leave them the same size or smaller — a forcing function to refactor the
  existing ~38 mega files over time. After a real split, run
  `node scripts/check-file-size.mjs --update` to lock the win.
- **`SOFT_MAX` = 500 lines** is an advisory ("consider splitting") — non-blocking,
  the day-to-day target for most files. Lower `HARD_MAX` toward `SOFT_MAX` as the
  codebase shrinks.

## The pattern to follow

`app/dashboard/settings/sections/pricing/` (the Phase 3 draft-then-publish
editor) is the exemplar:
- `draftPricingReducer.ts` — pure logic/state, no React, no IO (the only place
  the math lives), fully unit-tested.
- `DraftPricingEditor.tsx` / `MobileDraftPricingEditor.tsx` — thin views over the
  reducer; desktop and mobile share the *logic*, not duplicated math.
- `lib/pricing/{validate-version,active-version}.ts` — small, single-purpose,
  reusable, tested.

Contrast with the backlog: `app/dashboard/training/page.tsx` (3,351 lines),
`MobileProjectDetail.tsx` (2,189), `BaselinesSection.tsx` (1,747) — page files
that grew into god-modules. These are baselined and must ratchet down; the
biggest pages should be split page-by-page into feature folders.

## Review dimensions (judgment, not just line count)

`check:file-size` catches size; the human + Codex + adversarial reviews also
check the things a line count can't:
- **Cohesion / single responsibility** — one concern per file/module.
- **No duplication** — shared logic extracted (e.g. a `usePricingPublish` hook
  rather than the publish handler copied desktop↔mobile).
- **No dead/unreachable code** — `eslint` catches unused symbols; reviewers catch
  unreachable-but-referenced branches.
- **Naming + colocation** — feature folders, clear names, tests beside contracts.

Add a "code organization" line to every Codex / adversarial-review prompt so
cleanliness is reviewed alongside correctness, privacy, and regressions.
