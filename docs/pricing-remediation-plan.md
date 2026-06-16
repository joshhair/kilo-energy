# Pricing remediation + flawless editor rework

Status: APPROVED by Josh 2026-06-15. Reviewed twice by Jarvis + Codex (Codex
confirmed the dependency ordering is sound; its five tightenings are folded in).
LIVE production app — every prod mutation and every push to `main` stops for
Josh's explicit per-action go.

## Background (the incident)
The SolarTech / Product-Catalog pricing editor writes tier rates LIVE on every
`onChange` — each keystroke PATCHes `/api/products/[id]`, which closes the active
`ProductPricingVersion` and creates a new one effective *today*. One editing
session created 22 versions for the Enfin "Q.TRON ... w/PW3" product in ~3 min,
19 degenerate (`effectiveFrom == effectiveTo == 2026-06-16`), capturing rates
typed digit-by-digit. The intended new (lower) rates landed in a 06-16 version;
the version covering an already-sold 06-09 deal (Cheri Childress) kept the OLD
rates; her commission is frozen from submit (06-13) and never recomputed.

Direction confirmed: tier rates are the BASELINE; rep commission is the SPREAD
above it, so LOWERING the baseline INCREASES commission. Affected deals are
UNDER-paid → corrections are TOP-UPS, never clawbacks.

## Verification framework (every phase)
read-only dry-run → Codex PROPOSAL review → implement → measure-twice
(`audit:pre-push` ×2; husky re-runs on push) → Codex DIFF review → Josh's
explicit go. Prod data mutations: frozen IDs + IN-TRANSACTION FK-reference
asserts (FKs are ON DELETE SET NULL — they will NOT block, we assert ourselves)
+ exact rowsAffected asserts + AuditLog row + exported before-state rollback
JSON + post-write verify + rollback on mismatch. UI work also gets a
design/visual-baseline gate.

## Phase 0 — Real safety net (decision-free) ← START HERE
Make BOTH `scripts/backup-turso.mjs` and `scripts/restore-turso.mjs`
schema-complete (they cover ~25 of 42 Prisma models — missing AuditLog,
ProjectCloser, ProjectSetter, Feedback, BlitzAnnouncement, ChatMessageReaction,
DataAccessLog, EmailDelivery, Notification*, Project*Note,
ProjectFile/SurveyLink/InstallerNote, PushSubscription, StalledAlertConfig).
Restore list must stay in FK-dependency order. Then take the full backup and
confirm row counts for all 42 tables. Only now is anything reversible.

## Phase 1 — Stop the bleeding + fake installers (decision-free)
- Server guard: `PATCH /api/products/[id]` must not close+create a pricing
  version per tier write; freeze the inline grid until the rework ships.
- Delete the 3 active `PricingInst-*` installers — assert zero refs across
  `Project.installerId / installerPricingVersionId / productId /
  productPricingVersionId` AND `EmailDelivery.installerId` first. AuditLog +
  rollback JSON. Extend cleanup patterns (PricingInst/CatalogInst/UniqueInst).

## Phase 2 — Revert Enfin pricing to pre-keystroke state (decision-free)
Script (not the UI): assert none of tonight's 21 versions are referenced by any
`Project.productPricingVersionId`; delete them (+ tiers via cascade); restore v1
to active — only after the before-state export PROVES v1's `effectiveTo` was null
and its tiers are unchanged (restore those too if a bulk-adjust hit v1 in place).
Transactional, audited, post-verify (exactly one active Enfin version = v1).

## Phase 3 — Flawless reworked editor (centerpiece; phased, dual-gated + design-reviewed)
- 3.1 Draft-then-publish core: tier edits are local draft state (no API on
  onChange); one Publish = exactly one version per product, transactional,
  idempotency key; replace `parseFloat||0`.
- 3.2 Validation (server + app; partial unique indexes over DB triggers
  initially): reject zero-width/overlap/duplicate `[productId, effectiveFrom]`
  windows, rates ≤ 0, `closer ≤ kilo`, malformed dates; explicit retroactive flow.
- 3.3 Confirmation + impact preview: old→new diff + "effective DATE; applies to
  deals sold DATE→day-before-next; N submitted deals frozen, won't auto-recalc."
- 3.4 Design/polish pass: reuse SegmentedPills, PrimaryButton/SecondaryButton/
  IconButton, ConfirmDialog, card-surface, table-header-frost, existing
  modal/fade motion tokens; dirty-cell highlight, deltas, Reset/Discard/Publish;
  new desktop+mobile visual baselines. Must feel flawless + on-brand.
- 3.5 Frozen-version doctrine: recompute HONORS the stored productPricingVersionId
  unless an EXPLICIT recalc relinks it — never implicit.
- 3.6 Explicit "recalculate affected deals" action: cohort preview by
  soldDate/version/payroll-stage status; recompute on command.

## Phase 4 — Josh re-enters correct Enfin pricing via the new tool (Josh's action)

## Phase 5 — Top-up the affected cohort (money; all increases)
Classify by project-rep-STAGE (a deal can be M1 Paid / M2 Draft): recompute
Draft/Pending rows; for already-Paid stages create ONE deterministic top-up
`PayrollEntry` for the delta (subtract prior pays + prior top-ups sharing the
correction key — no double-pay). NOT the paid-correction endpoint (no money
flow). Cohort, not one-off Cheri. Dry-run → Codex → Josh go → verify payroll/MyPay.

## Sequencing
0 → 1 → 2 decision-free, run first. 3 is the main build. Then Josh re-prices (4),
then cohort top-up (5).
