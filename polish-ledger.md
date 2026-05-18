# Kilo Energy Mobile Polish Ledger

> **Source**: Phase 1 audit (2026-05-15) — 12 parallel read-only Explore agents, one per mobile surface, evaluated against a shared Premium Spec.
> **Branch**: `feat/blitz-engagement-and-dashboard` (local-only, never pushed).
> **Coverage**: every mobile-rendered file under `app/dashboard/mobile/` + responsive desktop files that render on mobile breakpoints + every shared mobile primitive + every UI primitive in `components/ui/` + global chrome (BottomNav, ConfirmDialog, FeedbackButton, View-As banner, Toast, Pagination, DateRangeFilter).

## Coverage Confirmation

| # | Surface | Auditor | Element count |
|---|---|---|---|
| 1 | MobileDashboard (rep + sub-dealer + PM layouts) | Agent 1 | 48 elements |
| 2 | MobileAdminDashboard | Agent 2 | 21 elements |
| 3 | MobileBlitz (list) | Agent 3 | 23 elements |
| 4 | MobileBlitzDetail + nested (BlitzTabs, BlitzParticipants, BlitzDeals, BlitzCosts, BlitzProfitability, BlitzEditSheet, BlitzLeaderboard, BlitzOverview, BlitzProgressBar, UpcomingBlitzBanner, BlitzEarningsForecast) | Agent 4 | 40+ elements |
| 5 | MobileProjects (list) | Agent 5 | 25 elements |
| 6 | MobileProjectDetail | Agent 6 | 28 elements |
| 7 | New Deal wizard (3 steps + success) | Agent 7 | 40+ elements |
| 8 | MobileEarnings + MyPay + MobilePayroll + ReimbursementModal | Agent 8 | 60+ elements |
| 9 | MobileYou + MobileSettings (all sections) + Preferences + NotificationsSection | Agent 9 | 70+ elements |
| 10 | MobileTraining + MobileCalculator + MobileIncentives + MobileReps + IncentiveCard | Agent 10 | 35+ elements |
| 11 | BottomNav + Toast + ConfirmDialog + FeedbackButton + View-As banner + PaginationBar + DateRangeFilter + SetterPickerPopover + Skeleton + Button/Switch/SegmentedPills/Input primitives | Agent 11 | 50+ elements |
| 12 | All shared mobile primitives (MobileCard, MobileStatCard, MobileBadge, MobileSection, MobileBottomSheet, MobilePageHeader, MobileEmptyState, MobileListItem, MobileBulkActionBar, IncentiveCard, PayrollTabs) + every `components/ui/` primitive | Agent 12 | 24 primitives |

**Total**: ~450 distinct visual elements evaluated. Every file under `app/dashboard/mobile/`, every shared primitive, and every global chrome surface is in the audit.

---

## TACKY Violations — Grouped by Pattern

### Pattern A — Gradient on CTA (spec §3 violation)
The single most common drift. Pattern: `linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))` used as a fill on primary buttons.

| File | Line | Element |
|---|---|---|
| `components/ui/Button.tsx` | 56-79 | **PrimaryButton** primitive (the root — fixing this cascades to ~100 consumers) |
| `app/dashboard/mobile/MobileBlitz.tsx` | 385-393 | Admin "+" header create button (gradient + halo) |
| `app/dashboard/mobile/MobileBlitz.tsx` | 742-749 | Admin "Approve" request button |
| `app/dashboard/mobile/MobileBlitz.tsx` | 935-946 | Create/Request blitz form submit (gradient + halo) |
| `app/dashboard/mobile/MobileProjects.tsx` | 439-450 | "Submit a deal" empty-state CTA |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1351 | Sticky "Change Phase" bottom CTA + shadow halo |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1619 | Edit-sheet "Save" footer button |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1165 | Milestone track fill gradient |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1180 | Milestone node (paid state) gradient |
| `app/dashboard/mobile/MobileCalculator.tsx` | 672-676 | Deal-type toggle gradient (Paired/Self-gen) |
| `app/dashboard/mobile/MobileIncentives.tsx` | 322-334 | Floating "+" hero create button (gradient + glow) |
| `app/dashboard/mobile/MobileIncentives.tsx` | 817-825 | Create Incentive submit |
| `app/dashboard/mobile/MobileIncentives.tsx` | 1027-1035 | Edit Incentive submit |
| `app/dashboard/new-deal/page.tsx` | (FAB + Submit) | New Deal wizard final submit, "View Projects" on success |
| `app/dashboard/mobile/blitz-detail/BlitzParticipants.tsx` | 234-246 | "Add Participant" bottom-sheet submit |
| `app/dashboard/mobile/blitz-detail/BlitzCosts.tsx` | 206 | "Add Cost" bottom-sheet submit |
| `app/dashboard/mobile/blitz-detail/BlitzEditSheet.tsx` | 224 | "Save changes" footer button |
| `app/dashboard/mobile/blitz-detail/BlitzLeaderboard.tsx` | 8-12 | Top-3 rank badge gradients (gold/silver/bronze) |
| `app/dashboard/my-pay/page.tsx` | (reimb modal) | Reimbursement modal Submit Request |
| `app/dashboard/mobile/MobileSettings.tsx` | (multiple) | Save buttons across sections (Customization, Baselines edit, Baselines New Version, AdminUsers Add) |
| `app/dashboard/payroll/page.tsx` | 432 | Add Payment button |
| `app/dashboard/payroll/page.tsx` | 810 | Sticky action bar (Publish / Approve All) |

