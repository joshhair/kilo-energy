# Blitz Engagement Phase 2 + On-Pace rewrite + 2026 Cash Forecast + premium polish

## Summary

This branch ships the **Blitz Engagement Phase 2** feature suite alongside a **rewrite of the on-pace earnings projection**, the new **2026 Cash Forecast** hero, and the **premium polish pass** across ~55 mobile surfaces.

44 commits. Verified per `verification-plan.md` (in-repo).

## What ships

### Math / algorithm changes (read these carefully)

- **On Pace formula rewritten**: `commissionEarnedFromInPeriodDeals + paceRate × monthsRemainingInP`. Replaces the legacy `rate × 12 + 0.15 × pipeline` blended formula. Calendar-aware, role-aware (M1+M2+M3), no magic outer factor. Tests in `tests/unit/on-pace-projection.test.ts`.
- **2026 Cash Forecast** (NEW hero, renders when period = `'all'`): milestone-ETA dating (M1 +14d, M2 +45d, M3 +80d from sold) — what cash will actually land by Dec 31. Tests in `tests/unit/cash-forecast.test.ts`.
- **My Pay harmonized**: same `computeOnPace` helper now powers both Dashboard and My Pay headlines (S3 audit fix). Reps no longer see two different numbers under the same label.

### New features (already on branch pre-session, ship together)

- Blitz RSVP + waitlist
- Per-rep deal goals (`targetDeals` nullable column)
- Headcount cap (`maxParticipants` nullable column)
- RSVP deadline (`confirmDeadline` nullable column)
- Blitz broadcast messages
- Web Push notifications + service worker
- T-7 / T-3 / T-1 / T-0 reminder cron + `.github/workflows/blitz-reminders.yml`
- BlitzEarningsForecast slider (visible to approved participants on upcoming/active blitzes only)
- Upcoming-blitz banner on dashboard
- Calendar .ics export
- Per-blitz pending-join chip for owners/admins

### Premium polish

- Token downshift: light-mode emerald → `#009868` / `#007355`, dark-mode → `#10b981`
- FAB pattern replacing gradient CTAs (BottomNav, headers)
- Halo/glow removal from hero cards
- SegmentedPills primitive across ~12 surfaces
- Hero card restructures: admin Revenue (cyan numeral, "Paid Out" label), Blitz overview (2×2 sub-stat grid)
- Date input fixes (Payroll filter, BlitzEditSheet)
- BlitzParticipants attendance pill redesign (compact, no equal-width flex)
- Info icon + explanation bottom sheet on dashboard hero cards
- Notifications Settings: collapse-by-default + bulk-enable Switch + smooth grid-rows animation + Phone/QH wrap

### Infrastructure

- New helpers in `lib/period-projection.ts`: `computeOnPace`, `viewerFullCommission`, `viewerMilestones`, `computeCashForecast`, `computePhaseWeightedBoost`
- `scripts/prod-read/*.mts` — read-only Turso verification helper (3 layers of protection: NODE_ENV guard, method whitelist proxy, audit log)
- Schema migration **already applied to Turso** earlier in the verification cycle (3 additive nullable columns) — no migration runs at deploy time
- `verification-plan.md` + `smoke-checklist.md` — durable working docs

## Verification

All 6 CI gates green locally:

- `typecheck` — 0 errors
- `lint` — 0 errors (84 pre-existing warnings)
- `tests` — 847 / 847 pass
- `check:audit`, `check:primitives`, `check:schema`, `check:privacy-gate`, `check:sensitivity`, `check:notifications` — all ✓

Math sanity ran against real Turso data via the read-only helper. Audit log at `tmp/prod-read.log` (gitignored). Per-rep numbers verified within acceptance bands.

## Deep audit findings (resolved or known)

| # | Severity | Issue | Status |
|---|---|---|---|
| C1 | Critical | CI workflow defaulted to legacy app URL | ✓ Fixed |
| C2 | Critical | Customer-PII state files in branch history | ✓ Removed from HEAD; **squash-merge** keeps them out of main's history |
| S1 | Should-fix | Misleading commit message on `b99fdae` | ✓ Resolved by squash |
| S2 | Should-fix | 14 legal/contract docs at repo root | ✓ Removed + gitignored |
| S3 | Should-fix | My Pay diverged from Dashboard | ✓ Fixed (commit `1a2e16e`) |

## Known follow-ups (not blockers)

1. Trainer override is excluded from the on-pace number (was previously folded into My Pay's pipeline-boost). Trainer reps' on-pace dips slightly. Follow-up: decide if trainer override should be surfaced separately or rolled into pace.
2. Visual regression baselines (`tests/e2e/visual.test.ts`) never existed for the changed surfaces. Follow-up: re-baseline against a seeded local DB so future regressions trip automatically.

## Merge strategy

**Use squash-merge** when merging this PR. Reason: the `b99fdae` commit blob contains 7 PII state files that were removed from HEAD in a later commit. Squash-merge ensures only HEAD content reaches main's history.

## Test plan

- [ ] Squash-merge to main
- [ ] Vercel deploy succeeds
- [ ] Production smoke within 5 min of deploy: dashboard loads as admin + as rep (view-as), period filter cycles, blitz detail renders
- [ ] Sentry tab open for first hour after deploy
- [ ] At +6h, +12h, +24h: log review for new error signatures
- [ ] Spot-check a real rep's on-pace number for sanity

## Rollback

`git revert -m 1 <merge-sha>` reverts the whole merge atomically. No DB rollback needed (only additive nullable columns; existing rows unaffected).

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
