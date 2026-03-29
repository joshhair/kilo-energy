# Kilo Energy — Consolidated Plan Review

> Reviews synthesized: Architecture & Design · Risk & Edge Cases · Feasibility & Sequencing
> Date: 2026-03-27

---

## 1. Executive Summary

Kilo Energy is a well-conceived solar sales commission and payroll management tool with a clean UI and a working prototype that demonstrates the intended workflows clearly. However, the current implementation is a **client-only prototype** that is not suitable for production use in its present state. Authentication is entirely cosmetic, all data lives in memory and resets on every page refresh, and all access control can be bypassed in seconds via browser DevTools. The core business logic (commission calculation, payroll lifecycle, pricing) is tangled into a single 1,300-line file alongside seed data and type definitions, making safe parallel development impossible. A realistic estimate to bring this prototype to a production-ready state is **13–20 weeks** for one experienced developer, or roughly 8–12 weeks with a small team, assuming auth, persistence, and the data-layer split are tackled first.

---

## 2. Critical Issues

*Must be resolved before any real user data is introduced or the application is deployed.*

---

### CRIT-01 — No Authentication Backend
**Severity:** 🔴 Critical
**Original refs:** Architecture #1 · RISK-SEC-01 · RISK-SEC-02 · Feasibility #1

The login screen is a UI facade. `setRole()` writes three `useState` values; there are no credentials, no tokens, no sessions, and no server-side session validation anywhere. Any visitor can reach the admin dashboard in one click, view all financial records, approve reimbursements, mark payroll as Paid, and create deals. Client-side `useEffect` + `router.replace()` redirects are also broken-by-design in Next.js App Router — protected content can flash before the redirect fires.

**Fix:** Implement a real auth provider (NextAuth.js / Clerk / Auth.js) with server-side session validation. Replace client-side redirects with Next.js Middleware or server-side `redirect()`. All role checks must be re-validated on the server for every protected route and API call.

---

### CRIT-02 — No Data Persistence
**Severity:** 🔴 Critical
**Original refs:** Architecture #2 · RISK-DATA-01 · RISK-DATA-02 · Feasibility #2

Every state value (`projects`, `payrollEntries`, `commissions`, `repProfiles`, etc.) is initialized from in-memory seed constants in `lib/data.ts`. A page refresh silently resets all work. There are zero API routes, no database, and no `localStorage` fallback. Multiple browser tabs operate on completely separate, diverging state trees. An admin who marks 20 payroll entries as Paid and then refreshes loses all of that work.

**Fix:** Choose a database (e.g., PostgreSQL via Prisma or Drizzle), define a schema, implement Next.js API routes or Server Actions for all mutations, and migrate the context layer to async read/write patterns. This is effectively a near-complete rewrite of the data layer and should be planned as the largest single work item.

---

### CRIT-03 — Client-Only Role-Based Access Control
**Severity:** 🔴 Critical
**Original refs:** Architecture #3 · RISK-SEC-02 · RISK-SEC-03 · Feasibility #4 · Feasibility #7

All RBAC is enforced exclusively in React context and client-side nav filtering. Opening DevTools and mutating `currentRole` grants instant privilege escalation. `/dashboard/reps/[any-id]` is accessible without ownership scoping — any rep can view any other rep's financial data by manipulating the URL. There is no server-side enforcement at any layer.

**Fix:** Move all access control to the server. Use Next.js Middleware for route protection, validate session roles in every Server Action and API route, and scope rep-level pages to the authenticated user's ID on the server.

---

### CRIT-04 — Negative Commissions Allowed Silently
**Severity:** 🔴 Critical
**Original refs:** RISK-COMM-01

When `soldPPW < baselinePerW`, commission math produces a negative dollar amount. This negative value flows into payroll entries with no guard, no warning, and no rejection. Negative payroll entries can be drafted and marked as Paid, meaning the system will silently record that a rep owes the company money without any approval gate.

**Fix:** Add input validation and business-rule guards in the commission calculation layer to reject or flag any deal where the sold price falls below baseline. Negative-commission entries must require explicit admin override with an audit note.

---

### CRIT-05 — No Double-Pay Prevention
**Severity:** 🔴 Critical
**Original refs:** RISK-PAY-01 · RISK-DATA-01

Because state is in-memory and there is no persistence layer, a payroll run can be re-drafted and re-paid in full after a page refresh. There is no idempotency key, no paid-period lock, and no database record preventing reissue.

**Fix:** Persist payroll entries with a unique constraint per (project, milestone, period). Mark paid entries as immutable once confirmed. Implement a payroll period close mechanism that prevents retroactive re-drafting.

---

## 3. Major Issues

