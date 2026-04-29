/**
 * check-sensitivity-coverage.mjs
 *
 * Parse @sensitivity admin annotations from prisma/schema.prisma, then
 * grep the codebase for raw references to those fields. Fail CI if any
 * reference appears outside an allowlist of admin-only files.
 *
 * Why this exists: pricing data (kiloPerW, subDealerPerW) is the
 * company's competitive moat. Leaks would expose margins. The privacy
 * gate (lib/db-gated.ts) and serializer scrubber are the runtime
 * defenses; this script is the static defense — it catches new code
 * that bypasses those layers before the PR merges.
 *
 * Allowlist: code paths that legitimately read sensitive fields directly,
 * because they ARE the admin-only path (the gate itself, the scrubber,
 * server-authoritative commission compute, etc).
 *
 * Run:
 *   npm run check:sensitivity
 *
 * Gate behavior:
 *   - Exit 0: every reference is in an allowlisted file
 *   - Exit 1: at least one reference is outside the allowlist (CI fail)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// ── Parse @sensitivity admin fields from schema.prisma ────────────────
const schemaSrc = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf-8');

// Pattern: a triple-slash JSDoc comment that contains "@sensitivity admin"
// followed by a field declaration on the next non-comment line.
const sensitiveFields = new Set();
const lines = schemaSrc.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!/@sensitivity\s+admin/i.test(lines[i])) continue;
  // Find the next non-comment line — that's the field declaration.
  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j].trim();
    if (!next || next.startsWith('///') || next.startsWith('//')) continue;
    const m = next.match(/^(\w+)\s+/);
    if (m) sensitiveFields.add(m[1]);
    break;
  }
}

if (sensitiveFields.size === 0) {
  console.log('No @sensitivity admin fields found. Nothing to check.');
  process.exit(0);
}

// ── Allowlist: files where direct references are intentional ──────────
const allowlistPatterns = [
  // The privacy gate itself wraps prisma; it must reference the fields.
  /^lib[\\/]db-gated\.ts$/,
  /^lib[\\/]db\.ts$/,
  // Serialization layer enforces visibility — it MUST see the fields to scrub.
  /^lib[\\/]serialize\.ts$/,
  /^lib[\\/]fieldVisibility\.ts$/,
  // Server-authoritative commission compute is admin-trusted.
  /^lib[\\/]commission(-server|-core)?\.ts$/,
  /^lib[\\/]commission\.ts$/,
  /^lib[\\/]data\.ts$/,
  // Admin-only API endpoints that explicitly serve baseline data.
  /^app[\\/]api[\\/]baseline-data[\\/]/,
  /^app[\\/]api[\\/]admin[\\/]/,
  /^app[\\/]api[\\/]products[\\/]/,
  /^app[\\/]api[\\/]product-pricing[\\/]/,
  /^app[\\/]api[\\/]installer-pricing[\\/]/,
  /^app[\\/]api[\\/]installers[\\/]/,
  // Validation schemas — server-side only, never user-rendered.
  /^lib[\\/]schemas[\\/]/,
  // Admin-only routes that compute commission server-side.
  /^app[\\/]api[\\/]projects[\\/].+[\\/]route\.ts$/,
  /^app[\\/]api[\\/]data[\\/]route\.ts$/,
  // Calculator + new-deal pages need pricing for live commission preview;
  // they're rep-facing but only the closer/setter rates are shown — kilo
  // rendering is gated by isAdmin checks at render time.
  /^app[\\/]dashboard[\\/]new-deal[\\/]/,
  /^app[\\/]dashboard[\\/]calculator[\\/]/,
  // Admin settings UI (Baselines page) explicitly serves admins.
  /^app[\\/]dashboard[\\/]settings[\\/]/,
  // The Project Detail Edit Modal (admin/PM scoped) shows baseline preview.
  /^app[\\/]dashboard[\\/]projects[\\/]/,
  // Mobile project detail equivalent (admin/PM scoped).
  /^app[\\/]dashboard[\\/]mobile[\\/]MobileProjectDetail\.tsx$/,
  /^app[\\/]dashboard[\\/]mobile[\\/]MobileNewDeal\.tsx$/,
  /^app[\\/]dashboard[\\/]mobile[\\/]MobileCalculator\.tsx$/,
  // Generated Prisma client.
  /^lib[\\/]generated[\\/]/,
  // Tests are exempt (they exercise the contract, including sensitive fields).
  /^tests[\\/]/,
  // One-off scripts — admin-run, never user-facing.
  /^scripts[\\/]/,
  // Admin-context helpers.
  /^lib[\\/]admin/,
  /^lib[\\/]context[\\/]installers\.ts$/,
  /^lib[\\/]context\.tsx$/,
  // Audit log / observability — internal admin only.
  /^lib[\\/]audit/,
  // Admin/PM dashboards: surfaces that are gated to admin/PM at the
  // routing layer (requireAdminOrPM) and only render kilo cost when
  // viewer.role === 'admin' OR (vendor PM AND scopedInstallerId match).
  /^app[\\/]dashboard[\\/]components[\\/]AdminDashboard\.tsx$/,
  /^app[\\/]dashboard[\\/]mobile[\\/]MobileAdminDashboard\.tsx$/,
  /^app[\\/]dashboard[\\/]mobile[\\/]MobileSettings\.tsx$/,
  // Blitz profitability surfaces — admin/PM-scoped, show margins/costs.
  /^app[\\/]dashboard[\\/]blitz[\\/]/,
  /^app[\\/]dashboard[\\/]mobile[\\/]blitz-detail[\\/]/,
  // Computed blitz metrics: server-side aggregation, admin/PM only.
  /^lib[\\/]blitzComputed\.ts$/,
];

function isAllowlisted(relPath) {
  return allowlistPatterns.some((pattern) => pattern.test(relPath));
}

// ── Walk the source tree looking for references ───────────────────────
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === 'dist') continue;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|mts|mjs|js|jsx)$/.test(entry)) continue;

    const rel = relative(repoRoot, full);
    if (isAllowlisted(rel)) continue;

    const src = readFileSync(full, 'utf-8');
    for (const fieldName of sensitiveFields) {
      // Match the field name as a whole word — this is a heuristic, not
      // a full AST analysis. False positives are possible (a variable
      // happening to be named "kiloPerW" without referencing the column),
      // but they should be allowlisted explicitly with a comment.
      const re = new RegExp(`\\b${fieldName}\\b`, 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        // Skip references inside comments — find the line and check.
        const upToMatch = src.slice(0, m.index);
        const lineStart = upToMatch.lastIndexOf('\n') + 1;
        const lineText = src.slice(lineStart, src.indexOf('\n', m.index) === -1 ? src.length : src.indexOf('\n', m.index));
        if (/^\s*\/\//.test(lineText) || /^\s*\*/.test(lineText)) continue;
        const lineNum = upToMatch.split('\n').length;
        violations.push({ file: rel, line: lineNum, field: fieldName, snippet: lineText.trim().slice(0, 120) });
      }
    }
  }
}

walk(join(repoRoot, 'app'));
walk(join(repoRoot, 'lib'));

// ── Report ─────────────────────────────────────────────────────────────
console.log(`Sensitive fields tracked: ${[...sensitiveFields].join(', ')}`);

if (violations.length === 0) {
  console.log('✓ All references to sensitive fields are in allowlisted files.');
  process.exit(0);
}

console.log(`\n✗ Found ${violations.length} reference(s) to sensitive fields outside the allowlist:\n`);
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  [${v.field}]`);
  console.log(`    ${v.snippet}`);
}
console.log('\nIf this reference is legitimate (an admin-only code path), add the file');
console.log('to the allowlist in scripts/check-sensitivity-coverage.mjs with a brief');
console.log('justification comment. Otherwise, route the access through lib/db-gated.ts');
console.log('or lib/serialize.ts so visibility is enforced at the boundary.');

process.exit(1);
