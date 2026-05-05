/**
 * check-audit-coverage.mjs
 *
 * Walks app/api/**\/route.ts and verifies that every route exporting a
 * mutating HTTP method (POST/PUT/PATCH/DELETE) either:
 *
 *   (a) calls `logChange(` somewhere in the file, OR
 *   (b) is listed in scripts/audit-coverage.allowlist.json as an
 *       intentional exemption with a documented reason.
 *
 * Why: prior to this gate, audit coverage was opt-in. Of 51 mutating
 * routes, only 11 (22%) called logChange. Some of those gaps were
 * deliberate — chat messages and notes don't need an audit record, the
 * volume would drown signal — but most were just "nobody got around to
 * it" oversights. This gate flips the default: silence is failure.
 *
 * Run:
 *   npm run check:audit
 *
 * To exempt a route, add a line to scripts/audit-coverage.allowlist.json
 * with a one-sentence reason (visible in CI failure output, code
 * review, and `git blame` — make it obvious why the gap is intentional).
 *
 * Gate behavior:
 *   - Exit 0: every mutating route is audited or explicitly exempt
 *   - Exit 1: at least one mutating route is silent (CI fail)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const apiRoot = join(repoRoot, 'app', 'api');

// ── Load allowlist ────────────────────────────────────────────────────
// Shape: { "app/api/foo/route.ts": "reason" }
const allowlistPath = join(here, 'audit-coverage.allowlist.json');
let allowlist = {};
if (existsSync(allowlistPath)) {
  try {
    allowlist = JSON.parse(readFileSync(allowlistPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${allowlistPath}: ${err.message}`);
    process.exit(2);
  }
}

// ── Walk routes ───────────────────────────────────────────────────────
// Matches both legacy `export async function POST(...)` and the newer
// `export const POST = withApiHandler(...)` pattern. The withApiHandler
// wrapper (Phase 4 BVI handoff routes) is only compatible with the
// `export const X = withApiHandler(...)` shape, so the regex has to
// recognize both.
const MUTATING_METHOD_RE = /export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/;
const LOG_CHANGE_RE = /\blogChange\s*\(/;

const violations = [];
const orphanedExemptions = []; // exemptions for files that no longer exist

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (entry !== 'route.ts') continue;
    const rel = relative(repoRoot, full).replace(/\\/g, '/');
    const src = readFileSync(full, 'utf-8');
    if (!MUTATING_METHOD_RE.test(src)) continue; // GET-only route

    if (LOG_CHANGE_RE.test(src)) continue; // audited

    if (allowlist[rel]) continue; // explicitly exempt

    const methods = [];
    const re = /export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/g;
    let m;
    while ((m = re.exec(src)) !== null) methods.push(m[1]);
    violations.push({ file: rel, methods: [...new Set(methods)] });
  }
}

walk(apiRoot);

// Detect orphaned allowlist entries: files that no longer exist or no
// longer have mutating handlers. These should be removed so the
// allowlist stays a tight, accurate inventory.
for (const rel of Object.keys(allowlist)) {
  if (rel.startsWith('$')) continue; // metadata keys like $schema
  const full = join(repoRoot, rel);
  if (!existsSync(full)) {
    orphanedExemptions.push({ file: rel, reason: 'file no longer exists' });
    continue;
  }
  const src = readFileSync(full, 'utf-8');
  if (!MUTATING_METHOD_RE.test(src)) {
    orphanedExemptions.push({ file: rel, reason: 'no longer has mutating handlers' });
    continue;
  }
  if (LOG_CHANGE_RE.test(src)) {
    orphanedExemptions.push({ file: rel, reason: 'now calls logChange — remove the exemption' });
  }
}

// ── Report ────────────────────────────────────────────────────────────
const exemptCount = Object.keys(allowlist).filter((k) => !k.startsWith('$')).length;
console.log(`Routes audited:    ${countAudited()}`);
console.log(`Routes exempt:     ${exemptCount - orphanedExemptions.length}`);
console.log(`Orphaned exempts:  ${orphanedExemptions.length}`);
console.log(`Violations:        ${violations.length}`);

if (orphanedExemptions.length > 0) {
  console.log('\n⚠ Orphaned allowlist entries (remove these):');
  for (const o of orphanedExemptions) {
    console.log(`  ${o.file}  — ${o.reason}`);
  }
}

if (violations.length === 0 && orphanedExemptions.length === 0) {
  console.log('\n✓ Audit coverage gate passes.');
  process.exit(0);
}

if (violations.length > 0) {
  console.log('\n✗ Mutating routes without logChange or allowlist entry:\n');
  for (const v of violations) {
    console.log(`  ${v.file}  [${v.methods.join(', ')}]`);
  }
  console.log('\nFix by either:');
  console.log('  1. Calling logChange() in the mutating handler. Use an existing');
  console.log('     entityType from lib/audit.ts AuditEntityType, or extend the');
  console.log('     union if a new entity is being introduced.');
  console.log('  2. Adding to scripts/audit-coverage.allowlist.json with a one-');
  console.log('     sentence reason — required for chat/note volume cases that');
  console.log('     would drown the audit signal.');
}

if (violations.length > 0 || orphanedExemptions.length > 0) {
  process.exit(1);
}

function countAudited() {
  let n = 0;
  function w(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { w(full); continue; }
      if (entry !== 'route.ts') continue;
      const src = readFileSync(full, 'utf-8');
      if (MUTATING_METHOD_RE.test(src) && LOG_CHANGE_RE.test(src)) n++;
    }
  }
  w(apiRoot);
  return n;
}