### Pattern B — Halo glow (`boxShadow: '0 0 Npx ... glow'`) on CTAs (spec §3 violation)
Often paired with Pattern A.

| File | Line | Element |
|---|---|---|
| `app/dashboard/mobile/MobileSettings.tsx` | 618-626 | Add Admin button glow |
| `app/dashboard/mobile/MobileSettings.tsx` | 1016-1022 | Customization Save glow |
| `app/dashboard/mobile/MobileSettings.tsx` | 1210-1214 | Baselines edit Save glow |
| `app/dashboard/mobile/MobileSettings.tsx` | 1290 | New Version Create glow |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1352 | Change Phase shadow halo |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1498 | Lead Source active button glow |
| `app/dashboard/mobile/MobileAdminDashboard.tsx` | 332-339 | "My Rep View" button (emerald-soft + emerald-glow border) |
| `app/dashboard/mobile/MobileAdminDashboard.tsx` | 354-371 | Hero card glow orb + radial gradient overlay |

### Pattern C — Saturated solid fill for active state (spec §2 violation)
Active state should be soft tint (12-15% color-mix) + accent text, NOT solid emerald-solid as background.

| File | Line | Element |
|---|---|---|
| `app/dashboard/mobile/MobileBlitz.tsx` | 625-656 | "Blitzes / Requests" segmented toggle — solid emerald-solid indicator |
| `app/dashboard/mobile/MobileBlitz.tsx` | 643-654 | "Requests" badge solid red-solid fill |
| `app/dashboard/mobile/MobileSettings.tsx` | 365, 477 | Installer/Financer status badges (emerald-soft fill on active) |
| `app/dashboard/mobile/MobileSettings.tsx` | 747-751 | PM permission toggle buttons (emerald-soft fill) |
| `app/dashboard/mobile/MobileSettings.tsx` | 915 | Export "done" state (emerald-soft fill) |
| `app/dashboard/mobile/MobileProjectDetail.tsx` | 1495 | Lead Source active button (solid emerald + glow + saturated) |
| `app/dashboard/mobile/MobileAdminDashboard.tsx` | 502-527 | Top Reps rank badges (saturated emerald-soft / cyan-soft) |
| `app/dashboard/mobile/MobileAdminDashboard.tsx` | 555-571 | Cancellation Reasons row backgrounds (surface-inset-subtle saturated) |
| `app/dashboard/mobile/MobileDashboard.tsx` | 988-990 | "Needs Attention" count badge (emerald-soft fill blob → outline) |
| `app/dashboard/mobile/MobileDashboard.tsx` | 1044 | Incentive icon box (15% color-mix → flat color) |
| `app/dashboard/mobile/MobileDashboard.tsx` | 1051-1053 | "Personal" badge (purple-soft fill blob → outline) |
| `app/dashboard/mobile/MobileDashboard.tsx` | 1057-1059 | Incentive progress bar gradient (emerald→cyan → flat) |
| `app/dashboard/mobile/MobileBlitzDetail.tsx` | 452-490 | "Your Blitz Summary" card uses blue left border (should be emerald per pattern) |
| `app/dashboard/layout.tsx` | 850-873 | View-As banner — saturated amber-500/10 bg + amber-500/30 border (should be card-surface + hairline) |
| `lib/toast.tsx` | 124-126 | Toast success icon uses raw `#00e07a` saturated bright green |

### Pattern D — Custom rolled-your-own instead of primitive
Components reimplementing what the primitive already provides.

