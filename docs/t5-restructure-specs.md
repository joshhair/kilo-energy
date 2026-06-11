# Tier 5 — Restructure mini-specs

Drafted 2026-06-11 (Jarvis, under the dual-gate grant). Each Tier 5 item is an
information-architecture change with real regression risk; per the master
plan, none executes without its own spec, the relevant Tier 0 regression
suites in place (✅ done — T0.1 commission + T0.2 View-As suites are live),
staging validation, and screenshot review. These specs are the entry ticket.
**Recommended execution: one item per focused session, Codex-reviewed at
each increment — not batched.**

---

## T5.1 — Reusable role page shells (Med risk)
**Problem.** Every page hand-rolls its role branches (`if (isMobile) return <MobileX/>` + role conditionals inline), so role-scoped rendering bugs recur per page.
**Change.** Introduce `RolePageShell` (header/breadcrumb/max-width/error-boundary slot) + per-role layout presets. Adopt page-by-page, starting with the lowest-risk read-only pages (incentives, training).
**Before/after gate.** role-smoke suite (now exists, T4.4) green per adoption; visual baselines unchanged per page.
**Don't.** Don't migrate New Deal or Payroll until last (money surfaces).

## T5.2 — Role-specific bottom navs (Med risk)
**Problem.** One BottomNav serves all roles with conditional items; PM/SD get suboptimal orderings.
**Change.** Split nav definitions per role (already structured in lib/nav-items.ts — REP/ADMIN/SUB_DEALER/PM arrays exist); the restructure is per-role ICON BARS with role-tuned slot counts (4–5 max), measured against actual usage.
**Open question for Josh.** Which 4 slots per role matter most? (Usage data: ask reps, or add lightweight nav-tap logging first.)
**Gate.** role-smoke + the T1.2/F7 navigation locks.

## T5.3 — Project Detail sticky header + collapsible blocks (Med-High risk)
**Problem.** projects/[id] is a 2,500-line single scroll; finding Commission vs Files vs Activity means scrolling.
**Change.** Sticky compact header (customer · phase · key amounts) + collapsible sections (Overview/Commission/Files/Notes/Chatter/Activity), default-open per role (admin: Commission; PM: Files/Survey; rep: Overview).
**Gate.** T0.1 commission incident tests + paid-correction flows + the T1.6 More-menu test; mobile bottom-bar tests (T1.8 guard covers the fixed bar).
**Sequencing note.** Pairs naturally with T4.1's split of this same file — do T4.1(projects/[id]) first, then this becomes component re-arrangement instead of in-file surgery.

## T5.4 — Projects two-level filters + role-aware default views (Med risk)
**Problem.** One filter strip serves all roles; admins default to kanban-by-phase, reps care about "my active deals".
**Change.** Primary row (search + status + phase) + collapsed "More filters" drawer (installer, deal-scope, sort). Role-aware defaults: rep → My Deals/Active; PM → phase-ops view; admin → kanban.
**Open question for Josh.** Confirm the per-role defaults above.
**Gate.** Projects visual baselines (desktop+mobile) regenerate + eyeball; F5's min-w-0 fix retained.

## T5.5 — Dashboard rebalance into grouped bands (Med risk)
**Problem.** Admin dashboard stacks stats → quick actions → pipeline → needs-attention → tables in one column; scan order isn't band-grouped.
**Change.** Bands: "Money now" (revenue/paid/pending) · "Pipeline" (overview + needs-attention) · "Team" (reps/users). Rep dashboard equivalent: "My money" · "My deals" · "Goals/blitz".
**Gate.** Dashboard visual baselines + On-Pace formula memory (lib/period-projection.ts is the single source — NO inline math duplication during the move).

## T5.6 — New Deal sticky step header + reworked review (HIGH risk — commission entry)
**Problem.** Step context scrolls away on long forms; review step is dense.
**Change.** Sticky step header (step dots + installer/kW/PPW summary line), review page grouped People/Deal/Money with edit-jump links.
**Hard gates.** T0.1 commission tests + the prepaidSubType API tests + deal-submission e2e (golden path) + BOTH mobile/desktop visual passes + Codex review at every increment. Execute LAST, alone, in a fresh session.
**Don't.** No changes to validation logic, field gating (s2Fields), or commission math — layout only.

---
*Status: specs ready for Josh's review. T5.1/T5.4 are the lowest-risk starters; T5.6 is last by design.*