*Strongly recommended fixes — these create significant risk or technical debt if left unresolved.*

---

### MAJ-01 — God-Context (`lib/context.tsx`)
**Severity:** 🟠 Major
**Original refs:** Architecture #4 · RISK-PERF-03 · Feasibility #6

A single `AppProvider` exposes 40+ state slices and functions — including raw `Dispatch` setters — to the entire component tree. Any state change triggers a full-tree re-render. Raw setters bypass all business-rule enforcement (e.g., `setPayrollEntries` can re-open a Paid entry). Cross-state mutations inside updater functions (e.g., payroll creation inside `setProjects`) are a React anti-pattern and will behave incorrectly under concurrent rendering.

**Fix:** Split context by domain (projects, payroll, reps, pricing). Replace raw dispatch setters with domain-scoped action functions that enforce business rules. Consider Zustand or a similar lightweight state library.

---

### MAJ-02 — God-File (`lib/data.ts`)
**Severity:** 🟠 Major
**Original refs:** Architecture #5 · Feasibility #3

`lib/data.ts` is 1,300+ lines combining TypeScript types and interfaces, 15 projects of seed data, 20+ pricing entries, 10+ business logic functions, dead legacy constants, and in-progress empty catalogs — all in one file. It is loaded on every page including the login screen. This makes parallel development dangerous and impossible to tree-shake.

**Fix:** Split immediately into at minimum: `types/`, `lib/seed/`, `lib/pricing/`, `lib/commission/`. This is a prerequisite for any parallel feature work.

---

### MAJ-03 — Three Competing Pricing Systems
**Severity:** 🟠 Major
**Original refs:** Architecture #6 · RISK-COMM-04 · RISK-COMM-05

Five separate pricing structures coexist: `BASELINE_RATES` (dead/legacy), `NON_SOLARTECH_BASELINES` (fallback), `INSTALLER_PRICING_VERSIONS` (current), `SOLARTECH_PRODUCTS` (special-case), and `PRODUCT_CATALOG_*` (empty, in-progress). There is a production `TODO` comment inside the live rate table. Missing baselines return `undefined`, which flows silently into commission math as `NaN`. Date gaps in pricing version history produce undefined baselines with no error thrown.

**Fix:** Consolidate to a single versioned pricing source of truth. Add guards that throw (or return a typed error) when a baseline lookup fails, rather than silently propagating `NaN`.

---

### MAJ-04 — Dead `addDeal()` Parameters
**Severity:** 🟠 Major
**Original refs:** Architecture #8

Seven underscore-prefixed parameters in `addDeal()` are silently ignored. Callers believe they are controlling payroll amounts by passing these values, but they have no effect. This is a silent contract violation that will cause incorrect payroll amounts in any caller that relies on those parameters.

**Fix:** Either implement the parameters or remove them and update all call sites. Document the intended behavior explicitly.

---

### MAJ-05 — Data Denormalization
**Severity:** 🟠 Major
**Original refs:** Architecture #7

`repName` and `setterName` are duplicated as strings on every `Project` and `PayrollEntry` record. There is no reconciliation logic. If a rep's name is updated, all historical records remain stale. Rep deletion orphans all associated projects, payroll entries, and trainer records with no cascade or soft-delete.

**Fix:** Normalize to rep IDs as foreign keys. Resolve display names at read time. Implement referential integrity (cascade soft-delete or block deletion when records exist).

---

### MAJ-06 — Trainer Override Uncapped
**Severity:** 🟠 Major
**Original refs:** RISK-COMM-03

The trainer override percentage has no upper bound. A trainer override can be set high enough to exceed the closer's margin, producing negative pay for the closer. There is no validation that closer + setter + trainer splits sum to 100% or less.

**Fix:** Validate that all split percentages sum to ≤ 100%. Cap trainer override at a configurable maximum. Surface validation errors at the point of entry, not silently at payout.

---

### MAJ-07 — No Phase Transition State Machine
**Severity:** 🟠 Major
**Original refs:** RISK-LIFE-01 · RISK-LIFE-02

Any project can jump to any lifecycle phase without passing through intermediate steps. Post-M1 project edits do not update stale draft payroll amounts. There is no guard preventing a cancelled project from being drafted into payroll.

**Fix:** Implement a formal state machine for project phase transitions (e.g., `xstate` or a simple allowed-transitions map). Recalculate and flag stale payroll drafts when source project data changes.

---

### MAJ-08 — `soldDate` Stored as Unvalidated String
**Severity:** 🟠 Major
**Original refs:** RISK-LIFE-05

