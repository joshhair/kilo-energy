# Kilo Energy — Architecture & Design Review

**Reviewer:** Senior QA Architect
**Date:** 2026-03-27
**Scope:** Full codebase architectural and design review (no implementation changes)

---

## Executive Summary

Kilo Energy is a well-presented Next.js 16 internal portal with polished UI work, thoughtful
component decomposition, and several genuinely well-engineered hooks and utilities. However, the
application has critical architectural gaps that make it unsuitable for production use in its
current form: there is no real authentication, no persistence layer, and no server-side security
boundary. Beyond those blockers, a handful of major design issues — most notably a God-context, a
God-file, and three competing pricing systems — will compound into serious maintenance pain as the
app grows. These items are enumerated and rated below.

---

## Rating Legend

| Rating | Meaning |
|--------|---------|
| 🔴 **Critical** | Production blocker; data integrity or security risk |
| 🟠 **Major** | Will cause real pain at scale; should be addressed before launch |
| 🟡 **Minor** | Technical debt; manageable short-term but should be tracked |
| 🔵 **Suggestion** | Improvement opportunity; no urgency |

---

## 1. Technology Stack Assessment

### Are the chosen technologies appropriate?

**Next.js 16 + React 19 + TypeScript 5 — Appropriate.**
The App Router model is the right foundation for a multi-route internal portal. TypeScript is used
consistently and meaningfully throughout. Tailwind CSS v4 is modern and fits the use case.

**React Context API for global state — Appropriate *for now*, but already straining.**
Context is a valid choice for a small, internal single-user-at-a-time SPA. The existing code,
however, has already pushed a single context far beyond what it was designed to carry (see §3.1).

**No database, no API — Inappropriate for this use case. (See §2.1 and §2.2 below.)**

---

## 2. Critical Findings

### 2.1 🔴 No Authentication — The Login Screen Is Purely Cosmetic

**File:** `app/page.tsx`, `lib/context.tsx`

The "login" page presents two buttons: "Rep Login" (pick a name from a dropdown) and "Admin Login"
(one click, no credentials). Both call `setRole()` in `context.tsx`, which does nothing more than
set three `useState` values:

```ts
// lib/context.tsx line 359-363
const setRole = (role: Role, repId?: string, repName?: string) => {
  setCurrentRole(role);
  setCurrentRepId(repId ?? null);
  setCurrentRepName(repName ?? null);
};
```

There is no password, no session token, no cookie, no JWT, and no server-side check. Any user who
opens the app in a browser can click "Admin Login" and gain full admin access to every rep's
commission data, payroll records, and settings — instantly. The route guard in
`app/dashboard/layout.tsx` only checks `if (!currentRole) router.push('/')`, which is also
client-side and trivially bypassed by setting `currentRole` in the browser's React DevTools.

**Impact:** All commission and payroll data is accessible to any user. For an internal financial
system this is a serious security risk.

**Required fix:** Implement real authentication (NextAuth / Clerk / custom JWT with
`httpOnly` cookies) with server-side session validation before any dashboard route renders.

---

### 2.2 🔴 No Persistence — Every Page Refresh Loses All Data

**Files:** `lib/context.tsx` lines 83–97, `lib/data.ts` (entire file)

Every piece of application state is initialized from in-memory seed constants:

```ts
// lib/context.tsx lines 83-95
const [projects,         setProjects]         = useState<Project[]>(PROJECTS);
const [payrollEntries,   setPayrollEntries]   = useState<PayrollEntry[]>(PAYROLL_ENTRIES);
const [reimbursements,   setReimbursements]   = useState<Reimbursement[]>(REIMBURSEMENTS);
const [trainerAssignments, setTrainerAssignments] = useState(TRAINER_ASSIGNMENTS);
// … etc.
```

When a user adds a deal, updates a project phase, or marks payroll as Paid, those changes exist
only in React state for the lifetime of the browser tab. Refreshing the page resets everything to
seed data. There are no API routes, no database connections, no `localStorage` fallback, and no
server actions anywhere in the codebase.

**Impact:** The application cannot be used to track real commissions or payroll. Any data entered
is lost immediately on refresh. This is the most significant architectural omission.

