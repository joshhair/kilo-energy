# Manual smoke-test checklist — design-token sweep

Phase 4 (automated visual diff via QA Playwright) was skipped because the
captured Clerk sessions (`.qa-session-admin.json` / `.qa-session-rep.json`)
are 12 days old and known to expire far faster than that. Re-bootstrapping
requires a headed Clerk login.

In place of the automated diff, this checklist is the smoke-test gate
before merging `feat/design-tokens` into `main`. Run through each item
in dark mode (default) and again in light mode (toggle in Settings → Appearance,
shipped in Phase 5).

## Why the risk is low

Every Phase 2 commit was mechanical sed substitution of legacy variable
names → canonical token names where the canonical token's value matches
the legacy value in dark mode, with eight pre-documented outlier
unifications listed in `docs/design-tokens.md`. Build passed after every
commit. No logic, hooks, or props changed.

## Smoke-test path (admin role)

Test in **dark** first, then switch to **light** and repeat.

### Auth + shell
- [ ] Sign-in page renders cleanly (logo, "Sign in to Kilo Energy", form fields legible)
- [ ] Post-sign-in: navy gradient + emerald loading orb visible while context loads
- [ ] Sidebar (desktop): logo wordmark "kilo energy" with green dot, nav items legible, hover states feel right
- [ ] Sidebar collapsed (≤ 64px width): icons centered, tooltips on hover work
- [ ] Bottom nav (mobile): all 5 tabs render, "+" FAB has emerald gradient, active pill indicator slides
- [ ] View As selector (admin): dropdown opens, search filters, switching to a rep banner shows amber "Viewing as" strip
- [ ] Profile drawer (mobile More tab): opens, items visible, logout legible

### Dashboard
- [ ] Admin dashboard stat cards (Total Users / Total Sold / Pending Reviews / Active Deals): each shows correct accent color (purple / teal / amber / emerald)
- [ ] "Needs Attention" section renders correctly when empty (All Clear state) and when populated
- [ ] Recent Projects list: phase badges show correct phase color (New=emerald, Site Survey=amber, Cancelled=red, etc.)
- [ ] Drill-down slide-overs (PayrollEntry list, etc.) render with correct backdrop overlay

### Projects
- [ ] Projects page kanban view (admin) — column header colors per phase, card commission pills correct color
- [ ] Projects list mobile — 50-item pagination intact, "Show more" button styled correctly
- [ ] Project detail (admin) — Pipeline stepper colors per phase, M1/M2/M3 milestones, trainer card if applicable
- [ ] Edit project modal — labels, inputs, save/cancel buttons styled correctly

### Payroll
- [ ] Payroll page (desktop) — Draft / Pending / Paid status tabs with correct accent colors
- [ ] Payroll mobile — 3-up SummaryCard grid (Draft/Pending/Paid), no overflow, correct colors per status
- [ ] Type tabs (Deal / Bonus / Trainer) sliding pill animates
- [ ] PayrollEntry detail sheet — amount, breakdown, save buttons render

### Earnings + MyPay + Calculator
- [ ] Earnings page — monthly bar chart colors, period filter pills
- [ ] Earnings mobile — recent entries list, reimbursements section
- [ ] My Pay page — pace card, deal entries
- [ ] Calculator — installer dropdown, deal type toggle, kW/PPW inputs, results breakdown

### Blitz
- [ ] Blitz list — leaderboard, profitability stats
- [ ] Blitz detail — tabs (Overview / Leaderboard / Costs / Profitability / Deals / Participants), each tab loads
- [ ] Mobile blitz tabs — sliding pill indicator works

### Settings (admin)
- [ ] Settings sections render: Blitz Permissions, Sub-Dealers, Project Managers, Admin Users, Installers, Financers, Baselines, Customization, Export
- [ ] Add Installer modal — color picker, baseline form
- [ ] **Appearance toggle (NEW Phase 5)** — System / Dark / Light radio renders, switching updates instantly, persists across reload, no flash of wrong theme on first load

### Misc surfaces
- [ ] Command palette (⌘K) — opens, items legible, hover states
- [ ] Keyboard shortcuts overlay (?) — opens, layout intact
- [ ] Toast notifications — show in correct accent color per type (success=emerald, error=red, info=blue)
- [ ] Confirm dialog — backdrop, action button styling
- [ ] Mobile bottom sheet — backdrop overlay, panel border-top, drag handle visible

## Outlier unifications expected in dark mode

Per `docs/design-tokens.md`, these are intentional dark-mode shifts. The
PR review should confirm each looks acceptable rather than worse than before:

1. `--text-muted` shifted #8891a8 → #8899aa (2-pt cooler hue)
2. `--text-dim` shifted #525c72 → #445577 (noticeably darker, more navy)
3. `--accent-cyan` shifted #00c4f0 → #00b4d8 (cooler, deeper)
4. `--accent-amber` shifted #ffb020 → #f5a623 (more pumpkin)
5. `--accent-red` / `--accent-danger` consolidated to #ef4444 (Tailwind red-500)
6. In-app emerald shifted #00e07a → #00e5a0 (cooler) — kilo wordmark stays warm #00e07a
7. "Pending Install" badge shifted orange (#fb923c) → amber-solid
8. "Design" badge shifted purple (#a855f7) → accent-purple-solid (#b47dff)

If any of these look worse than the original, edit the value in
`app/globals.css` `:root` block — token cascade flips every surface using it.

## Sign-off

- [ ] All dark-mode surfaces above check out
- [ ] All light-mode surfaces above check out
- [ ] No console errors during navigation
- [ ] Outlier unifications acceptable (or token values adjusted before merge)
- [ ] Approve PR for merge to main
