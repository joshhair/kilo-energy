# Verification Plan — `feat/blitz-engagement-and-dashboard` → `main`

**Status**: Draft, awaiting Josh's approval before any phase executes.
**Branch state**: 20+ commits ahead of `main`, all local, nothing pushed.
**Production constraint**: live data on Turso; Clerk `pk_live_*` domain-locked → Vercel previews cannot complete auth; pre-launch app `kilo-energy.vercel.app` is the only realistic test target outside local.
**Hard rule**: zero touches to `app.kiloenergies.com` (legacy live) and no production DB writes.

---

## 0. Change Inventory by Risk Tier

### Tier 1 — HIGH (math + data shape; reversible only by revert)

| Commit | What changed | Why it's risky |
|---|---|---|
| `dca5619` | New on-pace formula `commissionEarnedFromInPeriodDeals + paceRate × monthsRemainingInP` | Every rep sees this hero number; algorithm has never been in production |
| `0585f90` | Unified `rate × periodMonths + phase-weighted M1/M2/M3 boost`; dropped `0.15` outer factor; introduced M3 multiplier tables | The boost helper signature changed and M3 was newly included — downstream tests will break |
| `e24b487` `c6760e1` `444fe94` | Breakdown UI rewrites that depend on the new formula's component split | Coupling between math + UI; bugs in math show up as nonsense text |

### Tier 2 — MEDIUM (token / UX changes; one-line revert each)

| Commit | What changed | Why it's risky |
|---|---|---|
| `a2728b6` | Dark-mode emerald tokens (`--accent-emerald-solid/-text/-display`) → `#10b981` | Cascades to every solid emerald CTA in dark mode |
| `b99fdae` | Light-mode emerald tokens → `#009868` / `#007355`; SegmentedPills primitive; FAB pattern; halo/glow removal across 100+ files | Largest surface-area diff; visual regressions easy to miss |
| `cb0e18a` `de67665` | Blitz hero card restructure (Upcoming as headline, 2×2 sub-stat grid, compact-formatted Costs) | New card pattern; layout regressions possible on edge widths |
| `1f27cd1` `8efeb1d` | Admin Revenue card cyan/emerald color split + "Paid to Reps" → "Paid Out" rename | Label rename is a UX change reps may notice |
| `cd653fc` | Hide Next Payout when $0; "Welcome" empty state when on-pace + payout both 0 | New conditional rendering paths |
| `8a75687` | New Deal CTAs: emerald-text fill + white text | Affects deal-creation flow — must remain tappable and discoverable |

### Tier 3 — LOW (mechanical, isolated)

- BlitzEarningsForecast hidden on completed/cancelled (in `b99fdae`)
- Per-blitz pending-join chip (`a2728b6`)
- Trainer-projection import fix (`eed7f9b`)
- Date input `min-w-0` on Payroll filter (`82f4d14`)
- Hero breakdown text/layout refinements (`e24b487`, `c6760e1`, `444fe94`)

---

## 0.5 Prod-Read Infrastructure (NEW — replaces "open question #1")

**Decision**: Josh has granted read access to production data (Turso). All phases that need prod data will route through a single, audited helper. No phase touches Turso directly.

### 0.5.1 Read-only guarantees (enforced in code, not by convention)

A helper module at `scripts/prod-read/index.mts`:

```ts
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ datasources: { db: { url: process.env.TURSO_DATABASE_URL } } });

// Whitelist of allowed Prisma methods.
const ALLOWED = new Set(['findFirst', 'findMany', 'findUnique', 'count', 'aggregate', 'groupBy']);

// Wrapper that asserts a query method is allowed before executing.
// Any attempt to call create/update/delete/upsert/executeRaw throws
// before hitting the wire.
function safe<T extends keyof typeof db>(model: T, op: string) { ... }
```

Plus a defensive belt: when this script loads, it monkey-patches the Prisma client to throw on every mutating method by name. Cannot be bypassed without editing the helper itself.

### 0.5.2 Named query functions, not raw SQL

Every query the verification phases need is exposed as a named function in `scripts/prod-read/queries.mts`. Nothing accepts arbitrary SQL strings. Examples:

