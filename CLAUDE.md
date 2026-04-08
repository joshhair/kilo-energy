# Kilo Energy — Project Guide

## What this is
Solar energy sales commission tracking app. Reps submit deals, admins manage payroll, pricing, and blitzes. Replaces a Glide Apps build.

## Commands
```bash
npm run dev          # Start dev server (localhost:3000)
npm test             # Run all unit + API tests (vitest)
npm run test:unit    # Unit tests only
npm run test:api     # DB integration tests only
npm run test:e2e     # Playwright E2E (auto-starts dev server)
npm run test:all     # Full suite + TypeScript type check
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npx prisma db push   # Push schema changes to local SQLite
npx prisma generate  # Regenerate Prisma client after schema changes
npx prisma db seed   # Seed the database
```

## Tech Stack
- **Next.js 16** (App Router) + **React 19** + **Tailwind CSS v4**
- **Prisma 7** with SQLite (local dev via better-sqlite3, production via Turso/libSQL)
- **Clerk** for authentication (middleware in `middleware.ts`)
- **TypeScript 5** (strict mode)
- **Vitest** for unit/integration tests, **Playwright** for E2E

## Architecture

### File Structure
```
app/
  page.tsx                    # Login — auto-resolves Clerk user to internal role
  dashboard/
    layout.tsx                # Sidebar + mobile nav, role-gated
    page.tsx                  # Dashboard (admin vs rep views)
    new-deal/                 # Deal submission form
    projects/                 # Project list + [id] detail
    payroll/                  # Admin payroll management
    blitz/                    # Blitz list + [id] detail
    reps/                     # Rep management + [id] detail
    calculator/               # Commission calculator
    settings/                 # Admin: installer/financer/pricing management
    earnings/, vault/, training/, incentives/, reimbursement/, export/, resources/, admin/
    components/               # Shared UI components (ConfirmDialog, PaginationBar, etc.)
  api/                        # 30+ route handlers (see below)
lib/
  context.tsx                 # AppProvider — global state, hydrated from /api/data on mount
  data.ts                     # Types, constants, business logic (commission calc, pricing lookups)
  db.ts                       # Prisma client (auto-selects SQLite vs Turso)
  api-auth.ts                 # requireAuth() and requireAdmin() helpers
  utils.ts                    # M1/M2 pay dates, formatting, date ranges
  persist.ts                  # Fire-and-forget API calls with toast integration
  hooks.ts, toast.tsx, nav-items.ts, sparkline.tsx, command-palette.tsx
prisma/
  schema.prisma               # 28 models — User, Project, Installer, PayrollEntry, Blitz, etc.
  seed.ts                     # Database seeder
tests/
  unit/                       # Business logic tests (commission, pricing, dates, data integrity)
  api/                        # DB integration tests (projects, payroll, blitz, reps, installers)
  e2e/                        # Playwright smoke tests
```

### Data Flow
1. Clerk authenticates user via middleware
2. `app/page.tsx` calls `/api/auth/me` to resolve Clerk user → internal User record → sets role
3. `lib/context.tsx` fetches `/api/data` on mount → hydrates all state (projects, reps, payroll, pricing, etc.)
4. Mutations go through API routes → Prisma → SQLite/Turso
5. Client state updated optimistically or via refetch

### Auth Pattern
- `requireAuth()` — any authenticated Clerk user, returns userId
- `requireAdmin()` — must be admin role, returns User record
- DELETE endpoints must use `requireAdmin()`
- API routes throw `NextResponse` on auth failure (caught with `try/catch (r) { return r as NextResponse }`)

## Business Rules

### Commission Calculation
```
Commission = max(0, (netPPW - baselinePerW) × kW × 1000)
```
- **Closer baseline**: from pricing version (flat or tiered by kW)
- **Setter baseline**: closerPerW + $0.10/W (always)
- **Three pricing models**: Generic baselines, SolarTech catalog (24+ products), Product Catalog (extensible)

### Milestone Payments
- **M1**: Project reaches Acceptance. Cutoff Sunday 11:59 PM → paid following Friday.
- **M2**: Project reaches Installed. Cutoff Saturday 11:59 PM → paid following Friday.
- **M3**: Project reaches PTO. Only for installers with installPayPct < 100 (remainder of M2).
- Payroll flow: Draft → Pending → Paid

### Deal Form Logic
- Cash product type → financer field hidden
- SolarTech/Product Catalog + Cash or Loan → only Prepaid family selectable
- Prepaid sub-type selector (HDM, PE) — tracking only, no pricing effect

### Pipeline Phases
New → Acceptance → Site Survey → Design → Permitting → Pending Install → Installed → PTO → Completed
Also: Cancelled, On Hold

## Coding Conventions

### Styling
- Dark theme only. CSS variables: `--brand`, `--navy-base`, `--navy-card`, `--navy-hover`
- Card pattern: `className="card-surface rounded-2xl p-6"` (defined in globals.css)
- Use Tailwind utilities, no CSS modules or styled-components
- Icons: `lucide-react` only. Import individually: `import { Plus, Trash2 } from 'lucide-react'`

### Components
- Pages are `'use client'` with hooks from `lib/context.tsx` and `lib/hooks.ts`
- Confirmation dialogs: use `<ConfirmDialog>` component, not window.confirm
- Toast notifications: `const { toast } = useToast()` — `toast('message')` or `toast('msg', 'error')`
- Async buttons: wrap with loading state, disable while pending
- Optimistic UI: update local state immediately, fire-and-forget API call via `persistFetch()`

### API Routes
- File pattern: `app/api/{resource}/route.ts` (GET, POST) and `app/api/{resource}/[id]/route.ts` (GET, PATCH, DELETE)
- Dynamic params: `{ params }: { params: Promise<{ id: string }> }` (Next.js 16 pattern — must await)
- Return `NextResponse.json(data)` or `NextResponse.json(data, { status: 201 })` for creates
- FK resolution: accept name strings, resolve to IDs via Prisma lookup

### Database
- After schema changes: run `npx prisma db push` then `npx prisma generate`
- Prisma client at `lib/generated/prisma` (gitignored, regenerated)
- Local dev uses `dev.db` (SQLite file). Production uses Turso (env vars in `.env`)
- `.env.local` overrides Turso to empty for local dev

### Testing
- Unit tests: `tests/unit/*.test.ts` — pure function tests, no DB
- API tests: `tests/api/*.test.ts` — real Prisma + SQLite, mock Clerk auth
- E2E tests: `tests/e2e/*.test.ts` — Playwright, requires dev server
- Always run `npm test` after changes to verify nothing broke

### Before Committing
- **Always run `npm run typecheck` before every commit.** Vercel builds from the committed tree — a clean working directory is not enough. Past incident: `abf6551` broke production because a component signature change was staged without its corresponding caller update.
- **Stage files individually by name** (`git add app/foo.tsx lib/bar.ts`), not with `git add -A` or `git add .`. Broad staging captures in-progress partial refactors and produces commits that pass local checks but fail CI.
- If a multi-file refactor is in progress, either complete it fully before committing or stash/discard the incomplete parts first.