| File | Line | Element |
|---|---|---|
| `app/dashboard/mobile/MobileSettings.tsx` | 273-293 | Hand-rolled toggle switch (should use `Switch` from `components/ui`) |
| `app/dashboard/users/page.tsx` | 1368, 1427 | Filter pills using legacy `.filter-tab-active` CSS class (migrate to `SegmentedPills`) |
| `app/dashboard/my-pay/page.tsx` | 980 | Period selector using `.filter-tab-active` (migrate to `SegmentedPills`) |
| `app/dashboard/mobile/MobileBlitz.tsx` | 625-656 | Custom blitz/requests toggle (replace with `SegmentedPills`) |

### Pattern E — Sub-spec hairline (0.5px borders)
Spec says 1px hairline. New Deal wizard uses 0.5px everywhere.

| File | Lines | Count |
|---|---|---|
| `app/dashboard/mobile/MobileNewDeal.tsx` | input fields (Customer, Sold Date, Closer, Installer, all financers, all equipment selects, kW, Net PPW, Notes, Lead Source, Blitz selector) | ~14 instances |

### Pattern F — Typography drift
Eyebrow labels with wrong tracking or missing it entirely; hardcoded color tokens; serif missing where spec calls for it.

| File | Line | Issue |
|---|---|---|
| `app/dashboard/mobile/MobileAdminDashboard.tsx` | 356 | "REVENUE" eyebrow uses 0.12em tracking (spec: 0.22em) |
| `app/dashboard/mobile/MobileAdminDashboard.tsx` | 363, 368, 482, 502, 530, 555, 596 | Section eyebrow labels missing explicit `tracking-widest` |
| `app/dashboard/mobile/shared/MobileBottomSheet.tsx` | header `<p>` | Sheet header uses sans-serif (spec: serif header for sheets) |
| `app/dashboard/mobile/MobileDashboard.tsx` | 723, 1100 | Hardcoded `#2a3858` border color instead of `var(--border-default)` |

### Pattern G — Inconsistent primitive base
Components quietly diverging from the canonical primitive base.

| File | Line | Issue |
|---|---|---|
| `app/dashboard/components/ConfirmDialog.tsx` | (panel bg) | Uses `var(--surface)` instead of `var(--surface-card)` |
| `app/dashboard/mobile/shared/MobilePageHeader.tsx` | (entire) | No sticky positioning + no bottom hairline (feels unfinished) |
| `app/dashboard/mobile/shared/MobileEmptyState.tsx` | (entire) | No card-surface wrapper — feels incomplete vs. desktop `EmptyState` |
| `app/dashboard/components/PaginationBar.tsx` | (focus/colors) | Uses `input-focus-glow` legacy class + `var(--brand)` token — verify resolution |

### Pattern H — Animation referenced but missing
Missing CSS keyframe definitions.

| File | Issue |
|---|---|
| `lib/toast.tsx:150` | References `animate-toast-in` class that isn't defined in `app/globals.css` |

### Pattern I — Z-index / overflow bug
| File | Issue |
|---|---|
| `components/ui/SegmentedPills.tsx:281` | Underline indicator (`left-3 right-3 -bottom-px`) bleeds over feedback bubble (z-40) on blitz detail. **Fix**: set `zIndex: -1` on the underline span or clip container with `overflow: hidden`. |

---

## Orphaned Legacy CSS (post-`SegmentedPills` migration)

### Safe to delete
- `.tab-bar-container` (globals.css:996-998) — only used in print styles
- `.tab-indicator` (globals.css:1017-1029) — unused
- `.blitz-detail-tab-indicator` (globals.css:1657-1662) — unused
- `.mobile-pill-tab-indicator` (globals.css:1664-1669) — unused

### Migration required before delete
- `.filter-tab-active` (globals.css:1004-1010) — still used in `users/page.tsx:1368`, `users/page.tsx:1427`, `my-pay/page.tsx:980`
- `.blitz-tab-indicator` (globals.css:1653-1655) — used by MobileBlitz "Blitzes/Requests" custom toggle (Pattern D, also fixes Pattern C)

---

## PREMIUM (gold-standard surfaces — preserve untouched)

These already match the spec exactly. Use as positive references:

