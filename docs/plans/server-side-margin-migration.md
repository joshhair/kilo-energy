# Server-side margin/cost-basis migration

**Objective (one line):** the server computes everything derived from `kiloPerW`
(Kilo cost basis) and returns role-gated **integer cents**; clients (PWA + native
iOS) render only what they receive and never touch the rate.

Origin: brief from the iOS-side agent (relayed by Josh, 2026-06-25), verified
against current code by three read-only probes. All cited line numbers below were
confirmed accurate as of branch `codex/feedback-slack-notifications`.

## Addendum specs (folded in 2026-06-25, from the iOS-side agent)

These slot under the brief — same "compute server-side, send the net, scrub the
raw rate" philosophy — but are SEPARATE from the Kilo-margin work:

1. **Deal-detail trainer legs** (admin + internal PM): per project, send
   `trainerLegs: { trainerName, traineeName, traineeRole: 'closer'|'setter',
   projectedPayoutCents }[]`, computed server-side from `computeProjectedTrainerLegs`.
   Today only a bare `trainerId/trainerName/trainerRate` ships (no trainee linkage,
   no amount, no second leg). → folded into the `/api/data` rollup slice (same
   `computeProjectedTrainerLegs` call; route hydrates names).

2. **Trained-rep effective baseline** (gated to the VIEWING REP — their own only,
   NOT admin/PM): server computes, per installer & per product,
   `effectiveCloserPerW` / `effectiveSetterPerW` = standard closer/setter $/W
   **+ the viewing rep's own trainer-override `ratePerW`**, resolved at their
   CURRENT tier. Mirror of the client math at `calculator/page.tsx:508-509`
   (`closerBaselineDisplay`/`setterBaselineDisplay` via `getTrainerOverrideRate`);
   standard rates at `app/api/data/route.ts:536-571` + product baselines `:573-652`,
   raw override at `trainerAssignments[].tiers[].ratePerW :508-511`. Once shipped,
   stop sending raw `ratePerW` to the device (the scrub). Clients render the net.
   - **Also:** send server-computed `consumedDeals` per `trainerAssignments[]`
     entry (gated to the viewing rep's own assignment) so current-tier resolution
     is exact — the native DTO has `consumedDeals` wired but the server doesn't send
     it, so tiered assignments fall back to tier 1.
   - This is its OWN unit (different field/gating than the margin rollup); implement
     after the margin `/api/data` wiring. Reconcile to `getTrainerOverrideRate` to
     the cent, same approach as the margin reconciliation.

Reference implementation to mirror everywhere: `GET /api/reps/[id]/commission-by-role`
(server-computed cents grouped by role, no rates/baseline/margin on the wire,
admin + internal-PM only on the **effective** user, honors `viewAs`).

---

## 1. The dividing line (confidential vs OK-on-client)

- **OK on client:** a rep's OWN commission (their closer/setter/co-party/trainer
  split on a deal they're a party to). `closerPerW`/`setterPerW` are published
  rate-card numbers visible to all roles.
- **Must move server-side:** anything derived from `kiloPerW` — Kilo margin,
  blitz net profit/ROI, the Total / Rep / Kilo-Margin rollup, and the cost-basis
  tables themselves.
- **Dividing test:** if the computation needs `kiloPerW`, the server does it and
  returns only the resulting dollars (cents).
- **The one genuine exception:** the **sub-dealer** keeps raw `kiloPerW` on their
  own forecast tiers (they're computing their own `subDealerPerW − kiloPerW`
  margin, which is legitimately theirs). Everything else derived from `kiloPerW`
  goes server-side. Encoded today by `canViewKiloOnBaselineTier` (admin +
  sub-dealer) — keep as-is.

Two margin formulas, do not conflate:
- **Blitz margin (per deal):** `(closerPerW − kiloPerW) × kW × 1000 − setterCost`,
  `setterCost = $0.10/W` on split deals. (`computeBlitzKiloMargin`,
  `lib/blitzComputed.ts:160–179`.)
- **Project-detail margin:** `gross = (netPPW − kiloPerW) × kW × 1000`;
  `repTotal = sum of rep payouts`; `margin = gross − repTotal` (derived by
  subtraction so the three reconcile to the cent).

---

## 2. API contract (the keystone — iOS codes against this)

All fields **integer cents** (or bps), gated on the **effective** user (admin
impersonating a rep via `viewAs` gets NONE), mirroring `commission-by-role`.

| Endpoint | New fields | Gate |
|---|---|---|
| `GET /api/blitzes/[id]` | top-level `kiloMarginCents`, `totalCostsCents`, `netProfitCents`, `roiBps`, `costsByCategoryCents`; per blitz-project DTO `kiloMarginCents` | **admin only** — never blitz owner |
| `GET /api/blitzes` (list) | per-blitz `kiloMarginCents`, `totalCostsCents`, `netProfitCents`, `roiBps`, per-project `kiloMarginCents` | **admin only** |
| `GET /api/data` | per-project `totalCommissionGrossCents`, `kiloMarginCents` (= gross − rep) | **admin + internal PM** |
| `POST`/`PATCH /api/projects[/id]` | returned `totalCommissionGrossCents`, `kiloMarginCents`; **POST becomes authoritative** | **admin + internal PM** |
| `POST /api/blitzes/[id]/costs` | unchanged (write stays admin-only); aggregation moves to the blitz GETs | admin only |
| `GET /api/reps/[id]/commission-by-role` | unchanged — reference shape | admin + internal PM |

Gross is sent **in addition to** margin so the iOS Total / Rep / Kilo-Margin
rollup reconciles (`gross = rep + margin`). Treat internal PM as admin-equivalent
for the new fields per the existing `fieldVisibility` matrix.

---

## 3. Verified current-state gaps to close

1. **`computeProjectCommission` (`lib/commission-server.ts:203`)** returns
   milestone amounts + `diagnostics.kiloPerW` (:99/:265) but NOT gross /
   repTotal / margin. → extend its output (or a thin wrapper) to emit
   `totalCommissionGrossCents` and `kiloMarginCents`. `resolveBaselines`
   (`:109–164`) is **private** — export it (or a higher-level helper) so the
   blitz + data GETs resolve `kiloPerW` through the same path (client/server
   must agree to the cent).
2. **`POST /api/projects` (`route.ts:190–201, 215–220`)** persists client-sent
   amounts directly (`dollarsToCents(body.m1Amount)` …) and never calls
   `computeProjectCommission`. PATCH already recomputes (`[id]/route.ts:450`,
   overrides at `:512–517`). → make POST authoritative.
3. **Cost-basis tables ship in the bundle** — `lib/data.ts` `BASELINE_RATES`
   (:843), `NON_SOLARTECH_BASELINES` (:1359), `INSTALLER_PRICING_VERSIONS`
   (:1382), `SOLARTECH_PRODUCTS` (:967); `getBaselineRate()` (:904) /
   `getNonSolarTechBaseline()` (:1374) hand `kiloPerW` to any caller. Imported
   by `'use client'` pages. → move pricing/baseline resolution behind a
   server-only boundary; clients receive only `closerPerW`/`setterPerW` (or the
   final commission).
4. **`fieldVisibility.ts` gates by field name** — the `kiloMargin` row (:97–105)
   strips for vendor_pm/closer/setter/trainer/sub-dealer/blitz_owner/none and
   passes to admin+pm (applier :170–172). → the NEW `kiloMarginCents` /
   `totalCommissionGrossCents` field names must be ADDED to the matrix or they
   won't be stripped.
5. **Client engine `lib/commission.ts`** (`calculateCommission` :323,
   `splitCloserSetterPay` :337) ships via `MobileNewDeal.tsx` +
   `admin/commission-playground/page.tsx`. Own-split invocations are fine; the
   `kiloPerW` invocations that derive kilo total/margin are the confidential part.

---

## 4. Sequenced phases (lowest risk first)

**Phase 1 — Server-only pricing boundary + shared compute (no schema change).**
- Add `import 'server-only'` guard so a client import of the cost-basis tables /
  resolver fails the build.
- Export the shared baseline resolver + extend `computeProjectCommission` to
  return `totalCommissionGrossCents` + `kiloMarginCents`.
- No behavior change yet; purely additive server plumbing.

**Phase 2 — Read-path leak fixes (additive + scrub-tightening; compute-on-read).**
- `GET /api/data`: add per-project `totalCommissionGrossCents` + `kiloMarginCents`
  (admin + internal PM) via the shared path; keep tier `kiloPerW` behind
  `canViewKiloOnBaselineTier` (admin + sub-dealer) and keep stripping
  `baselineOverride.kiloPerW` for non-admins (:413).
- `GET /api/blitzes/[id]` + `GET /api/blitzes`: add the admin-only rollups +
  per-project `kiloMarginCents`; **STOP the raw `baselineOverrideJson` admin
  passthrough** (blitz detail ~:124–143, list ~:93–104) once margin is
  pre-multiplied.
- Add the new field names to the `fieldVisibility` matrix (item 3.4).
- Update clients (Calculator, CommissionPreview, BlitzProfitability ×2,
  CommissionBreakdownAdmin) to read server cents and stop resolving `kiloPerW`.

**Phase 3 — POST authoritative (behavioral; highest risk).**
- `POST /api/projects` runs `computeProjectCommission` server-side and stops
  trusting client-sent amounts; returns gross + margin cents.
- ⚠️ Touches deal submission — exercise the full commission test suite + watch
  the setter-on-deal regression guard (`check:no-silent-rep-clears`). This is the
  bonus data-integrity fix (POST currently persists whatever the client sends).

**Phase 4 — Remove the formula/tables from the client bundle + guardrail.**
- Strip the confidential `kiloPerW` invocations from `lib/commission.ts` client
  paths; verify devtools/network on a **rep** session shows no `kiloPerW`,
  no cost-basis tables, no margin formula.
- Add a guardrail test (mirror the privacy-gate prober): fail CI if a
  `kiloPerW`-bearing symbol or cost-basis table is reachable from any
  `'use client'` module.

**Phase 5 (optional) — Persist columns.** Only if blitz list performance or
queryability demands it: add `totalCommissionGrossCents` + `kiloMarginCents`
columns to `Project` and write them on POST + every PATCH recompute. Requires a
**prod Turso migration** via `scripts/migrate-*.mjs` + the dry-run gauntlet
(`docs/runbooks/migrations.md`) + Josh's explicit go. Deferred by default —
compute-on-read (Phases 2–3) closes the security leak with zero migration risk.

---

## 5. Definition of done (from brief)

- [ ] No `kiloPerW` / cost-basis tables / margin formula in the shipped client
      bundle (verify on a rep session — not just a hidden UI row).
- [ ] `GET /api/blitzes/[id]` + `GET /api/blitzes` return admin-only
      `kiloMarginCents`, `totalCostsCents`, `netProfitCents`, `roiBps`,
      `costsByCategoryCents`, per-project `kiloMarginCents`; non-admins (incl.
      blitz owners) get none.
- [ ] `GET /api/data` returns admin-(+ internal-PM-)only per-project
      `totalCommissionGrossCents` + `kiloMarginCents`; raw
      `baselineOverride.kiloPerW` stays admin-only; tier `kiloPerW` stays
      admin + sub-dealer only.
- [ ] `POST`/`PATCH /api/projects[/id]` compute + return gross + margin cents;
      POST is authoritative (runs `computeProjectCommission`).
- [ ] All new fields are integer cents, gated on the effective user (admin
      impersonating a rep gets none), mirroring `commission-by-role`.
- [ ] Reps' OWN commission still renders (own split, `closerPerW`/`setterPerW`);
      sub-dealer self-forecast still works.
- [ ] Server and client agree to the cent; spot-check deals — rollup reconciles
      (`gross = rep + margin`) vs old client numbers.
- [ ] iOS confirms the three held surfaces light up (Blitz Profitability, deal
      Total/Rep/Kilo-Margin rollup, projected trainer $).

---

## 6. Out of scope (flagged in §4 of the brief, NOT part of this margin-move)

Training "Lifetime Paid"/"Avg Rate" tiles; reimbursement `receiptUrl`/`repId`;
own phone/email on `/api/auth/me`; M3 nullable zero-out on PATCH amount edits;
the 3 PM permission flags; `repType` on curated View-As candidates.

---

## 7. Guardrails / rollout

- Built **locally on a branch**, behind `npm run audit:pre-push` (measure twice).
- **Nothing to live prod without Josh's explicit per-push approval.** Any schema
  migration (Phase 5) additionally goes through the migration runbook + Josh.
- This is money + privacy core — the most sensitive code in the app. Each phase
  is independently shippable and reviewable.
