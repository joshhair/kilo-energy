/**
 * Shared database-safety guards (2026-06-12 incident response).
 *
 * Pure functions, NO import side effects — so this module can be imported
 * from anywhere (vitest setup, Playwright global setup, scripts) without
 * triggering an abort merely by being loaded. The side-effecting entry for
 * vitest setupFiles lives in ./no-prod-db-guard.ts, which imports from here.
 *
 * Two strictness levels, by context:
 *   - assertNoRemoteDb  → unit/API tests (vitest). These ONLY ever use the
 *     local dev.db; any remote URL is wrong. Blocks every non-file: URL.
 *   - assertNotProdDb   → e2e (local dev webServer) + admin scripts, where a
 *     non-prod REMOTE test DB could be legitimate but PRODUCTION never is.
 *     Blocks only the known production host(s).
 */

/** Known production Turso host(s). Matching any means "this is prod." */
export const PROD_DB_HOSTS = ['kilo-energy-joshhair.aws-us-east-2.turso.io'];

/**
 * Known production WEB host(s) — the deployed app. A mutating e2e test
 * pointed at one of these writes to live prod through the API even when no
 * TURSO_DATABASE_URL is set on the runner (the deployed app has its own).
 */
export const PROD_WEB_HOSTS = ['kilo-energy.vercel.app', 'app.kiloenergies.com'];

// Normalize before matching: percent-DECODE (libsql/the URL parser decodes
// `%2E`→`.` before connecting, so a raw substring check would miss
// `host%2Ecom`) then lowercase (hostnames are case-insensitive). Substring
// match — not strict hostname parse — is deliberate: over-matching is the safe
// direction and it can't throw. Codex review, 2026-06-12.
export function normalizeUrlForMatch(url: string): string {
  let decoded = url;
  try {
    // Decode repeatedly in case of double-encoding; cap to avoid a loop.
    for (let i = 0; i < 3 && /%[0-9a-fA-F]{2}/.test(decoded); i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch { /* malformed encoding — fall back to the raw string */ }
  // Fold Unicode dot-equivalents that the URL/libsql parser canonicalizes to
  // '.' before connecting (。U+3002, ．U+FF0E, ｡U+FF61) so e.g.
  // `host。com` can't slip past the host match (Codex review, 2026-06-12).
  decoded = decoded.replace(/[。．｡]/g, '.');
  return decoded.toLowerCase();
}

export function isProdDbUrl(url: string | undefined): boolean {
  if (!url) return false;
  const norm = normalizeUrlForMatch(url);
  return PROD_DB_HOSTS.some((h) => norm.includes(h.toLowerCase()));
}

export function isProdWebUrl(url: string | undefined): boolean {
  if (!url) return false;
  const norm = normalizeUrlForMatch(url);
  return PROD_WEB_HOSTS.some((h) => norm.includes(h.toLowerCase()));
}

function maskUrl(url: string): string {
  return url.replace(/(:\/\/)([^@/]+)(@)?/, '$1***$3');
}

function abort(title: string, envVar: string, url: string, context: string, extra: string): never {
  console.error(
    [
      '',
      `╔══════════════════════════════════════════════════════════════════╗`,
      `║  ABORTING — ${title.padEnd(53)}║`,
      `╚══════════════════════════════════════════════════════════════════╝`,
      '',
      `  Detected (${context}): ${envVar}=${maskUrl(url)}`,
      '',
      extra,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * Hard-fail if TURSO_DATABASE_URL is set to any remote (non-file:) URL.
 * For vitest unit/API runs, which always target the local dev.db.
 */
export function assertNoRemoteDb(context: string): void {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return; // unset → lib/db falls back to local dev.db. Correct.
  if (url.startsWith('file:')) return; // explicit local file. Allowed.
  abort(
    'TURSO_DATABASE_URL points at a REMOTE database.',
    'TURSO_DATABASE_URL',
    url,
    context,
    [
      '  The test suite uses the real Prisma client and WILL mutate/delete',
      '  rows in whatever database this points at. Running against prod is',
      '  how the 2026-06-12 PayrollEntry wipe happened.',
      '',
      '  Fix: ensure TURSO_DATABASE_URL is UNSET when running tests. Do NOT',
      '  source .env (prod) into a shell that then runs vitest / audit:pre-push.',
    ].join('\n'),
  );
}

/**
 * Hard-fail if TURSO_DATABASE_URL is the PRODUCTION database. For the
 * Playwright e2e run, whose local dev webServer would otherwise inherit a
 * sourced prod URL and let the data-mutating golden tests write to prod.
 * A non-prod remote test DB is still allowed.
 */
export function assertNotProdDb(context: string): void {
  const url = process.env.TURSO_DATABASE_URL;
  if (!isProdDbUrl(url)) return;
  abort(
    'TURSO_DATABASE_URL points at PRODUCTION.',
    'TURSO_DATABASE_URL',
    url as string,
    context,
    [
      '  The e2e golden tests create/mutate projects, reimbursements, and reps',
      '  through the API. Pointing them at prod would corrupt live data.',
      '',
      '  Fix: unset TURSO_DATABASE_URL (the dev webServer then uses dev.db), or',
      '  point it at a non-production database.',
    ].join('\n'),
  );
}

/**
 * Hard-fail if PLAYWRIGHT_BASE_URL targets the deployed PRODUCTION app. The
 * data-mutating golden specs send HTTP writes to baseURL; a prod base URL
 * routes those writes through live prod with NO TURSO env on the runner, so
 * assertNotProdDb alone wouldn't catch it (Codex review, 2026-06-12). The
 * read-only visual suite legitimately targets prod and does NOT call this.
 */
export function assertNotProdBaseUrl(context: string): void {
  const url = process.env.PLAYWRIGHT_BASE_URL;
  if (!isProdWebUrl(url)) return;
  abort(
    'PLAYWRIGHT_BASE_URL targets the PRODUCTION app.',
    'PLAYWRIGHT_BASE_URL',
    url as string,
    context,
    [
      '  This is a DATA-MUTATING e2e test — pointing it at the deployed prod',
      '  app would create/modify/delete live records through the API.',
      '',
      '  Fix: unset PLAYWRIGHT_BASE_URL (defaults to http://localhost:3000), or',
      '  point it at a preview/non-production deployment. Only the read-only',
      '  visual suite may target prod.',
    ].join('\n'),
  );
}

/**
 * Combined gate for any data-MUTATING e2e spec: refuse to run if either the
 * DB or the base URL resolves to production. Call at module load in each
 * golden test file so it fires during collection, before any request.
 *
 * Residual NOT covered (documented): a locally-running `next dev` that was
 * itself started against prod (sourced prod .env) and is then reused via
 * webServer.reuseExistingServer — baseURL is localhost and the runner's
 * TURSO env may be clean, so neither check sees it. Mitigation lives at the
 * source (don't run `next dev` against prod; the husky/vitest guards reduce
 * the blast). A startup warning in lib/db when a non-prod build connects to
 * the prod DB would close it fully.
 */
export function assertE2eMutationSafe(context: string): void {
  assertNotProdDb(context);
  assertNotProdBaseUrl(context);
}