- MobileMyPay hero stack (`my-pay/page.tsx`) — DM Serif numerals, card-surface tiles, hairline borders, soft accent badges
- `UpcomingBlitzBanner` (both invited & default variants) — card-surface + left emerald stripe + serif headline + outlined CTA
- `MobileBlitzDetail` FOMO banner — same pattern (card-surface + hairline + accent eyebrow + serif headline)
- `BlitzEarningsForecast` Set-as-goal button — 14% soft tint + 32% hairline border + accent text
- `BottomNav` New Deal FAB — card-surface tile + hairline emerald ring + serif "+" + spark dot
- `BottomNav` underline indicator — soft gradient stripe with cubic-bezier spring
- `SegmentedPills` primitive — single source of truth for filter rows
- `MobileBadge` — outlined ghost (transparent + 1.5px accent border + accent text)
- `MobileCard` — card-surface + hairline; hero variant adds emerald-soft border + subtle glow orb
- `Switch` primitive — solid track + white knob + cubic-bezier translate
- `TextInput` primitive — card-surface + hairline + emerald focus ring

---

## Recommended Phase 3 Execution Order

Once the Premium Spec is locked in, dispatch implementation agents in this order to minimize cross-file churn:

### Wave 1 — Primitives (cascade fixes downstream, do first)
1. **`components/ui/Button.tsx`** — strip gradient from PrimaryButton; replace with solid `var(--accent-emerald-solid)` (or keep gradient as an opt-in `variant="brand"` for desktop Settings only). All 100+ consumers inherit the fix.
2. **`app/dashboard/components/ConfirmDialog.tsx`** — bg `var(--surface)` → `var(--surface-card)`
3. **`app/dashboard/mobile/shared/MobileBottomSheet.tsx`** — serif header per spec
4. **`app/dashboard/mobile/shared/MobilePageHeader.tsx`** — add sticky + hairline bottom
5. **`app/dashboard/mobile/shared/MobileEmptyState.tsx`** — wrap in card-surface
6. **`components/ui/SegmentedPills.tsx`** — fix z-index bleed bug (`zIndex: -1` on underline)
7. **`lib/toast.tsx`** — replace `#00e07a` with `var(--accent-emerald-solid)`; add `animate-toast-in` keyframe to globals.css
8. **`app/dashboard/layout.tsx`** — refactor View-As banner to card-surface + hairline

### Wave 2 — Surface-by-surface CTA cleanup (parallel agents)
9. MobileBlitz (admin "+" + Approve + form submit + Blitzes/Requests toggle)
10. MobileBlitzDetail nested (BlitzParticipants Add, BlitzCosts Add, BlitzEditSheet Save, BlitzLeaderboard rank badges, "Your Blitz Summary" blue→emerald)
11. MobileProjects ("Submit a deal" gradient)
12. MobileProjectDetail (Change Phase sticky, milestone gradients, Lead Source buttons, Edit-sheet Save)
13. MobileNewDeal (all 0.5px borders → 1px; View Projects shadow removal)
14. MobileCalculator (deal type toggle gradient)
15. MobileIncentives (3 gradient buttons + floating + button)
16. MobileSettings (custom toggle → Switch; all section Save halos; status/permission/export soft-fill → outline)
17. MobileMyPay (reimbursement modal Submit gradient)
18. MobilePayroll (Add Payment + Sticky action bar gradients)
19. MobileAdminDashboard (My Rep View, Hero glow orb, Top Reps rank, Cancellation Reasons rows, Search focus ring, eyebrow tracking)
20. MobileDashboard (Needs Attention badge → outline, Personal badge → outline, Incentive icon box → flat, Incentive progress bar → flat, border colors → token)
21. Desktop legacy migrations: `users/page.tsx`, `my-pay/page.tsx` filter pills → SegmentedPills

### Wave 3 — Cleanup
22. Delete orphaned CSS classes (`tab-bar-container`, `tab-indicator`, `blitz-detail-tab-indicator`, `mobile-pill-tab-indicator`, `filter-tab-active`, `blitz-tab-indicator`)
23. Run typecheck, lint, all 5 CI gates, vitest tests, Playwright visual regression

---

## Numbers

- **TACKY violations**: 67 distinct (grouped into 9 patterns)
- **OK entries** (acceptable, neutral): ~140
- **PREMIUM entries** (gold-standard, preserve): ~240
- **Orphan CSS classes**: 6
- **Known bugs**: 2 (z-index bleed, missing animation keyframe)
- **Primitive-level cascading fixes**: 8 files (Wave 1) fix 100+ consumers
- **Surface-level cleanup files**: 13 files (Wave 2)

This ledger is the contract. Phase 3 agents work against this document plus the locked Premium Spec.
