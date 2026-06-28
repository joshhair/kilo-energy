# Blitz profitability — server-side (the brief's §3 blitz half)

**Goal:** admin-only blitz P&L computed server-side so the native iOS Blitz
Profitability tab renders without on-device cost-basis math. Additive (keep the
existing admin `baselineOverrideJson` passthrough until the web client migrates,
same as the `/api/data` Phase-2a approach). Gate: **admin only, never the blitz
owner** (owners must not reconstruct Kilo margin).

Fully grounded against the code (2026-06-25). Reconciliation is EASY: the client
calls `computeBlitzKiloMargin` (lib/blitzComputed.ts:160) — the server calls the
SAME function with the same inputs → matches by construction.

## Fields to add (integer cents / bps), admin-only

`GET /api/blitzes/[id]` (app/api/blitzes/[id]/route.ts, response at ~:111-145):
- top-level: `kiloMarginCents`, `totalCostsCents`, `netProfitCents`, `roiBps`,
  `costsByCategoryCents` (Record<category, cents>)
- per blitz-project DTO: `kiloMarginCents` (per-deal blitz margin)

`GET /api/blitzes` (list, app/api/blitzes/route.ts, response ~:81-109):
- per-blitz: `kiloMarginCents`, `netProfitCents`, `roiBps` (skip costsByCategory — detail-only)

## Formulas (reuse existing fns; reconcile to client)

- Per-deal blitz margin (lib/blitzComputed.ts:170-178): `(closerPerW − kiloPerW) ×
  kW × 1000 − setterCost`, where `setterCost = 0.10 × kW × 1000` when it's a split
  deal (setter≠closer, or no primary setter but additionalSetters exist), else 0.
  Only counts deals whose closer/additional-closer is an approved participant.
- Aggregate `kiloMargin` = `computeBlitzKiloMargin(blitz.projects, approvedParticipantIds, deps)` (returns DOLLARS → ×100 for cents).
- `totalCosts` = Σ `blitz.costs[].amountCents`.
- `netProfit` = kiloMargin − totalCosts.
- `roiBps` = totalCostsCents > 0 ? round((netProfitCents / totalCostsCents) × 10000) : 0. (client roi = netProfit/totalCosts × 100; bps = ×100 of that. Confirm the iOS DTO expects bps vs a %).
- `costsByCategoryCents` = group `blitz.costs` by `category` summing cents.

## Inputs the server already has / must build

- `approvedParticipantIds`: `new Set(blitz.participants.filter(p => p.joinStatus === 'approved').map(p => p.userId))` — mirrors client page.tsx:268. (The endpoint computes an equivalent at :221 for its visibility query, but that's a different handler scope; recompute in GET.)
- `blitz.projects` (already loaded with closer/setter/additionalClosers/Setters), `blitz.costs` (amountCents).
- `deps = { solarTechProducts, productCatalogProducts, installerPricingVersions }` — NOT loaded today. `getBlitzProjectBaselines` (blitzComputed.ts:116) needs them with `kiloPerW` for non-override deals (override deals resolve from `baselineOverrideJson` and need no deps). ⇒ **load + transform the same kiloPerW-included pricing arrays as `/api/data` (the rollupIPV/rollupSolarTech/rollupPC transforms in lib/data-rollup.ts).** Best move: EXTRACT that pricing-array builder into a shared helper (e.g. `lib/server/pricing-arrays.ts`) and reuse in both `/api/data` and the blitz endpoints — avoids a third copy. Load deps ONLY when `effectiveUser.role === 'admin'` (skip the cost for everyone else).

## Gating

- Compute + attach ONLY when `effectiveUser.role === 'admin'` (honor viewAs).
  NEVER the blitz owner (the costs gate at :83 + the per-project scrub at :131-141
  already keep owners out; the new fields must follow the same admin-only rule).
- Add `kiloMarginCents` / `totalCostsCents` / `netProfitCents` / `roiBps` /
  `costsByCategoryCents` to the `fieldVisibility` matrix as a backstop (like the
  /api/data rollup fields) IF these ever flow through scrubProjectForViewer.

## Verification (same framework)

- Reconciliation test: server `computeBlitzKiloMargin` === client value on fixtures (trivial — same fn).
- Per-project margin reconciles to BlitzProfitability.tsx:135.
- Adversarial + Codex passes: gating (admin-only, never owner, viewAs), no kiloPerW leak, per-deal setterCost edge (self-gen vs split), ROI div-by-zero, costs cents rounding.
- Build local on `feat/server-side-margin`, gated; nothing to prod without Josh's go.

## Status: PLAN ONLY — ready to implement (deferred from the 2026-06-25 mega-session
at extreme context depth; money code, implement fresh).