- `getRepPipeline(repId)` → array of in-flight projects with phase, soldDate, m1/m2/m3 amounts (role-aware via additionalClosers/Setters)
- `getRepPaidHistory(repId, sinceDate)` → payroll entries net of chargebacks
- `getBlitzSummary(blitzId)` → participants (with joinStatus), costs, attributed projects
- `getRepsOverview()` → name + activeFlag + dealCount per rep, for the "view-as a real other rep" smoke step
- `countOpenIssues()` → Sentry-style health snapshot

We add functions only when a phase needs them. No fishing expeditions.

### 0.5.3 Snapshot-then-verify pattern

Each query result is **written to a local gitignored file** (`tmp/prod-snapshots/<query>-<timestamp>.json`) on its first run. Subsequent verification scripts load from the snapshot. This means:

- Each prod query runs **at most once per verification cycle**
- If we need to re-check, we re-run the snapshot explicitly (visible, intentional)
- Snapshots are inspectable, diff-able, and shareable in PR review
- A network outage mid-verification doesn't force a re-query

### 0.5.4 Audit log

Every query writes a one-line entry to `tmp/prod-read.log` (gitignored): timestamp, function name, args, row count. After the rollout, this log is the evidence that we only read what we said we'd read.

### 0.5.5 Credential handling

`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` loaded from `.env.local` via `dotenv`. The helper script:
- Never prints either value
- Throws if either is missing (prevents accidental local-DB hit)
- Refuses to run if `NODE_ENV === 'production'` (defense against running this helper inside a deployed environment)

### 0.5.6 Stop conditions

