# Runbook: Load Testing

The `scripts/load-test.mts` tool exercises the stack at configurable
concurrency for a configurable duration. It's NOT a replacement for
chaos engineering or full distributed load sim — it's a quick
"can my stack handle 50 concurrent users without melting" smoke.

---

## When to run

- Before a major launch or promotional push that might spike traffic
- After any change to middleware or database schema
- Quarterly — to catch performance regressions as the data volume grows
- Before scaling changes (Turso plan upgrade, Vercel pro bump, etc.)

Not needed on every commit. This is a periodic health check, not a
CI gate.

---

## Quick run

```bash
npm run dev                 # terminal 1 — serve the app
npm run load:test           # terminal 2 — default 50 concurrent, 30s
```

Default target: `/legal/privacy` — SSR page, no auth, exercises
Next.js runtime + middleware. Good "stack liveness" signal.

---

## Documented envelope (current baseline)

Measured **2026-04-19** against Vercel prod (`app.kiloenergies.com`):

| Concurrency | Duration | Target | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|
| _(not yet measured — update after first run)_ | | | | | | |

**Fill this in after the first actual run**. Expected behavior at
Kilo's scale (50-100 concurrent rep + admin users peak):

- p50 < 200ms
- p95 < 800ms
- p99 < 2000ms
- Error rate < 0.1%

If any metric exceeds the target by 2x, investigate before the next
launch window. Common causes: Turso connection pool saturation,
N+1 query in a hot endpoint, middleware regression (rate limit or
auth check doing something expensive).

---

## Authenticated load test

For hitting API endpoints that require a session, set a storage
state from a pre-authenticated Playwright session:

```bash
# First: regenerate the admin storage state
npm run test:e2e:setup

# Then: load-test a specific authenticated endpoint
CONCURRENCY=20 \
DURATION_MS=15000 \
TARGET_PATH=/api/data \
LOAD_TEST_STORAGE_STATE=tests/e2e/.auth/admin.json \
npm run load:test
```

WARNING: hitting `/api/data` at high concurrency against prod will
burn Turso reads quickly. Keep concurrency low (≤20) and duration
short (≤15s) for authenticated prod tests. For heavier runs, stand
up a staging Turso DB and point `TURSO_DATABASE_URL` at it.

---

## Running against a Vercel preview

```bash
LOAD_TEST_BASE_URL=https://kilo-energy-{hash}-joshhairs-projects.vercel.app \
npm run load:test
```

Preview URLs use the same Turso DB as prod by default. Be mindful
of the DB-burn warning above.

---

## Load test in CI (manual trigger)

`.github/workflows/load-test.yml` (added in Phase 3.3) can be
triggered manually via "Run workflow" in the Actions tab. It runs
against prod at a conservative concurrency (20) for 10 seconds —
enough to catch a catastrophic regression but not enough to stress
the DB.

Schedule: NOT automatic. Intentional — load-testing prod
periodically means paying for that traffic forever. Manual trigger
on demand.

---

## What to do if results are bad

1. **Compare to the documented envelope above.** Was this one run
   an anomaly? Run 2-3 more samples before declaring a regression.
2. **Identify the hottest endpoint.** Usually `/api/data` —
   hydration pulls everything.
3. **Check Turso metrics** in the Turso Cloud dashboard. Read
   latency per query, connection pool utilization.
4. **Profile locally**: `DEBUG=prisma:query npm run dev` then hit
   the slow endpoint. Identify the slow query.
5. **Typical fixes**: add a missing index; batch N+1 queries via
   Prisma `include`; cache a hot read at the edge with
   `revalidate`; denormalize a frequently-computed field.

---

## Pitfalls to avoid

- **Don't load-test prod at high concurrency without warning.** Tell
  reps if you're going to spike traffic.
- **Don't set CONCURRENCY above 100 against Turso.** Their free /
  paid tiers have connection limits; you'll start seeing errors
  that aren't your code.
- **Don't trust a single run's numbers.** Variance is real. Run 3
  and take the median.
- **Don't conflate load testing with performance testing.** Load =
  does it work at N users. Performance = how fast does each user
  feel the app. Both matter; this tool measures load.
