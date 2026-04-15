# Kilo Energy — Production-Readiness Grade Report

**Date:** 2026-04-15
**Reviewer:** Jarvis (Claude Opus 4.6)
**Baseline:** Post A+ refactor + Phase 1 hardening (commit `04f238b`), Phase 2 audit-log system WIP.
**Supersedes:** `PLAN_REVIEW.md` / `ARCHITECTURE_REVIEW.md` (2026-03-27, stale).

---

## Grades at a Glance

| # | Dimension      | Grade | Single biggest gap to next level |
|---|----------------|-------|----------------------------------|
| 1 | Logic          | **B+** | Commit StrictMode fix; validate trainer-override % cap; define rounding strategy. |
| 2 | Structure      | **A-** | Split `lib/data.ts` (~1,580 L). Break up 1.5–2K-line dashboard pages. |
| 3 | Security       | **B+** | Rate limiting + field-level response redaction. |
| 4 | Privacy        | **B**  | Wire `/api/users/[id]/export` + `/erase`; retention cron for AuditLog. |
| 5 | Code Structure | **A**  | Resolve pricing TODO; JSDoc for project-transitions; prune unused context methods. |
| 6 | Efficiency     | **B**  | Move dashboard off single `'use client'` layout → RSC + Server Actions; virtualize lists; `next/image`. |

**Overall:** pre-launch **B-/B** — ready for closed-alpha with trusted users, NOT ready for public launch.

---

## 1. Logic — B+

**Strengths**
- `calculateCommission()` explicitly floors at 0 (no silent negatives).
- Idempotency keys prevent double-pay on `POST /api/payroll` (clients pass optimistic clientId).
- M1/M2/M3 phase transitions modeled in `lib/context/project-transitions.ts` (694 L).
- Commission math suite: 659 lines of tests covering tiering + edges.

**Weaknesses**
- **StrictMode concurrency bug (WIP fix in diff)** — `lib/context.tsx` nests `setPayrollEntries` inside `setProjects` updater; StrictMode double-invoke creates duplicates.
- **Trainer override uncapped** — no validation that closer + setter + trainer ≤ 100%.
- **Rounding undefined** — floating-point tails in payroll amounts possible.

---

## 2. Structure — A-

**Strengths**
- Context split into 4 domain modules (`payroll`, `installers`, `project-transitions`, `users`).
- 44 API routes, cleanly named and scoped.
- Prisma schema: 26 models, normalized, fully indexed on high-cardinality joins.

**Weaknesses**
- `lib/data.ts` still ~1,580 L (types + seed + logic + constants).
- Dashboard pages: `projects/[id]/page.tsx` 1,963 L, `payroll/page.tsx` 1,542 L, `page.tsx` 1,620 L, `new-deal/page.tsx` 1,562 L.
- `AppProvider` exposes 40+ slices/methods — any consumer re-renders on any change.

---

## 3. Security — B+

**Strengths**
- Clerk + `middleware.ts` protecting all non-public routes.
- `lib/api-auth.ts`: `requireAdmin`, `requireAdminOrPM`, `userCanAccessProject` called on every API route.
- PII logger with field blacklist (email, phone, token, ssn, dob).
- Audit log (`lib/audit.ts` + `AuditLog` model) wired on phase changes, financial edits, payroll create.

**Weaknesses**
- **No rate limiting** on API routes.
- **No field-level response redaction** — API handlers return full Prisma objects (e.g., `include: { rep, project }` without `select`).
- Project mentions route likely leaks message content across rep scope.
- CSRF strategy undocumented (relies on SameSite cookie defaults).

---

## 4. Privacy — B

**Strengths**
- `/legal/terms` + `/legal/privacy` live (78 L each).
- Logger scrubs PII before Vercel drain.
- AuditLog is immutable, snapshots `actorEmail` at time of action.

**Weaknesses**
- No `/api/users/[id]/export` or `/erase` handler — policy promises these.
- AuditLog retention cron (2-year rotation in policy) not implemented.
- Erasure path not defined — "anonymize" behavior not coded.
- No DPA documentation for Clerk/Turso/Vercel subprocessors.

---

## 5. Code Structure — A

**Strengths**
- **Zero `: any`** across `app/` + `lib/`.
- `tsconfig.strict: true`, typecheck in CI path.
- Naming conventions consistent throughout.
- Minimal duplication post-refactor; `+$0.10/W` setter premium now mostly schema-driven.

**Weaknesses**
- 1 outstanding TODO in pricing path (`lib/data.ts` line ~1313: verify One Source + Pacific Coast baselines).
- Comment density low in complex logic (`project-transitions.ts` — 694 L, ~5–10 comments).
- Possible dead context methods (`updateTrainerAssignmentUI`) with no call sites.
- No ESLint `no-unused-vars` rule configured.