`soldDate` is stored as a raw, unvalidated string. Malformed or ambiguous date strings (e.g., `"13/01/2025"` vs `"01/13/2025"`) silently break all date-dependent math including pay date calculation and milestone sequencing.

**Fix:** Parse and validate dates at ingestion. Store as ISO 8601 strings or Unix timestamps. Use a date library (e.g., `date-fns`) consistently throughout.

---

### MAJ-09 — Manual Payments Bypass All Validation
**Severity:** 🟠 Major
**Original refs:** RISK-PAY-02

Manual bonus and payment entries bypass all commission validation and approval workflows. There is no audit trail for who created a manual entry or why.

**Fix:** Manual entries should require an admin role, a required justification field, and a separate approval step before being included in a payroll run.

---

### MAJ-10 — No Incentive Milestone Stability
**Severity:** 🟠 Major
**Original refs:** RISK-SPEC-05

Incentive milestones are recalculated retroactively when projects are edited. A rep who earned a milestone bonus can lose it silently if an admin edits the underlying project after the fact.

**Fix:** Snapshot milestone qualification at the point of achievement. Earned milestones should be immutable records, not live recalculations.

---

### MAJ-11 — Zero Testing Infrastructure
**Severity:** 🟠 Major
**Original refs:** Feasibility #11

There are no unit tests for commission calculation, no integration tests for payroll workflows, and no end-to-end tests. The `.gitignore` includes `/coverage`, suggesting tests were intended but never added. Financial calculation logic is untested in production.

**Fix:** Add unit tests for all commission and pricing functions immediately — before any refactoring. This is the safety net for the data-layer split. Use Vitest or Jest.

---

### MAJ-12 — No Deployment Configuration
**Severity:** 🟠 Major
**Original refs:** Feasibility #12

There is no Dockerfile, no Vercel/hosting configuration, no environment variable schema, and `next.config.ts` is empty. The app cannot be deployed without significant additional work.

**Fix:** Define environment variables, create a deployment config for the chosen hosting platform, and document required secrets (database URL, auth provider credentials, etc.).

---

## 4. Minor Issues & Suggestions

*Worth fixing but not blockers for a first production deployment.*

---

### MIN-01 — `Date.now()` ID Generation
**Original refs:** Architecture (noted) · RISK-DATA-03 · Feasibility #9
`Date.now()` IDs collide under rapid creation and are not safe in a multi-user environment. **Fix:** Use `crypto.randomUUID()` client-side, or generate UUIDs / auto-increment IDs in the database.

---

### MIN-02 — Duplicate Color Maps and Magic Constants
**Original refs:** Architecture (noted)
The `+$0.10/W` adder constant appears 4 times across the codebase. Installer-to-color mappings are duplicated in multiple components. **Fix:** Extract to named constants in a shared config file.

---

### MIN-03 — `NavItem` Type Name Collision
**Original refs:** Architecture (noted) · Feasibility #15
A local `NavItem` type in the dashboard layout shadows the globally defined type of the same name. **Fix:** Remove the local redefinition and import the shared type.

---

### MIN-04 — No Error Boundaries or Custom Error Pages
**Original refs:** RISK-ERR-01 · Feasibility #16
Any render error crashes the entire application. There is no `error.tsx`, no `not-found.tsx`, and no React Error Boundary. **Fix:** Add `error.tsx` and `not-found.tsx` at the app level; wrap major dashboard sections in Error Boundaries.

---

### MIN-05 — Auto-Dismiss Toasts for Critical Errors
**Original refs:** RISK-ERR-03
The 3.5-second auto-dismiss timeout is insufficient for financial error messages that require user acknowledgment. **Fix:** Errors involving money amounts should require explicit dismissal.

---

### MIN-06 — Cancelled/On-Hold Deals in Payroll Draft Queue
**Original refs:** RISK-LIFE-03
Cancelled and On Hold projects are not excluded from the active payroll draft queue. **Fix:** Filter by project status before populating the payroll draft.

---

### MIN-07 — Pay Date is Timezone-Dependent and Ignores Holidays
**Original refs:** RISK-COMM-07
Pay date calculation uses local `Date` arithmetic, which is timezone-sensitive and does not account for weekends or holidays. **Fix:** Use UTC-normalized date math and a simple holiday calendar for business-day adjustment.

---

### MIN-08 — `[id]` Routes Don't Call `notFound()`
**Original refs:** Feasibility #17
Dynamic route handlers (`/reps/[id]`, `/projects/[id]`) do not call `notFound()` for invalid IDs, returning an empty or broken UI instead of a proper 404. **Fix:** Add `notFound()` guards when the looked-up entity is undefined.

---