**Required fix:** Introduce a persistence layer. Options in increasing complexity:
- Minimal: `localStorage` or `IndexedDB` via a thin persistence hook (suitable for a single-user
  offline tool only).
- Production: A database (PostgreSQL via Prisma, Supabase, PlanetScale) with Next.js API routes
  or Server Actions, protected by authentication middleware.

---

### 2.3 🔴 Role-Based Access Control Is Entirely Client-Side

**File:** `app/dashboard/layout.tsx` lines 174–178, multiple page files

Route and feature guarding is done by reading `currentRole` from context and either redirecting or
hiding UI elements. Example from `payroll/page.tsx`:

```ts
const { currentRole, currentRepId, payrollEntries, … } = useApp();
```

Pages filter data based on `currentRepId` clientside. There is no middleware, no server component
that validates the session, and no API endpoint that enforces role before returning data. A rep
can change `currentRole` to `'admin'` via DevTools and immediately see all reps' payroll data.

**Impact:** All rep-level data isolation is bypassable. Admin-only features (payroll management,
settings, full rep list) are accessible by any authenticated-looking client state.

---

## 3. Major Findings

### 3.1 🟠 God-Context — Single Provider Manages the Entire Application

**File:** `lib/context.tsx`

`AppProvider` is a single React Context that holds **every** piece of application state and
exposes **40+ functions and state slices** through a single `useApp()` hook. The
`AppContextType` interface (lines 11–75) spans 64 lines of type definitions alone.

**Problems:**

1. **Performance:** Any state change anywhere causes all `useApp()` consumers to re-render.
   A phase update on a project triggers re-renders in the sidebar, dashboard KPI cards, payroll
   page, vault page, and rep leaderboard simultaneously — even when only the project detail page
   cares.

2. **Leaked setter coupling:** The context exposes raw React `Dispatch` setters
   (`setProjects`, `setPayrollEntries`, `setReimbursements`, `setTrainerAssignments`,
   `setIncentives`) alongside the domain-level mutations. Any component can bypass all business
   logic by calling `setProjects([])` directly. This is particularly dangerous for payroll
   entries where the status transition (`Draft → Pending → Paid`) has business rules.

3. **Cross-concern side effects:** `updateProject()` (lines 155–226) calls `setPayrollEntries`
   inside `setProjects`'s updater function. This nested-state-setter pattern is technically valid
   in React but creates hidden coupling: `updateProject` silently creates payroll entries as a
   side effect. This is not visible from the call site and will be a debugging trap.

4. **Scalability:** Adding a new domain entity (e.g., "Customer contact log") means adding more
   state to this already-large provider, widening the performance problem.

**Recommended fix:** Decompose into domain-scoped contexts or a lightweight state library
(Zustand slices, or separate `ProjectContext`, `PayrollContext`, `RepContext`). Never expose raw
setter functions publicly — only expose domain-level mutation functions.

---

### 3.2 🟠 God-File — `lib/data.ts` Is Types, Seed Data, and Business Logic Combined

**File:** `lib/data.ts` (18,000+ tokens; ~1,300+ lines)

This single file contains:
- Type/interface definitions (15+ interfaces)
- Seed/fixture data (15 projects, 8 payroll entries, reimbursements, trainer assignments,
  incentives, 12 installers, 12 financers, pricing versions)
- Business logic functions (`calculateCommission`, `getBaselineRate`, `getSolarTechBaseline`,
  `getProductCatalogBaseline`, `getInstallerRatesForDeal`, `getActiveInstallerVersion`,
  `getTrainerOverrideRate`, `computeIncentiveProgress`, `formatIncentiveMetric`)
- Large constant tables (`BASELINE_RATES` — 40 rows, `SOLARTECH_PRODUCTS` — 20+ entries,
  `INSTALLER_PRICING_VERSIONS`)

**Problems:**

1. **Impossible to unit-test in isolation.** To test `calculateCommission`, you import the entire
   seed dataset.
2. **Circular-dependency risk.** Several pages import specific symbols from `data.ts` to avoid
   re-importing everything, but as the file grows the import graph becomes unwieldy.