---

## 6. Efficiency — B

**Strengths**
- No N+1 queries; API handlers use `include` for joined data in single round-trip.
- Indexes cover all high-cardinality filter/join columns.
- 40+ `useCallback` usages mitigate child re-renders.

**Weaknesses**
- **Entire dashboard is `'use client'`** via layout directive → no RSC / PPR / partial hydration benefit.
- Dashboard pages 1.5–2K lines shipped as client JS.
- No `next/image` optimization; no lazy loading; no list virtualization.
- Eager includes on list endpoints (`/api/projects`) will scale poorly past ~500 projects.
- Broad context subscription surface — any payroll state change re-renders all `useApp()` consumers.

---

## Inventory Snapshot

- **TS/TSX source files:** 217
- **Source LOC:** ~42.9K
- **API routes:** 44
- **Prisma models:** 26
- **Test files:** 11 (unit + integration + e2e)
- **`any` usages:** 0
- **TODO/FIXME:** 1

### Biggest source files
1. `app/dashboard/projects/[id]/page.tsx` — 1,963 L
2. `app/dashboard/page.tsx` — 1,620 L
3. `app/dashboard/new-deal/page.tsx` — 1,562 L
4. `app/dashboard/payroll/page.tsx` — 1,542 L
5. `lib/data.ts` — ~1,580 L
6. `lib/context/project-transitions.ts` — 694 L

---

## Closed Since 2026-03-27 Review

| March finding | Status |
|---|---|
| CRIT-01 No auth | ✅ Clerk + Middleware |
| CRIT-02 No persistence | ✅ Prisma + Turso |
| CRIT-03 Client-only RBAC | ✅ `lib/api-auth.ts` per-route |
| CRIT-04 Negative commissions | ✅ Floor at 0 |
| CRIT-05 Double-pay | ✅ Idempotency keys |
| MAJ-02 God-file | ✅ Domain split |
| MAJ-11 No tests | ✅ Vitest + Playwright |
| MAJ-12 No deploy config | ✅ Vercel live |
| MIN-04 Error boundaries | ✅ `app/dashboard/error.tsx` |

---

## Path to A Across the Board

Proposed phase plan (Phase 1 already shipped, Phase 2 WIP):

- **Phase 2 (finish WIP)** — Commit audit log system, form validation tests, StrictMode fix. Review uncommitted diff for scope creep.
- **Phase 3 — Logic hardening** — Trainer override % cap, split-sum validation, explicit rounding in `calculateCommission`.
- **Phase 4 — Security hardening** — Rate limiting (Vercel KV or in-memory), field-level `select` on all response paths, CSRF doc + test, scope mentions/messages.
- **Phase 5 — Privacy completion** — `/api/users/[id]/export`, `/erase` with anonymization, AuditLog retention cron, DPA docs.
- **Phase 6 — Efficiency** — Carve dashboard layout off `'use client'`, adopt RSC + Server Actions for reads, virtualize list views, `next/image`, prune eager includes in list endpoints.
- **Phase 7 — Structure polish** — Split `lib/data.ts` into `lib/types/`, `lib/seed/`, finalize `lib/pricing/`. Break dashboard pages into component trees <500 L each.
- **Phase 8 — Pre-launch gates** — Pen-test pass, load test at 100 concurrent, legal review of policy pages.
- **Phase 9 — Engineering excellence** — Targeted additions that genuinely strengthen the app (not checkbox theater):
  1. **Decimal money type** (`dinero.js` or `decimal.js`) — migrate all commission/payroll/pricing numbers off JS floats.
  2. **Zod schemas** on every API route — body + response, with inferred TS types.
  3. **Sentry** + Vercel Web Vitals — error tracking + RUM.
  4. **Security headers** — CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy via `next.config.ts`.
  5. **Reversible migrations** — add `down()` to each `scripts/migrate-*.mjs`; run a documented restore drill from a Turso snapshot.
  6. **Renovate bot** + protected main branch (required checks: typecheck, lint, test).
  7. **Property-based tests** on `calculateCommission` (fast-check) — fuzz inputs, assert invariants (never negative, never NaN, rounds to cent).
  8. **Runbooks** — `docs/runbooks/{payroll-didnt-publish, commission-wrong, turso-down, clerk-down}.md`.

Explicitly skipped (over-engineering for current scale): distributed tracing, mutation testing, Storybook, i18n scaffolding, OpenAPI gen, tRPC migration, SBOM, tamper-evident audit hashing, double-entry reconciliation, status page, customer changelog.

Estimated: ~2–3 weeks of focused work to land Phases 2–8; Phase 9 adds ~1 week.
