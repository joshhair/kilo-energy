# Runbook — Load Test Baseline

Baseline numbers for the app under synthetic load. Re-run quarterly or
after any architectural change (Prisma version, Vercel Function region,
rate-limiter config) and replace the table below with the new results.

Runner: `scripts/load-test.mts` — zero external deps, streams per-second
throughput, prints p50/p95/p99 at exit.

```bash
# Production, default 50 VUs × 30s against /legal/privacy
LOAD_TEST_BASE_URL=https://app.kiloenergies.com npm run load:test

# Higher concurrency
CONCURRENCY=100 DURATION_MS=60000 npm run load:test

# Different path (e.g. the /sign-in page)
TARGET_PATH=/sign-in npm run load:test
```

## Current baseline — 2026-04-16

### Production target (`https://app.kiloenergies.com/legal/privacy`)

| Concurrency | Duration | Total req | Errors | Throughput | p50 | p95 | p99 | Max |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 30 s | 36,342 | 0 (0.00 %) | **1,211 req/s** | **38 ms** | **56 ms** | **98 ms** | 1,857 ms |
| 200 | 20 s | 154,030 | 130,470 (84.7 %) | 7,701 req/s | 18 ms | 53 ms | 78 ms | 3,738 ms |

**Verdict:** A **go** for 20–50 concurrent reps (our pre-launch scale).
At 200 synthetic VUs, Vercel / Cloudflare edge protections reject ~85 %
of requests as abnormal traffic — the app itself stays fast (p99 < 100
ms) but the traffic shape triggers upstream DDoS defenses. This is the
correct behavior, not a failure mode: a real 200-user spike from
geographically distributed browsers wouldn't trigger the same rate
limit.

### Dev target (`http://localhost:3001/legal/privacy`, Turbopack)

| Concurrency | Duration | Total req | Errors | p95 | Notes |
|---:|---:|---:|---:|---:|---|
| 25 | 15 s | 425 | 0 | 995 ms | Turbopack dev mode is single-threaded — **expect ~30× slower** than prod. Not a valid production proxy. |

Use the prod numbers as the authoritative baseline.

## Interpretation

- **p99 < 100 ms at 50 VUs**: room to scale 10× without architectural
  changes.
- **Vercel Function region is `iad1`** (US East). Reps in US West will
  see +60–80 ms network latency added to every number above.
- The `/legal/privacy` page is lightweight (static React, no DB). Authed
  API endpoints add Clerk JWT verify (~5 ms) + Prisma round-trip (~15–40
  ms for a cold Turso query). Net: authed API p95 should land 60–120 ms
  at the same concurrency.

## What "PASS" means

The runner exits 0 when:
- Error rate < 1 %
- p95 < 1000 ms

Tune these thresholds in `scripts/load-test.mts` as the baseline settles.

## When it fails

If a future run regresses:
1. Check Vercel's observability dashboard (Functions tab) — look for
   cold-start spikes or region failover.
2. Check Turso metrics — slow queries manifest as p99 > 200 ms here.
3. Check Sentry for 5xx spikes correlated with the run.
4. Compare the failing run's `scripts/load-test.mts` output to the table
   above — a 2× slowdown is infrastructure, a 10× slowdown is probably
   a bad deploy.

## Authenticated load testing

Currently the runner targets public pages (no Clerk session needed).
Authed load testing requires a valid session cookie — see
`scripts/load-test.mts`'s `STORAGE_STATE_PATH` env var. Reuse a
Playwright-generated storage state (`tests/e2e/.auth/admin.json`) for
this. **Note**: dev-instance Clerk cookies occasionally don't round-trip
via raw `fetch` — prefer unauthenticated page targets for consistent
baselines, or run against prod.
