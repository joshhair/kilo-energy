# Runbook: Performance

Scope: how to measure, detect regressions, and address hot-path
bottlenecks in the Kilo Energy app. Most of the app is fast by
default; this doc is for when it isn't.

---

## Known hot paths

### `/api/data` — bulk hydration

What: a single Promise.all fans out 13 queries covering users +
installers + financers + all visible projects + all visible payroll
+ reimbursements + trainers + incentives + pricing versions +
product catalog + prepaid options.

Current cost: ~13 parallel Turso round-trips, each single-table.
At Kilo's scale (~564 projects, hundreds of payroll entries) this
is fast — sub-500ms p95.

**Known scalability ceiling**: at ~10,000 projects or ~50,000
payroll entries, the response payload becomes large enough to
matter (serialization time + network transfer). Indicators it's
time to refactor:

- p95 latency > 1500ms
- Response payload > 2MB
- Client-side JSON parse time > 100ms

When that hits, options:
1. Paginate the projects load (first 200, load more on scroll)
2. Split hydration into separate endpoints (core vs stats)
3. Cache the aggregate at the edge with `revalidate`

### `/api/projects/[id]` — project detail

What: one project lookup + related payroll + audit log.

Cost: 2-3 queries. Fast by default.

**Scalability ceiling**: fine until a single project has >1000
audit log entries (we keep them forever). Add a LIMIT on the
audit log fetch here before that becomes real.

### `/api/audit` — audit log viewer

Keyset-paginated (50 rows, cursor-based). O(1) per page. Scales
indefinitely.

---

## Index coverage audit (2026-04-19)

All hot-path query columns are indexed. Current state per model:

| Model | Indexed columns |
|---|---|
| User | `role`, `active`, `clerkUserId` |
| Project | `closerId`, `setterId`, `subDealerId`, `installerId`, `trainerId`, `phase`, `soldDate`, `blitzId` |
| PayrollEntry | `repId`, `projectId`, `status`, `date` |
| Reimbursement | `repId`, `status`, `archivedAt` |
| InstallerPricingVersion | `installerId+effectiveFrom` (compound) |
| Product | `installerId+family`, `installerId+active` |
| ProductPricingVersion | `productId+effectiveFrom` (compound) |
| AuditLog | `entityType+entityId`, `actorUserId`, `createdAt` |
| Installer | `active` |
| Incentive | (no indexes — small table, seq scan fast) |
| IncentiveMilestone | `incentiveId` |

**Gaps to watch** as data grows:
- PayrollEntry by `paymentStage` (currently scans) — matters if we
  add "all M3 entries across reps" queries
- Project `createdAt` — not currently queried; add if needed for
  "recently modified" views
- Compound `PayrollEntry(repId, status)` — useful if "my pending
  payroll" becomes a hot query

---

## Bundle size awareness

Current production bundle (per `npm run build` output):
- First Load JS shared: ~102 kB
- Biggest routes: `/dashboard/projects/[id]`, `/dashboard/new-deal`,
  `/dashboard/earnings` — each ~250-350 kB first load

These are reasonable for an admin dashboard but on the high side
for a consumer app. After the Phase 1.1 decomposition settles,
worth revisiting with code-splitting (dynamic imports for the
heavy modals).

### Budgets to enforce (future)

Target ceilings to keep things honest:
- First Load JS shared: **< 150 kB** (currently 102 kB — safe)
- Any single route first load: **< 400 kB** (currently max 350 kB — safe)

When a PR blows through these, investigate: probably an import of a
heavy dependency (chart lib, icon set) that could be dynamic.

---

## Turso connection pool

Prisma + libSQL: one client per Vercel function instance. Cold
starts create a new connection; warm invocations reuse. No explicit
pool to tune.

**Symptom of contention**: intermittent "connection refused" or
high p99 during traffic spikes. Fix: upgrade Turso plan (gets more
concurrent connections) or add Prisma Accelerate in front.

---

## When things feel slow

Debugging order:

1. **Check Sentry** — is this every user or one? What's the error
   rate? Transactions slow or errors?
2. **Check Vercel function logs** — any warnings about cold-start
   time? Connection retries?
3. **Check Turso Cloud dashboard** — latency per query, row counts,
   connection utilization.
4. **Reproduce locally** — `DEBUG=prisma:query npm run dev` shows
   every SQL. Hit the slow page; find the slow query.
5. **Profile** — wrap the suspect handler in `performance.now()`
   timers, confirm the bottleneck.
6. **Fix** — add index / batch queries / cache / paginate in that
   order. Index first; it's the cheapest win.

---

## Performance changelog

Track measured envelope changes. Update after each load test run
or significant architectural change.

- **2026-04-19**: Runbook created. Index audit clean. Baseline
  envelope not yet measured via `scripts/load-test.mts`. Next step:
  first formal run against prod to populate the baseline table in
  `docs/runbooks/load-testing.md`.

---

## Pitfalls to avoid

- **Don't add indexes defensively.** Indexes cost write time +
  storage. Add only for queries you've observed (via the Turso
  dashboard or Prisma debug logs).
- **Don't optimize before measuring.** Cold-start time in
  serverless is often dominated by the prisma-client load, not
  your code. Profile before refactoring.
- **Don't conflate hot with slow.** An endpoint hit 1000x/hour at
  50ms each matters more than an endpoint hit 10x/hour at 500ms.
  Prioritize by (frequency × latency).