### MIN-09 — Reimbursement Receipt Upload Non-Functional
**Original refs:** RISK-REIMB-01
The receipt upload field renders but does not store files anywhere. **Fix:** Integrate a file storage provider (e.g., S3, Cloudflare R2, Vercel Blob) and validate uploads server-side.

---

### MIN-10 — Denied vs. Rejected Reimbursement States Undefined
**Original refs:** RISK-REIMB-03
The distinction between "Denied" and "Rejected" reimbursement statuses is not defined in business logic, and "Rejected" is unreachable through the current UI. **Fix:** Define and document both states or consolidate to a single terminal negative state.

---

### MIN-11 — M1 Always Assigned to Setter, No Override
**Original refs:** RISK-COMM-06
M1 commission is always routed to the setter with no override capability and no handling for the case where the setter has departed. **Fix:** Allow admin override of M1 assignment and handle the departed-setter case explicitly.

---

### MIN-12 — EXO vs. EXO (OLD) Installer Ambiguity
**Original refs:** RISK-SPEC-03
Two installer entries (`EXO` and `EXO (OLD)`) exist with no clear migration path or labeling of which is current. **Fix:** Deprecate the old entry explicitly and add a display note to the UI.

---

### MIN-13 — Floating-Point Commission Rounding Not Defined
**Original refs:** RISK-SPEC-08
No rounding strategy is defined for commission dollar amounts. Floating-point arithmetic may produce values like `$2,341.9999999`. **Fix:** Define and enforce a consistent rounding strategy (e.g., always round to nearest cent using `Math.round(x * 100) / 100`).

---

### MIN-14 — `repType` Not Enforced in Deal Creation
**Original refs:** RISK-SPEC-04
`repType` is not validated when a deal is created, allowing rep-type-specific commission rules to be applied incorrectly. **Fix:** Validate `repType` against the rep's profile at deal creation time.

---

## 5. Strengths

- **Well-defined business domain** — The commission model (closer/setter/trainer splits, M1/M2 milestones, pricing versions by installer and date) is clearly articulated in code and appears to accurately reflect real-world solar sales compensation structures.
- **Consistent, polished UI** — Tailwind-based component design is cohesive and professional. Dashboard layouts, rep cards, and payroll tables are well-structured and demonstrate clear product thinking.
- **Meaningful seed data** — The 15-project fixture dataset with varied statuses, installers, and rep assignments makes the prototype immediately demonstrable and testable.
- **Clear separation of roles** — The three-role model (Admin, Rep, Setter) maps naturally to the business workflows and provides a solid foundation for proper RBAC once the server-side layer is built.
- **Next.js App Router foundation** — Despite being entirely client-rendered today, the project is on the right framework to support Server Components, Server Actions, and Middleware-based auth once the data layer is introduced.
- **Readable, consistent code style** — TypeScript is used throughout, naming conventions are consistent, and component boundaries are reasonably well-drawn for a prototype.

---

## 6. Recommended Next Steps

Ordered by priority. Steps 1–4 are prerequisites for all subsequent work.

| Priority | Action | Rationale |
|----------|--------|-----------|
| **1** | **Split `lib/data.ts`** into `types/`, `lib/seed/`, `lib/pricing/`, `lib/commission/` | Unblocks all parallel development; prerequisite for testing |
| **2** | **Add unit tests for commission and pricing logic** | Safety net before any refactoring; catches regressions |
| **3** | **Implement authentication** (NextAuth.js or Clerk) with server-side session validation and Middleware-based route protection | Prerequisite for any real user data |
| **4** | **Design and implement the database schema** (PostgreSQL + Prisma or Drizzle) | Prerequisite for persistence and multi-user safety |
| **5** | **Replace context mutations with API routes / Server Actions** | Eliminates in-memory data loss and concurrency bugs |
| **6** | **Add negative commission guards and split-percentage validation** | Prevents financial calculation errors in production |
| **7** | **Implement payroll period close and double-pay prevention** | Required for financial integrity |
| **8** | **Add project phase state machine** | Prevents invalid lifecycle transitions |
| **9** | **Refactor monolithic AppContext into domain-scoped providers** | Eliminates cascading re-renders and raw-setter bypass risks |
| **10** | **Add deployment configuration and environment variable schema** | Required before any hosted environment |
| **11** | **Add Error Boundaries, `error.tsx`, and `not-found.tsx`** | Prevents full-app crashes from isolated errors |
| **12** | **Implement receipt file storage for reimbursements** | Completes the reimbursement workflow |
| **13** | **Address minor issues** (rounding, date normalization, toast dismiss, etc.) | Polish and correctness hardening |

---

*This report was generated by consolidating three independent review passes: Architecture & Design, Risk & Edge Cases, and Feasibility & Sequencing.*