Halt prod reads and flag for review if:
- Any unexpected error from Turso (connection refused, auth failed, rate-limited)
- A snapshot return shape doesn't match the expected Prisma type
- A query returns 0 rows when ≥1 was expected (e.g. Josh's rep record missing)

**Risk gate**: every named query is reviewed once before its first run. If a new query is needed mid-verification, it gets added to `queries.mts` with a comment explaining what phase needs it, then reviewed before run.

---

## 1. Pre-flight (Phase 0)

**Goal**: ensure the working tree is in a known state and the autonomous loop stays off.

1. **Confirm agent loop is dead** — ✓ 2026-05-16: no `start.sh` process running.
2. **Snapshot current branch head** — `82f4d14e3ff786f013e9e95a1a048514c961ac78` (before verification-plan commit); `557c587` after committing this doc.
3. **Backup branch** — ✓ `backup/pre-verify-2026-05-16` created from `82f4d14`.
4. **Document divergence** — 25 commits ahead of `origin/main`: 5 pre-existing blitz Phase 2 commits (`7db76d1` → `24bae3b`), 17 polish + math commits from this session (`b99fdae` → `82f4d14`), plus the verification-plan commit (`557c587`).

**Note on scope**: this PR is NOT just my polish — it ships the entire blitz engagement Phase 2 feature (RSVP+waitlist, T-7/3/1/0 reminders, broadcast, Web Push, earnings forecast slider) plus the polish + math overhaul on top. Both should be tested together since they're merging together.

**Risk gate**: do not proceed if uncommitted changes exist; commit or stash first. Do not proceed if any process is currently running `npm run dev` against the branch in another shell (could cause weird HMR state).

---

## 2. Test Repair (Phase 1)

**Goal**: green unit tests reflecting the NEW formula. CI gate #1 (test) won't pass until this is done.

### 2.1 Audit broken tests

Run `npm test` against current branch. Capture all failures. Expected failures:

- `tests/unit/period-projection.test.ts` — references `computePeriodProjection` and the old `pipelineBoostAnnual` shape; helper signature changed
- `tests/unit/phase-weighted-boost.test.ts` — pre-dates M3 addition and the 0.15-factor removal
- Possibly others if any imports of `computePeriodProjection` exist outside MobileDashboard

### 2.2 Decide: update or delete

- `period-projection.test.ts` — **DELETE the file**. The function it tests (`computePeriodProjection`) is no longer called by any consumer. We removed its only caller (MobileDashboard) when we adopted the unified formula. Keeping orphaned tests around is worse than deleting.
- `phase-weighted-boost.test.ts` — **REWRITE**. The helper still exists (we updated its signature for M3). Tests need new fixtures covering:
  - M1-only boost for "New" deals
  - M2 boost across all pre-Install phases at 30/90/365 horizons
  - M3 boost for post-Install (Installed, PTO) phases
  - Exclusion of Cancelled / On Hold / Completed
  - Zero result when no `repId` passed

### 2.3 Add tests for the new formula

Create `tests/unit/on-pace-projection.test.ts` covering the four scenarios we walked through:
- New rep, 30d, 1 deal in Acceptance, $14.9K deal
- Strong new rep, 60d, 10 deals 5/mo × $8K
- Veteran, 2yr, 6/mo × $5K, $350K pipeline
- October starter, end-of-October, 1 deal

Each scenario should verify all four periods (This Month / Quarter / Year / All Time) and the components (commissionEarnedFromInPeriodDeals + paceRate × monthsRemaining).

### 2.4 Run all unit tests

`npm test` until green. Document pass count (should be ~800+ per the `4cb0d09` commit message baseline + our changes).

**Risk gate**: do NOT proceed to Phase 2 if any unit test is red. A red test means either the math is wrong OR the tests are wrong — either way it's a stop-the-line signal.

---

## 3. CI Gate Verification (Phase 2)

**Goal**: confirm the four CI gates pass locally before push.

### 3.1 Type check

`npx tsc --noEmit 2>&1 | tee typecheck.log`

- Expected: 0 errors. We removed several imports during the math overhaul (`computePeriodProjection`, `getPeriodDaysRemaining` re-added, `sumGrossPaid` dropped) — verify nothing dangles.

### 3.2 Lint

`npm run lint 2>&1 | tee lint.log`

- Expected: 0 errors, warnings acceptable.
- Watch for unused variables left over from the refactor (we underscored some, deleted others).

### 3.3 Audit-coverage gate

Per `project_kilo_consistency_infra.md`: every mutating `/api` route must call `logChange` or be allowlisted. We changed zero API routes this session, so this should pass without action.

`node scripts/check-audit-coverage.mjs` (or whatever the gate script is named — confirm path).

### 3.4 Primitive-usage allowlist

Per `scripts/primitive-usage.allowlist.json`. We added the per-blitz pending chip (a `<span>`, not a `<button>`, so counted as raw text, not raw button) — should not affect counts. Verify.

`node scripts/check-primitive-usage.mjs` (or equivalent).

**Risk gate**: any RED gate is a hard stop. Investigate root cause, fix, rerun all gates from the top.

---

## 4. Math Sanity Check with Real Data (Phase 3)

**Goal**: prove the new on-pace formula produces sensible numbers against representative live data.

### 4.1 Data sources

Use `scripts/prod-read/queries.mts` (see §0.5):
- `getRepPipeline(joshRepId)` → real phase + commission distribution for the headline case
- `getRepPipeline(<2-3 other rep IDs>)` → cross-check across rep tiers (new, mid, veteran)
- `getRepPaidHistory(...)` → paid-to-date inputs for each scenario
- Plus synthetic data for the October-starter edge case (no prod data fits — fabricated by design)

Snapshots saved to `tmp/prod-snapshots/` so re-running is offline.

### 4.2 Build the sanity script

`scripts/verify-on-pace-math.mts` (one-shot, not checked in long-term):
- Takes a pipeline array + payroll-paid array as JSON input
- Computes the new formula for each period
- Outputs a table: paid + pace × months = total, per period
- Compares against expected magnitudes

### 4.3 Run the four scenarios

| Scenario | Expected This Year | Acceptable range | Actual (2026-05-17) |
|---|---|---|---|
| New rep, 1 × $14.9K at 30d | ~$127K | $100K – $150K | unit test ✓ ($127K) |
| Strong new, 5/mo × $8K at 60d | ~$380K | $320K – $440K | unit test ✓ |
| Veteran, 6/mo × $5K, $350K pipeline | ~$360K | $300K – $420K | unit test ✓ |
| October starter, 1 × $14.9K at end-of-Oct | ~$45K | $35K – $60K | unit test ✓ |

### 4.4 Real prod data verification

Ran `scripts/prod-read/verify-on-pace.mts` against real Turso (read-only, 9 logged queries). Results:

| Rep | Tenure | dealsPerMonth | avg commission | This Year OnPace |
|---|---|---|---|---|
| Josh Hair (target) | 1131d (~3yr) | 3.90 | $7,870 | **$289,230** |
| Alex Villanueva (mid) | 458d (~15mo) | 0.27 | $10,092 | $20,096 |

Josh's number reconciles: $30,713/mo earning rate × 7.5mo remaining ≈ $230K forward + $59K earned in 2026 deals = $289K. All Time matches This Year identically (same formula, same calendar horizon). Pace × period scales linearly across This Month → Quarter → Year as designed. Alex's low number is honest — 4 deals total, all Completed, no recent activity → small projection. No formula bugs found.

**Risk gate**: ✓ PASSED. Math reconciles with intent; ready to proceed to visual verification.

---

## 5. Visual Regression (Phase 4)

**Goal**: catch any unintended visual regressions across the 100+ modified surfaces.

### 5.1 Re-baseline Playwright snapshots

The existing baselines (committed in `18d3e00`) predate our polish work — every screenshot will diff. That's expected. Process:

1. Delete the existing baseline directory (snapshots are stored under `tests/visual/__snapshots__/` or similar — confirm path).
2. Run the suite in update mode: `npx playwright test --update-snapshots tests/visual/`.
3. Commit the new baselines on a separate "re-baseline" commit so reviewers can see all visual changes at once.
4. Run the suite again WITHOUT update mode to confirm zero diff.

### 5.2 Cross-browser / cross-theme

If the Playwright config covers light + dark + multiple viewports, ensure every combination is regenerated. If it only covers one theme, add a second pass.

**Risk gate**: review each re-baselined screenshot visually before committing. Any screenshot that looks WRONG (overflow, missing element, weird color) is a defect — don't normalize bugs into baselines.

---

## 6. Manual Smoke Matrix (Phase 5)

**Goal**: walk every modified surface under realistic conditions and confirm UX is intact.

### 6.1 Surfaces × dimensions

| Surface | Periods | Themes | Roles | Notes |
|---|---|---|---|---|
| Rep dashboard | 4 (Month/Qtr/Year/All) | Light + Dark | Rep + Admin (view-as) | Hero, breakdown, stat tiles, sparkline |
| Admin dashboard | 4 | Light + Dark | Admin | Revenue card (cyan + emerald + Paid Out label) |
| Blitz list | 5 status filters | Light + Dark | Admin, Owner, Joiner, Pending | Pending chip, hero card sub-stats |
| Blitz detail — overview | upcoming/active/completed | Light + Dark | Admin, Owner | BlitzEarningsForecast hidden when completed |
| Blitz detail — participants | — | Light + Dark | Admin (Approve/Decline buttons) | Dark-mode Approve color |
| Blitz detail — deals/costs/profitability/leaderboard | — | Light + Dark | Admin | Pills, color tokens |
| Payroll | 3 types × 3 status | Light + Dark | Admin | Date input min-w-0, SegmentedPills toggle |
| New Deal | 3 steps | Light + Dark | Rep | CTA colors, step indicators |
| My Pay | 4 periods | Light + Dark | Rep | Reimbursement card, pipeline tiles |
| Settings → Appearance | toggle test | Both | Any | Theme switch should propagate everywhere |
| Calculator | — | Light + Dark | Rep | Commission numeral |
| Training | — | Light + Dark | Rep | Stat tiles |
| Incentives | — | Light + Dark | Admin (create) + Rep (view) | FAB pattern |
| Reps list | — | Light + Dark | Admin | Avatar pattern, Add Rep submit color |

### 6.2 Edge cases (specific, must-walk)

- **Brand-new rep (0 deals, $0 paid)** → Welcome state shows, no $0 Next Payout, no negative numbers anywhere
- **Completed blitz** → No earnings forecast, summary card visible
- **View-As as a rep mid-quarter** → On-pace number is sensible
- **Mobile viewport 360px wide** → Hero breakdown does not wrap, no horizontal scroll
- **Long rep name in BottomNav avatar** → Initials only, no overflow
- **Admin with $14,300 Costs across blitzes** → Compact-formatted `$14.3K`, no clipping

**Risk gate**: any visual or functional defect documented and triaged before deploy. Tier 1+2 defects (broken flow, math wrong) block. Tier 3 (cosmetic) can ship with a follow-up ticket if Josh approves.

---

## 7. Deployment (Phase 6)

### 7.1 Pre-push final review

- `git log origin/main..HEAD` — review each commit subject and skim diffs
- `git diff origin/main..HEAD -- '*.tsx' '*.ts' '*.css'` — visually scan
- Confirm no stray `console.log`, no commented-out code, no debug paths left in

### 7.2 Push

`git push -u origin feat/blitz-engagement-and-dashboard`

Vercel will automatically build a preview deployment. Note: per `feedback_local_dev_for_testing.md`, Clerk `pk_live_*` is domain-locked so preview auth won't complete. Preview is useful for **build-success verification only**, not for full smoke testing.

### 7.3 PR + merge

Open PR with:
- Summary listing each commit grouped by tier
- Risk callouts (math, dark-mode)
- Test cleanup commits explicitly called out
- Link to this verification plan
- Rollback procedure inline

After CI green on PR, **merge to main directly** (no preview testing possible). Vercel deploys to `kilo-energy.vercel.app`.

### 7.4 Production smoke (live URL)

Within 5 minutes of deploy:
- Load `kilo-energy.vercel.app/dashboard` as admin + as rep
- Toggle each period
- Open a blitz
- Open Payroll
- Check on-pace number matches expectations

**Risk gate**: if anything looks broken on production, EXECUTE ROLLBACK immediately (Section 9). Do not try to forward-fix under time pressure.

---

## 8. Post-Deploy Watch (Phase 7)

### 8.1 First 1 hour

- Refresh production smoke every 15 minutes
- Watch Sentry for new error signatures (per `project_kilo_consistency_infra.md`)
- Verify a real rep (not Josh) loads their dashboard correctly

### 8.2 First 24 hours

- One full Vercel log review at +6h, +12h, +24h
- Check Sentry error rate vs baseline (should be flat or below)
- Solicit one rep for feedback on the on-pace number ("does this feel right?")

### 8.3 First 7 days

- Track if any rep questions the new on-pace number via feedback widget
- Watch for any dark-mode color complaints

**Stable state**: if 7 days with no regressions, retire this plan; merge `verification-plan.md` deletion in a cleanup PR.

---

## 9. Rollback Procedure

### 9.1 Per-commit revert (preferred for isolated issues)

`git revert <sha>` for the specific commit causing the issue. Push, Vercel redeploys.

### 9.2 Full-branch revert (if broad regressions appear)

After merge to main, the merge commit is the single point of revert:
`git revert -m 1 <merge-sha>` → push → Vercel redeploys main minus our work.

### 9.3 Database

No schema changes were made in this branch. No data migrations. **DB rollback is not required and not relevant.** Production data is unaffected by code revert.

### 9.4 What can NOT be rolled back automatically

- User-reported numbers screenshots (if a rep saw a confusing number and screenshotted it, you can't un-show them)
- Sentry events recorded against the deploy

---

## 10. Decision Gates Summary

| Phase | Gate | Stop condition |
|---|---|---|
| 1 → 2 | All unit tests green | Any red test |
| 2 → 3 | All 4 CI gates green | Typecheck, lint, audit, or primitive gate red |
| 3 → 4 | Math scenarios within bands | Any scenario > 20% off expected |
| 4 → 5 | Re-baselined snapshots free of bugs | Any baseline contains a visible defect |
| 5 → 6 | Smoke matrix clean | Any Tier 1 or 2 functional defect |
| 6 → 7 | Production smoke clean | Hero number wrong, page crash, blank surface |
| 7 → done | 7 days without regression | Any production regression |

---

## 11. Time Estimate

| Phase | Estimate | Notes |
|---|---|---|
| 0 Pre-flight | 15 min | Mostly checks |
| 0.5 Prod-read infra | 1 hr | Helper module + first query smoke test |
| 1 Test repair | 2-3 hr | Most variable; depends on how many tests need rewriting |
| 2 CI gates | 30 min | Mostly waiting on commands |
| 3 Math sanity | 45 min | Spreadsheet + 4 scenarios |
| 4 Visual snapshots | 1-2 hr | Re-baseline + review |
| 5 Smoke matrix | 2-3 hr | Walking every surface |
| 6 Deploy | 30 min | Push, merge, smoke |
| 7 Watch | 1 hr active over 24h | Mostly passive monitoring |

**Total active time**: roughly 1 working day, plus 24h passive watch.

---

## 12. Open Questions for Josh

1. ~~**Math access**~~ — RESOLVED 2026-05-16: Josh granted read access. Phase 0.5 governs how.
2. **Deploy timing**: deploy when verification clears, or hold for a specific launch window?
3. **Rep notification**: do reps need any heads-up that the on-pace number's framing changed (so they don't think the system is broken when their number shifts)?
4. **Snapshot regen**: who reviews the re-baselined screenshots — you alone, or do you want a second pair of eyes?

---

_Authored: 2026-05-16. Living document — update statuses inline as phases complete._
