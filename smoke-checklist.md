# Phase 5 — Smoke Matrix Checklist

**Use**: walk every box, mark ✓ for OK or note the defect. Filed under verification-plan.md §6.

Run on the local dev server (http://localhost:3000) before Phase 6 push. Test both **light** and **dark** themes via Settings → Appearance.

---

## Dashboard — Rep view

For each period filter (`2026 Cash` · `This Month` · `This Quarter` · `This Year` · `Last Month` · `Last Year`):

| Surface check | Light | Dark |
|---|---|---|
| Period pill is selectable + visually active | ☐ | ☐ |
| Hero card renders without overflow | ☐ | ☐ |
| Big number (currency) doesn't wrap | ☐ | ☐ |
| Breakdown line stays on one line, no clipping | ☐ | ☐ |
| Info icon (i) is tappable + opens explanation sheet | ☐ | ☐ |
| Explanation sheet content matches the active period | ☐ | ☐ |
| Bottom-nav indicator aligned, no halo bleed | ☐ | ☐ |

Period-specific:

- **2026 Cash (default)** — `pipeline + new + paid` math reads right; ~$402K for Josh
- **This Year / This Quarter / This Month** — `On Pace For YYYY` or `On Pace · This X` label; breakdown shows `earned + pace · deals/mo`
- **Last Month / Last Year** — historical hero (earned $) renders, no "0 deals · $0 to pipeline" noise when empty

## Dashboard — Admin view

| Surface check | Light | Dark |
|---|---|---|
| Period pill row shows "All Time" (not "2026 Cash") | ☐ | ☐ |
| Revenue card: cyan numeral + emerald-text eyebrow + "Paid Out" label | ☐ | ☐ |
| Stat tiles unified (numerals = text-primary; eyebrows = emerald-text) | ☐ | ☐ |
| Needs Attention card refined (serif title, slim count badge) | ☐ | ☐ |
| Top Reps card respects period (says "All time" when applicable) | ☐ | ☐ |
| View-As-rep button works; flips to MobileDashboard | ☐ | ☐ |

## Blitz list

| Surface check | Light | Dark |
|---|---|---|
| Hero card 2×2 sub-stat grid (Active · Deals · Total kW · Costs) | ☐ | ☐ |
| `$14.3K` compact-formatted Costs (not `$14,300` clipping) | ☐ | ☐ |
| Per-blitz cards show `Leader` chip when isOwner | ☐ | ☐ |
| Per-blitz cards show amber `X PENDING` chip when admin/owner + any pending joins | ☐ | ☐ |
| SegmentedPills status filter works (All · Upcoming · Active · Completed · Cancelled) | ☐ | ☐ |
| Blitzes / Requests toggle uses SegmentedPills | ☐ | ☐ |

## Blitz detail

For one **active**, one **completed**, one **with pending joins** blitz:

| Surface check | Light | Dark |
|---|---|---|
| Overview tab: hero / dates / progress bar render | ☐ | ☐ |
| Earnings Forecast **hidden** on completed blitz | ☐ | ☐ |
| Earnings Forecast **shown** on active blitz | ☐ | ☐ |
| Reps tab — leader's own row has NO attendance pills | ☐ | ☐ |
| Reps tab — other approved reps show 3 compact pills + inline trash icon | ☐ | ☐ |
| Reps tab — "No-show" pill doesn't wrap | ☐ | ☐ |
| Reps tab — pending joiners show Approve/Decline row | ☐ | ☐ |
| Deals / Costs / Profitability / Leaderboard tabs render | ☐ | ☐ |
| Edit Blitz sheet — Starts/Ends dates show full year (no clipping) | ☐ | ☐ |
| Edit Blitz sheet — RSVP Deadline + Max Participants stack single-col cleanly | ☐ | ☐ |
| Save Changes button: solid emerald, no halo | ☐ | ☐ |

## Payroll

| Surface check | Light | Dark |
|---|---|---|
| Type tabs (Deal · Bonus · Trainer) use SegmentedPills | ☐ | ☐ |
| Status tabs (Draft · Pending · Paid) use SegmentedPills underline variant | ☐ | ☐ |
| Date filter inputs side-by-side: no right-edge clipping | ☐ | ☐ |
| CSV / ADP / Print buttons: card-surface, hairline border | ☐ | ☐ |
| Sticky Publish CTA: hairline emerald pill (not solid gradient) | ☐ | ☐ |
| Empty state: "No draft entries." centered, no jitter | ☐ | ☐ |

## My Pay

| Surface check | Light | Dark |
|---|---|---|
| Hero card: Next Payout + Pending + Pipeline visible | ☐ | ☐ |
| Lifetime footnote inside hero renders | ☐ | ☐ |
| **NEW Lifetime section** below the rest (3-up: Earned · Deals · kW Sold) | ☐ | ☐ |
| Reimbursement request card: card-surface + emerald hairline | ☐ | ☐ |
| Projected Pipeline rows unified (single emerald accent) | ☐ | ☐ |

## New Deal flow

| Surface check | Light | Dark |
|---|---|---|
| Step 1 → Step 2 → Step 3 navigation works | ☐ | ☐ |
| Next button: deeper revenue-green (#007355) + white text | ☐ | ☐ |
| Submit Deal button: same green | ☐ | ☐ |
| Lead Source active button: soft tint (not solid + glow) | ☐ | ☐ |
| Sticky CTA bar visible on each step | ☐ | ☐ |

## Other rep surfaces

| Surface check | Light | Dark |
|---|---|---|
| Calculator: commission numeral = text-primary; eyebrow emerald-text | ☐ | ☐ |
| Training: 4 stat tiles unified | ☐ | ☐ |
| Incentives: hero `+` create button is FAB pattern | ☐ | ☐ |
| Reps list (admin): Add Rep submit = solid emerald, no halo | ☐ | ☐ |

## Edge cases (must walk)

| Case | Pass? |
|---|---|
| Brand-new rep, 0 deals, $0 payout: "Welcome" empty-state hero | ☐ |
| Period filter persists across tab navigation (or resets — either is fine, just consistent) | ☐ |
| iOS Safari 360px width: no horizontal scroll on dashboard | ☐ |
| Theme toggle (Settings → Appearance → Dark): all surfaces re-render correctly | ☐ |
| Admin "My Rep View" → Back to admin: switches dashboard cleanly | ☐ |
| Long rep name in BottomNav avatar: initials only | ☐ |

---

## Defect log

Use this to capture anything Josh finds during the walk. Filed in PR description.

```
[ ] Defect 1: <description> — surface: <which screen> · severity: <T1 block / T2 medium / T3 cosmetic>
[ ] Defect 2: ...
```

---

## Sign-off

- Walked-by: Josh Hair
- Date: ____________
- Theme(s) covered: light ☐ · dark ☐
- All Tier 1 + 2 boxes ✓: ☐
- OK to proceed to Phase 6 (push + merge): ☐
