// Lightweight load test — zero external deps. Targets a configurable URL
// at a configurable concurrency for a configurable duration. Default
// target is /legal/privacy: a server-rendered public page that exercises
// the Next runtime, middleware, and React SSR without requiring a
// Clerk session. That's exactly the right surface for "can my stack
// handle 50 concurrent" — the authed API endpoints are mostly the same
// stack plus a Prisma query, which we bench separately if needed.
//
// Usage:
//   npm run load:test
//   CONCURRENCY=100 DURATION_MS=60000 TARGET_PATH=/legal/privacy \
//     LOAD_TEST_BASE_URL=https://app.kiloenergies.com npm run load:test
//
// Optional authenticated mode: set LOAD_TEST_STORAGE_STATE to a Playwright
// storage-state JSON (e.g. tests/e2e/.auth/admin.json) to reuse a real
// logged-in session. Note: local dev Clerk cookies frequently don't
// round-trip via raw fetch; prefer the default unauthenticated path.
//
// Output: per-second throughput, p50/p95/p99 latency, error rate.

import { readFile } from 'node:fs/promises';

const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3001';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const DURATION_MS = Number(process.env.DURATION_MS ?? 30_000);
const TARGET_PATH = process.env.TARGET_PATH ?? '/legal/privacy';
const STORAGE_STATE_PATH = process.env.LOAD_TEST_STORAGE_STATE ?? '';

interface SampleStats {
  count: number;
  errors: number;
  latencies: number[];
  statusCounts: Record<number, number>;
}

async function getAuthCookie(): Promise<string> {
  if (!STORAGE_STATE_PATH) return '';
  const raw = await readFile(STORAGE_STATE_PATH, 'utf8');
  const state = JSON.parse(raw) as { cookies: Array<{ name: string; value: string; domain: string }> };
  const hostname = new URL(BASE_URL).hostname;
  return state.cookies
    .filter((c) => !c.domain || c.domain === hostname || c.domain.endsWith(hostname))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

async function worker(
  cookie: string,
  stats: SampleStats,
  stopAt: number,
): Promise<void> {
  while (Date.now() < stopAt) {
    const start = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${BASE_URL}${TARGET_PATH}`, {
        headers: { cookie, accept: 'application/json' },
      });
      status = res.status;
      await res.text(); // drain body so the TCP connection gets freed
      if (!res.ok) stats.errors++;
    } catch {
      stats.errors++;
    }
    const elapsed = performance.now() - start;
    stats.count++;
    stats.latencies.push(elapsed);
    stats.statusCounts[status] = (stats.statusCounts[status] ?? 0) + 1;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`Load test: ${CONCURRENCY} VUs × ${DURATION_MS / 1000}s against ${BASE_URL}${TARGET_PATH}`);
  const cookie = await getAuthCookie();
  if (cookie) console.log(`  (authed: ${cookie.split(';').length} cookies from storage state)`);
  else console.log('  (unauthenticated)');

  // Warm-up — absorb first-request compilation spike in Next dev.
  const warm = await fetch(`${BASE_URL}${TARGET_PATH}`, { headers: cookie ? { cookie } : {} });
  console.log(`  warm-up: ${warm.status} in ${warm.headers.get('x-response-time') ?? '—'}`);
  await warm.text();
  if (warm.status >= 500) {
    throw new Error(`Warm-up returned ${warm.status} — aborting`);
  }

  const stats: SampleStats = { count: 0, errors: 0, latencies: [], statusCounts: {} };
  const stopAt = Date.now() + DURATION_MS;
  console.log(`Running ${DURATION_MS / 1000}s...`);

  // Per-second throughput reporter — fires every second while the test runs.
  let lastCount = 0;
  const reporter = setInterval(() => {
    const rps = stats.count - lastCount;
    lastCount = stats.count;
    process.stdout.write(`  rps=${rps.toString().padStart(4)}  total=${stats.count}  errors=${stats.errors}\n`);
  }, 1000);

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker(cookie, stats, stopAt)),
  );
  clearInterval(reporter);

  const sorted = [...stats.latencies].sort((a, b) => a - b);
  const total = stats.count;
  const errPct = total > 0 ? (stats.errors / total) * 100 : 0;

  console.log('\n─── Summary ──────────────────────────────────');
  console.log(`  Requests:    ${total}`);
  console.log(`  Errors:      ${stats.errors}  (${errPct.toFixed(2)}%)`);
  console.log(`  Throughput:  ${(total / (DURATION_MS / 1000)).toFixed(1)} req/s`);
  console.log(`  Latency p50: ${percentile(sorted, 50).toFixed(0)} ms`);
  console.log(`  Latency p95: ${percentile(sorted, 95).toFixed(0)} ms`);
  console.log(`  Latency p99: ${percentile(sorted, 99).toFixed(0)} ms`);
  console.log(`  Latency max: ${(sorted[sorted.length - 1] ?? 0).toFixed(0)} ms`);
  console.log('  Status codes:');
  for (const [code, n] of Object.entries(stats.statusCounts).sort()) {
    console.log(`    ${code}: ${n}`);
  }

  // Exit code reflects pass/fail. We consider the run "passed" if error
  // rate < 1% and p95 < 1000 ms — tune as baselines settle in the runbook.
  const passP95 = percentile(sorted, 95) < 1000;
  const passErr = errPct < 1;
  if (passP95 && passErr) {
    console.log('\n✓ PASS (p95 < 1000 ms, errors < 1 %)');
    process.exit(0);
  }
  console.log('\n✗ FAIL — check the runbook for expected baseline');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