3. **Mixing concerns.** Seed fixtures should never live in the same module as domain logic
   functions. When a real database is added, the seed data will need to be extracted anyway.

**Recommended split:**
```
lib/
  types/         ← pure TypeScript interfaces and enums
  seed/          ← development/test fixtures only
  pricing/       ← commission calculation + installer rate logic
  incentives/    ← incentive progress logic
  utils.ts       ← formatting helpers (already correct)
```

---

### 3.3 🟠 Three Competing Pricing Systems for the Same Domain

**File:** `lib/data.ts` lines 626–1170

The application has five partially-overlapping systems for resolving installer/commission
baselines:

| System | Location | Status |
|--------|----------|--------|
| `BASELINE_RATES` (financer+productType+kW) | lines 639–695 | Legacy / backward-compat only |
| `NON_SOLARTECH_BASELINES` (flat per-installer) | lines 1089–1102 | Fallback |
| `INSTALLER_PRICING_VERSIONS` (versioned date-effective) | lines 1112–1124 | Current standard |
| `SOLARTECH_PRODUCTS` (per-product, per-kW-tier) | lines 760–971 | SolarTech-specific |
| `PRODUCT_CATALOG_*` (generalized SolarTech model) | lines 1035–1088 | In progress, empty |

`getBaselineRate()` (line 700) has the comment: *"NOTE: This generic lookup is kept for backward
compat. For new deals, use getSolarTechBaseline() for SolarTech or getNonSolarTechBaseline() for
others."* — meaning `BASELINE_RATES` is already dead code that hasn't been removed.

`NON_SOLARTECH_BASELINES` (line 1089) duplicates the data already in
`INSTALLER_PRICING_VERSIONS` (line 1112). The comment in `getInstallerRatesForDeal()` at line
1153 falls back to `NON_SOLARTECH_BASELINES` if no version is found, creating a silent secondary
source of truth.

`PRODUCT_CATALOG_INSTALLER_CONFIGS` and `PRODUCT_CATALOG_PRODUCTS` are both empty (`{}` and `[]`
respectively, lines 1062–1063), yet the context exposes 8 functions to manage them. This is a
partially-implemented feature shipped with a full API surface but no backing data.

**Impact:**
- A bug in commission calculation could have three different root causes across three different
  rate-lookup paths.
- Historical pricing correctness depends on which lookup path a given project was created with,
  which is stored as optional fields (`solarTechProductId`, `pricingVersionId`,
  `installerProductId`) — three optional FK columns on `Project` for three different pricing
  regimes.
- `TODO` comment in seed data at line 1099: *"TODO: verify One Source and Pacific Coast baselines
  in Glide admin"* — unresolved data quality issue embedded in production code path.

