# Architecture

Kilo Energy is a Next.js 15 App Router app deployed on Vercel,
backed by Turso (libSQL) for data, Clerk for auth, and Vercel Blob
for file storage. This doc covers the high-level topology and the
key data flows.

---

## System diagram

```
                              ┌──────────────────────┐
                              │   Users (browsers    │
                              │   + PWA home-screen) │
                              └─────────┬────────────┘
                                        │
                                        │ HTTPS
                                        │
                              ┌─────────▼────────────┐
                              │  Vercel Edge         │
                              │  (CDN + middleware)  │
                              └─────────┬────────────┘
                                        │
                                        │ Matched routes
                                        │
                    ┌───────────────────▼───────────────────┐
                    │  Vercel Serverless / Edge Functions   │
                    │  (Next.js 15 app/ routes)             │
                    └──┬──────────────┬──────────────┬──────┘
                       │              │              │
                       │              │              │
               ┌───────▼──────┐ ┌─────▼──────┐ ┌────▼──────────┐
               │    Turso     │ │   Clerk    │ │  Vercel Blob  │
               │  (libSQL)    │ │  (auth)    │ │  (receipts)   │
               │  prod DB     │ │  users/    │ │  images/PDF   │
               └──────────────┘ │  sessions  │ └───────────────┘
                                └────────────┘
                                        │
                                ┌───────▼──────┐
                                │    Sentry    │
                                │  (errors +   │
                                │   replays)   │
                                └──────────────┘
```

**Edge vs serverless**: Vercel decides per-route. Middleware (CSRF
check, Clerk session validation) runs at edge. API routes that hit
Turso run as serverless functions (can't connect from edge runtime
to libSQL). Static pages are cached at edge.

---

## Request lifecycle — a typical API call

```
1. Browser → https://app.kiloenergies.com/api/projects/abc123 (PATCH)

2. Vercel edge → middleware.ts
   - CSRF check (Origin/Referer must match host)
   - Clerk session check (auth.protect() unless public route)
   - If unauthenticated → 302 to /sign-in

3. Vercel serverless → app/api/projects/[id]/route.ts → PATCH handler
   - requireAdminOrPM() or requireInternalUser() — hits Turso for user lookup
   - zod-parse the request body (lib/schemas/project.ts)
   - If body touches commission inputs:
     - Load related tables (pricing versions, trainer assignments, payroll)
     - computeProjectCommission() — server-authoritative math
     - Override client-supplied amounts with computed
   - prisma.project.update(...) → Turso
   - logChange() → AuditLog table
   - scrubProjectForViewer(row, relationship) → strip fields per role
   - Return JSON

4. Browser receives response → React state updates
```

**Response time budget**: p50 <300ms, p99 <1500ms. Bottleneck is
almost always the Turso round-trip (serverless → libSQL over the
Vercel network). Batch queries via Prisma's `include` to minimize
trips.

---

## Data model (high level)

See `prisma/schema.prisma` for the source of truth. The key tables:

- **User** — every human interacting with the app. Role ∈
  `{admin, project_manager, rep, sub-dealer}`. `repType` ∈
  `{closer, setter, both}` for reps only.
- **Project** — a solar deal. Has `closerId`, optional `setterId`,
  optional `subDealerId`, optional `trainerId`. Commission amounts
  stored as `*AmountCents` fields.
  - **ProjectCloser** / **ProjectSetter** — co-party rows.
- **PayrollEntry** — one commission payout milestone (M1/M2/M3/
  Trainer/Bonus) for one rep on one project. Status machine:
  Draft → Pending → Paid. Has `paidAt` for grace-window reversal.
- **Reimbursement** — rep expense reimbursement. Has `receiptUrl`
  pointing at Vercel Blob.
- **Incentive** + **IncentiveMilestone** — admin-defined bonus
  structures.
- **Blitz** + **BlitzParticipant** + **BlitzCost** — sales sprint
  events.
- **Installer** + **InstallerPricingVersion** + **InstallerTieredKWBand**
  — per-installer commission baselines, versioned by effective date.
