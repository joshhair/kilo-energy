# POST /api/projects authoritative (Phase 3) — ready-to-execute plan

**Goal:** `POST /api/projects` runs `computeProjectCommission` server-side and
persists the SERVER-computed amounts (like PATCH already does), instead of
trusting client-sent `m1Amount`/`m2Amount`/… . Closes a data-integrity hole
(client could POST arbitrary amounts) and makes create consistent with edit.

Fully grounded against the code (2026-06-26). For legitimate form submissions
this is a NO-OP (the new-deal form already computes with the same logic) — it
only changes deals where the client sent amounts that diverge from the server
compute (tampering / client bug).

## Current state

- POST `app/api/projects/route.ts` persists client amounts directly: primary at
  ~:215-220 (`dollarsToCents(body.m1Amount)` …), co-party at ~:188-201. No recompute.
- PATCH `app/api/projects/[id]/route.ts` ALREADY recomputes: deps load+shape
  :298-413, build CommissionInputs :415-469, `computeProjectCommission` call, then
  persist `fromDollars(result.m1Amount).cents` :512-517.

## Step 1 — extract `loadCommissionDeps(prisma, soldDate)` → `CommissionDeps`

Faithful copy of PATCH :298-413 (NOT `buildKiloPricingArrays` — that uses CURRENT
pricing; commission needs SOLD-DATE pricing). Key: `solarTechProducts` (:330-361)
selects the pricing version effective at `soldDate` (effectiveFrom ≤ soldDate ≤
effectiveTo). New `lib/commission-deps.ts`; allowlist in check-sensitivity (it maps
kiloPerW). Refactor PATCH onto it (behavior-preserving; the soldDate it passes is
`body.soldDate ?? current.soldDate`). Verify via typecheck + commission-server tests
+ any PATCH api test.

## Step 2 — wire POST

After FK validation, before `prisma.project.create`:
1. `const deps = await loadCommissionDeps(prisma, body.soldDate);`
2. Build CommissionInputs from `body` (all from body, no `current`): soldDate,
   netPPW, kWSize, installer (name), productType, closerId, setterId, subDealerId,
   solarTechProductId/installerProductId (split by installer==='SolarTech'),
   baselineOverride (parse body.baselineOverrideJson), trainerId, trainerRate,
   noChainTrainer, additionalClosers/Setters (`{m1Amount,m2Amount,m3Amount}`).
3. **Sub-dealer bypass:** if `body.subDealerId`, SKIP recompute and persist the
   client amounts as-is (computeProjectCommission returns zeros for sub-dealers;
   the sub-dealer comp formula lives elsewhere). Mirror PATCH :287-295.
4. Else `const result = computeProjectCommission(inputs, deps);` and persist
   `fromDollars(result.m1Amount).cents` etc. for primary. Co-party amounts: keep
   persisting `body.additionalClosers[].m*Amount` (the server SUBTRACTS their sums
   from the primary inside computeProjectCommission, so the co-party rows stay as
   sent and the primary is the remainder — same as PATCH).

Imports: `computeProjectCommission` (lib/commission-server), `fromDollars` (lib/money).

## Risks / guardrails

- **Sub-dealer:** must bypass (above) — else sub-dealer deals get zeroed.
- **Co-party:** pass body co-parties into inputs; server subtracts. Co-party rows
  persist as sent; primary = remainder. (Confirm the new-deal form already sends
  co-party amounts that sum correctly — it does today since POST trusts them.)
- **Setter-clear regression:** unaffected (that guard is about setterId assignment,
  not amounts) — but run `check:no-silent-rep-clears` anyway.
- **E2E golden test WILL break:** `tests/e2e/golden/deal-lifecycle.test.ts:~77-92`
  POSTs hard-coded amounts (m1=1890.01…) and asserts them. After recompute, persisted
  amounts = server-computed (from netPPW/kW/installer), not the hard-coded values.
  MUST update the test to either (a) send math-inputs that produce the asserted
  amounts, or (b) assert the server-computed amounts. **Cannot be run locally
  (Playwright, needs the app) — needs CI / Josh to validate the update.** This is the
  main reason this unit needs CI in the loop, not just local verify.
- Verify framework: unit/api test for POST recompute (assert server amounts, sub-dealer
  bypass, co-party remainder) + adversarial + Codex, same bar as the rest.

## ⚠ SECURITY REQUIREMENTS — learned from a built-then-reverted first attempt (2026-06-27)

The first build recomputed amounts but MISSED that POST is rep/PM-callable (unlike
PATCH, which gates money-config). Codex found 4 HIGH + 1 MEDIUM. The rebuild MUST
mirror PATCH's `PM_BLOCKED_FIELDS` / `REP_BLOCKED_FIELDS` gating ([id]/route.ts:18-38):

1. **HIGH — admin-only money config.** For NON-admin POST callers, IGNORE
   `baselineOverrideJson`, `noChainTrainer`, `trainerId`, `trainerRate` (treat as
   null/false) BEFORE feeding the recompute + persisting. Else a rep crafts a
   baseline override / suppresses chain trainers / sets a per-project trainer rate
   to inflate the *authoritative* commission. PATCH blocks all of these for PM+rep.
   (PM may be allowed trainerId/trainerRate per the create-schema comment — but
   verify against PATCH; PATCH blocks them for PM too, so POST should match.)
2. **HIGH — wrong-catalog guard.** Port PATCH's `foundInWrongCatalog` logic to POST:
   a non-SolarTech create sending another installer's active `productId` prices by
   product-id without installer scoping → authoritative-but-WRONG amounts. Null the
   product when it's in the wrong catalog before recompute.
3. **HIGH — co-party inflation (PRE-EXISTING, shared with PATCH).** Co-party amounts
   persist from body while the recompute only subtracts them from primary (clamped
   ≥0), so a rep crafts arbitrary co-party pay. This is NOT POST-specific (PATCH has
   it too) — fix it in BOTH (recompute/validate co-party splits server-side) or
   explicitly accept + document. Don't silently inherit it.
4. **MEDIUM — preserve-on-fallback is incomplete.** `result.diagnostics.pricingSource
   !== 'fallback'` misses non-SolarTech catalog misses: resolveBaselines catches a
   product-catalog lookup failure and falls through to `installer-version` (NOT
   `fallback`), so an archived/missing product overwrites client amounts instead of
   preserving them. Detect the product-miss case explicitly (or treat any non-active
   product as preserve).

Also: POST has `user` (requireInternalUser) + `user.role` — `isAdmin = role==='admin'`.
loadCommissionDeps(soldDate) extraction + the PATCH refactor onto it were CLEAN
(Codex didn't flag them) — re-do them, they're behavior-preserving + DRY POST/PATCH.

## Status: PLAN ONLY — built once, REVERTED for the 4 HIGH security gaps above.
## Riskiest money WRITE-path; its e2e golden can't run locally (needs CI). Rebuild
## fresh WITH the security gating from the start, then Codex + CI in the loop.