**Recommended fix:** Converge on a single pricing model. The `InstallerPricingVersion` system with
`InstallerRates` (flat | tiered) appears to be the intended endgame. Migrate SolarTech to the
`ProductCatalog` model (which was clearly designed as SolarTech's successor), deprecate and remove
`BASELINE_RATES` and the parallel `NON_SOLARTECH_BASELINES`, and ensure `Project` carries a single
`pricingSnapshotId` foreign key.

---

### 3.4 🟠 Data Denormalization Without Enforcement

**Files:** `lib/data.ts` lines 117–148 (`Project`), 150–162 (`PayrollEntry`)

Both `Project` and `PayrollEntry` store `repName: string` alongside `repId: string`:

```ts
// Project
repId: string;
repName: string;   // ← denormalized
setterId?: string;
setterName?: string; // ← denormalized

// PayrollEntry
repId: string;
repName: string;   // ← denormalized
```

If a rep's name is changed in `context.tsx` via `updateRepType` or future edit functionality, all
historical `Project` and `PayrollEntry` records remain stale. There is no reconciliation logic.
Currently harmless in memory, but this pattern will cause data integrity issues when persistence
is added.

**Recommended fix:** Store only `repId`. Resolve `repName` at read time by joining with the
`reps` collection. In a database this is a FK join; in memory it is a single `.find()`.

---

### 3.5 🟠 `addDeal()` Has Seven Completely Unused Parameters

**File:** `lib/context.tsx` lines 371–384

```ts
const addDeal = (
  project: Project,
  _closerM1: number,   // ← unused
  _closerM2: number,   // ← unused
  _setterM1 = 0,       // ← unused
  _setterM2 = 0,       // ← unused
  _trainerM1 = 0,      // ← unused
  _trainerM2 = 0,      // ← unused
  _trainerId?: string, // ← unused
) => {
  // Only add the project. Payroll entries are now auto-drafted when
  // milestone phases are reached (Acceptance → M1, Installed → M2).
  setProjects((prev) => [...prev, project]);
};
```

The underscore-prefixed parameters indicate abandoned logic: commission amounts were pre-computed
at deal-creation time and passed in, then the design was changed to auto-draft payroll on phase
transitions instead. The dead parameters were not removed. Every call site in `new-deal/page.tsx`
still passes these six numeric arguments that are silently ignored.

This is a correctness risk: callers may believe they are controlling payroll amounts via these
arguments when they are not.

---

### 3.6 🟠 All Dashboard Pages Opted Into Client-Side Rendering

**File:** `app/dashboard/layout.tsx` line 1

```ts
'use client';
```

The dashboard layout is a Client Component. In Next.js App Router, marking a layout as
`'use client'` means all child pages that don't explicitly declare `'use server'` are treated as
client components as well. Combined with the `AppProvider` being the very first wrapper in
`app/layout.tsx`, the entire application is effectively a traditional client-rendered SPA —
negating server streaming, React Server Components, and partial hydration benefits that Next.js
App Router was designed to provide.

This is currently unavoidable given the architecture (all data lives in client context), but it
means the team receives no benefit from choosing Next.js App Router over simpler alternatives
like Vite + React Router.

---

## 4. Minor Findings

### 4.1 🟡 Redirect-Only Pages Are Navigation Debt

**Files:** `app/dashboard/admin/page.tsx`, `app/dashboard/export/page.tsx`,
`app/dashboard/reimbursement/page.tsx`, `app/dashboard/resources/page.tsx`

Four routes exist solely to redirect to other routes:
- `/dashboard/admin` → `/dashboard/settings`
- `/dashboard/export` → `/dashboard/settings`
- `/dashboard/reimbursement` → `/dashboard/earnings`
- `/dashboard/resources` → `/dashboard/settings`

These suggest URLs that were once different, or placeholders for future pages. They add confusion
to the route tree and should be removed or replaced with proper Next.js `permanentRedirect()`
calls in `next.config` if backward-compatibility is needed.

---

### 4.2 🟡 Duplicated Color/Style Maps Across Pages

**Files:** `app/dashboard/page.tsx` line 18, `app/dashboard/payroll/page.tsx` line 17

`ACCENT_COLOR_MAP` (mapping Tailwind gradient strings to RGBA values for CSS custom properties)
is copy-pasted in at least two pages:

```ts
// Defined identically in dashboard/page.tsx AND payroll/page.tsx
const ACCENT_COLOR_MAP: Record<string, string> = {
  'from-blue-500 to-blue-400': 'rgba(59,130,246,0.08)',
  // …
};
```

Similarly, pipeline phase color maps are described in `dashboard/page.tsx` line 79 as:
*"mirrors PHASE_PILL in projects/page.tsx"* — documented duplication. These should be extracted
to a shared `lib/colors.ts` or `lib/theme.ts` constant module.

---

### 4.3 🟡 Date/Period Utility Functions Defined Locally in Page Components

**File:** `app/dashboard/page.tsx` lines 28–75

`isInPeriod()`, `isInPreviousPeriod()`, `isThisWeek()`, and `isThisMonth()` are defined as
local functions inside the dashboard page module. The same date-range logic is likely needed
(or duplicated) in other pages. These belong in `lib/utils.ts` alongside the existing
`formatDate` and `isInDateRange`.

---

### 4.4 🟡 ID Generation Uses `Date.now()` — Collision-Prone

**File:** `app/dashboard/new-deal/page.tsx` line 43

```ts
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}
```

`Date.now()` has millisecond resolution. Two deals submitted within the same millisecond (possible
in automated tests or rapid form submission) would generate duplicate IDs. When this moves to a
real database, this pattern must be replaced with UUIDs (`crypto.randomUUID()`) or
database-generated primary keys.

---

### 4.5 🟡 Pay Date Logic Is Scattered

**Files:** `lib/utils.ts` (lines 29–59), `app/dashboard/vault/page.tsx` (lines 16–33)

`getM1PayDate()` and `getM2PayDate()` are correctly defined in `lib/utils.ts`, but `vault/page.tsx`
defines its own local `getNextFriday()` and `getFridayForDate()` helpers that partially overlap.
The vault page imports `getM1PayDate`/`getM2PayDate` from utils but also defines its own Friday
calculation. This redundancy will drift if pay schedule logic changes.

---

### 4.6 🟡 Unresolved TODO in Production Data Path

**File:** `lib/data.ts` line 1099

```ts
// TODO: verify One Source and Pacific Coast baselines in Glide admin
'One Source':    { closerPerW: 2.90, kiloPerW: 2.35 },
'Pacific Coast': { closerPerW: 2.90, kiloPerW: 2.35 },
```

This TODO is in the rate table that directly feeds commission calculations. If these baselines
are wrong, reps for One Source and Pacific Coast deals are being shown incorrect commission
numbers. This is a data quality issue embedded in production code.

---

## 5. Suggestions

### 5.1 🔵 Extract Commission Logic to a Dedicated Module

`calculateCommission()` (line 1170) is a pure function — excellent. But it lives in `data.ts`
alongside seed fixtures. Moving it and the related rate-lookup functions (`getInstallerRatesForDeal`,
`getSolarTechBaseline`, etc.) to a dedicated `lib/pricing.ts` or `lib/commission.ts` would allow
unit testing in complete isolation, without importing the 1,300-line data file.

---

### 5.2 🔵 `useIsHydrated` Is Well-Implemented but the Subscribe Noop Needs a Comment

**File:** `lib/hooks.ts` lines 10–19

```ts
function subscribe(_cb: () => void): () => void {
  return () => {};
}
```

The empty `subscribe` function is intentional (the store never changes; we just want the
server/client snapshot distinction), but this pattern is non-obvious to future maintainers. The
existing JSDoc explains *what* the hook does but not *why* the subscribe is empty. A one-line
comment at the subscribe declaration would prevent confusion.

---

### 5.3 🔵 `nav-items.ts` Circular-Dependency Workaround Reveals Underlying Coupling

**File:** `lib/nav-items.ts`, `app/dashboard/layout.tsx` lines 17–27

The layout file re-exports everything from `lib/nav-items.ts` while also importing from it
directly in the same file:

```ts
// Re-export nav definitions so external modules can import them from layout.
export { REP_NAV, ADMIN_NAV } from '../../lib/nav-items';
// Local imports — only what is directly referenced in this file.
import { REP_NAV, ADMIN_NAV } from '../../lib/nav-items';
```

This is a workaround for a circular import between `layout.tsx` and `command-palette.tsx`.
The proper solution is to ensure that `command-palette.tsx` imports only from `lib/nav-items.ts`
directly, not from `layout.tsx`. The re-export in layout is confusing and unnecessary.

---

### 5.4 🔵 The Setter `+$0.10/W` Rule Is a Magic Constant

**Files:** `lib/data.ts` lines 755, 1072, `lib/context.tsx` lines 301, 321

The rule `setterPerW = closerPerW + 0.10` appears hardcoded in at least four places:

```ts
setterPerW: Math.round((c + 0.10) * 100) / 100,         // data.ts makeTiers
setterPerW: Math.round((c + 0.10) * 100) / 100,         // data.ts makeProductCatalogTiers
...(updates.closerPerW !== undefined ? { setterPerW: Math.round((updates.closerPerW + 0.10) * 100) / 100 } : {})  // context.tsx x2
```

This business rule should be a named constant:

```ts
const SETTER_PREMIUM_PER_W = 0.10; // Setter earns $0.10/W more than Closer
```

Scattered magic numbers are a maintenance liability if the premium ever changes.

---

### 5.5 🔵 Settings Page `NavItem` Type Shadows the Global `NavItem` Type

**File:** `app/dashboard/settings/page.tsx` lines 22–23

```ts
type NavItem = { id: SettingsSection; label: string; icon: … };
type NavGroup = { group: string; items: NavItem[] };
```

This locally-defined `NavItem` type shadows the `NavItem` exported from `lib/nav-items.ts`. If
a developer imports or copies code between files they may silently use the wrong type. Rename
the local type to `SettingsNavItem` to avoid confusion.

---

## 6. Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 2.1 | No real authentication | 🔴 Critical | `app/page.tsx`, `lib/context.tsx` |
| 2.2 | No data persistence | 🔴 Critical | `lib/context.tsx`, `lib/data.ts` |
| 2.3 | Client-only RBAC | 🔴 Critical | `app/dashboard/layout.tsx`, all pages |
| 3.1 | God-context with 40+ members | 🟠 Major | `lib/context.tsx` |
| 3.2 | God-file mixing types/data/logic | 🟠 Major | `lib/data.ts` |
| 3.3 | Three competing pricing systems | 🟠 Major | `lib/data.ts` |
| 3.4 | Denormalized `repName` on records | 🟠 Major | `lib/data.ts`, `lib/context.tsx` |
| 3.5 | `addDeal()` has 7 unused parameters | 🟠 Major | `lib/context.tsx` |
| 3.6 | All pages are client-rendered | 🟠 Major | `app/dashboard/layout.tsx` |
| 4.1 | Redirect-only dead routes | 🟡 Minor | `dashboard/admin`, `export`, etc. |
| 4.2 | Duplicated color maps | 🟡 Minor | `dashboard/page.tsx`, `payroll/page.tsx` |
| 4.3 | Date utilities defined in page components | 🟡 Minor | `dashboard/page.tsx` |
| 4.4 | `Date.now()` ID generation | 🟡 Minor | `new-deal/page.tsx` |
| 4.5 | Scattered pay date logic | 🟡 Minor | `utils.ts`, `vault/page.tsx` |
| 4.6 | TODO in production rate table | 🟡 Minor | `lib/data.ts:1099` |
| 5.1 | Commission logic in data file | 🔵 Suggestion | `lib/data.ts` |
| 5.2 | Noop subscribe needs comment | 🔵 Suggestion | `lib/hooks.ts` |
| 5.3 | Redundant nav re-export in layout | 🔵 Suggestion | `app/dashboard/layout.tsx` |
| 5.4 | Setter +$0.10/W is a magic constant | 🔵 Suggestion | `lib/data.ts`, `lib/context.tsx` |
| 5.5 | Local `NavItem` shadows global type | 🔵 Suggestion | `settings/page.tsx` |

---

## 7. Prioritized Roadmap

### Phase 1 — Production Blockers (before any real user data is entered)
1. Add real authentication (NextAuth, Clerk, or custom JWT + `httpOnly` session cookie).
2. Add a persistence layer (database + Prisma/Drizzle + Next.js API routes or Server Actions).
3. Move role enforcement to server-side middleware; never trust client-supplied role claims.

### Phase 2 — Structural Improvements (before the codebase grows further)
4. Split `lib/data.ts` into `lib/types/`, `lib/seed/`, and `lib/pricing/`.
5. Decompose `AppProvider` into domain-scoped contexts or Zustand slices; remove all raw setters
   from the public API.
6. Converge the three pricing systems onto `InstallerPricingVersion` + `ProductCatalog`.
7. Remove denormalized `repName`/`setterName` strings from `Project` and `PayrollEntry`; resolve
   at read time.
8. Remove dead parameters from `addDeal()`.

### Phase 3 — Debt Cleanup (ongoing)
9. Remove or formalize the four redirect-only pages.
10. Extract shared color/style maps to a shared constants file.
11. Move date-range utility functions to `lib/utils.ts`.
12. Replace `Date.now()` ID generation with `crypto.randomUUID()`.
13. Name the `SETTER_PREMIUM_PER_W` constant.
14. Resolve the `TODO` on One Source and Pacific Coast baselines.

---

*This review covers architecture and design only. No code was modified.*