- **Product** + **ProductPricingVersion** + **ProductCatalogTier**
  — Product Catalog installers (BVI, etc.) with per-product pricing.
- **SolarTechProduct** — SolarTech-specific archived product model.
- **TrainerAssignment** + **TrainerOverrideTier** — rep-to-rep
  mentor relationships with per-watt rates.
- **AuditLog** — append-only record of every mutation on money-
  sensitive tables.

### Key invariants

Enforced by test:
- `Project.m1AmountCents + m2AmountCents + m3AmountCents =
  splitCloserSetterPay(inputs).closerTotal` (cent-identical)
- Same for setter side
- `closerHalf + setterHalf === aboveSplit` (splitEvenly guarantee)
- No PayrollEntry.amountCents is written without a matching User
  and Project (FK constraint)

---

## Third-party dependencies

| System | Purpose | SLA concern |
|---|---|---|
| Vercel | Hosting + edge + serverless | 99.99% SLA; cache mitigates |
| Turso | Primary database | 99.9% SLA; JSON backup is fallback |
| Clerk | Auth + user management | 99.95% SLA; no fallback, we wait |
| Vercel Blob | Receipt file storage | Non-critical; reimbursement flow degrades gracefully without it |
| Sentry | Error tracking | Observability, not critical path |
| Upstash Redis | Rate limiting | Non-critical; rate-limit disables gracefully if unreachable |
| GitHub | Code + CI + Dependabot | Dev productivity; no runtime dependency |

If any "critical path" (Vercel / Turso / Clerk) is down, the app is
down. If any "non-critical" is down, the app degrades. See
`docs/runbooks/incidents.md` for per-system incident response.

---

## Environment variables

Production env vars live on Vercel. Development env vars in
`.env.local` (gitignored). Key ones:

- `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` — prod DB
- `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob
- `UPSTASH_REDIS_REST_URL` + token — rate limiting
- `RETENTION_SECRET` — cron auth

Rotating any of these requires updating Vercel AND your local
`.env.local`. Missing env vars in prod → deploy fails fast at boot.

---

## Build + deploy pipeline

```
Developer commits → git push origin main
                    │
                    ├─→ GitHub Actions (CI)
                    │   - typecheck
                    │   - lint (0 errors gate)
                    │   - unit tests
                    │   - (api + e2e currently local-only)
                    │
                    └─→ Vercel webhook
                        - prisma generate
                        - next build
                        - Atomic swap to new deploy
                        - Previous deploy kept for rollback
```

**Gap**: CI and Vercel are currently independent pipelines. A
failing CI run doesn't block the Vercel deploy. See Phase 3.1 in
the A+ roadmap — goal is to make Vercel wait on CI.

**Rollback**: Vercel dashboard → Deployments → prior one → "Promote
to Production." Atomic swap, takes seconds.

---

## Code organization

```
app/
  (marketing)/           — unauthenticated pages
  dashboard/             — authenticated admin + rep UI
    components/          — shared components (ConfirmDialog, etc.)
    mobile/              — mobile-specific screens (parallel to desktop)
    [tab]/               — per-feature folders
      page.tsx           — the main screen for that tab
    layout.tsx           — sidebar, bottom nav, auth context
  api/                   — REST endpoints
    [resource]/route.ts  — per-resource handlers (POST/PATCH/DELETE)

lib/
  commission.ts          — splitCloserSetterPay, resolveTrainerRate
  commission-server.ts   — computeProjectCommission (server entry)
  fieldVisibility.ts     — RBAC scrubbing matrix
  serialize.ts           — DB-cents ↔ wire-dollars conversion
  api-auth.ts            — require* helpers, relationshipToProject
  data.ts                — shared types + pricing helpers
  context.tsx            — client-side React Context (app state)

scripts/                 — migrations, backfills, reconcile (see scripts/README.md)
tests/
  unit/                  — vitest unit tests
  api/                   — vitest with real prisma (runs against dev.db)
  e2e/                   — Playwright

docs/
  architecture.md        — this file
  commission-policy.md   — commission rules in English
  runbooks/              — incident + migration + backup procedures
  adr/                   — architecture decision records
```
