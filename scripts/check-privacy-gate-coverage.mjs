/**
 * check-privacy-gate-coverage.mjs
 *
 * Walks prisma/schema.prisma for every `model X { ... }`, cross-checks
 * the model name against:
 *
 *   1. The Prisma client extension in lib/db-gated.ts (the `query: { ... }`
 *      block). If the model name (camelCased) appears as a key under
 *      `query`, it's gated.
 *   2. scripts/privacy-gate-coverage.allowlist.json. Models that are
 *      intentionally NOT gated (lookup data, admin-only-by-route,
 *      junction tables) must appear here with a one-sentence reason.
 *
 * Fails when a model is in neither — that's the case where someone added
 * a new entity to the schema without thinking about visibility.
 *
 * Why: the privacy gate already covers Project, PayrollEntry,
 * Reimbursement, ProjectMessage, ProjectActivity, ProjectMention,
 * BlitzCost, ProjectAdminNote, ProjectNote. New models slip in over
 * time (e.g. blitz request, trainer override) — without a gate, they
 * inherit "anyone authenticated can read everything" by default. This
 * script is the lock-in.
 *
 * Run:
 *   npm run check:privacy-gate
 *
 * To exempt a model, add it to the allowlist with the rationale.
 * Common reasons:
 *   - "Lookup data, admin-only via /api/installers/* route guard"
 *   - "Junction table — visibility delegated to parent Project gate"
 *   - "Identity model, PII scrubbed via lib/serialize.ts at boundary"
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// ── Parse model names from schema.prisma ──────────────────────────────
const schemaSrc = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf-8');
const MODEL_RE = /^model\s+(\w+)\s*\{/gm;
const models = [];
let m;
while ((m = MODEL_RE.exec(schemaSrc)) !== null) models.push(m[1]);

if (models.length === 0) {
  console.error('No models found in prisma/schema.prisma — schema parse failed?');
  process.exit(2);
}

// ── Parse gated model keys from db-gated.ts ───────────────────────────
const gatedSrc = readFileSync(join(repoRoot, 'lib', 'db-gated.ts'), 'utf-8');
// Find the `query: {` block and pull top-level keys (camelCased model names)
const queryBlockMatch = gatedSrc.match(/query:\s*\{([\s\S]*?)\n\s\s\},?\s*\}\)/);
if (!queryBlockMatch) {
  console.error('Could not locate `query: { ... }` block in lib/db-gated.ts.');
  process.exit(2);
}
const queryBlock = queryBlockMatch[1];
// Top-level keys: lines starting with two spaces of indentation (inside
// the extension), an identifier, then `: {` — e.g. `    project: {`.
const KEY_RE = /^\s{4}(\w+):\s*\{/gm;
const gatedCamelKeys = new Set();
let km;
while ((km = KEY_RE.exec(queryBlock)) !== null) gatedCamelKeys.add(km[1]);

function camelCase(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ── Load allowlist ────────────────────────────────────────────────────
const allowlistPath = join(here, 'privacy-gate-coverage.allowlist.json');
let allowlist = {};
if (existsSync(allowlistPath)) {
  try {
    allowlist = JSON.parse(readFileSync(allowlistPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${allowlistPath}: ${err.message}`);
    process.exit(2);
  }
}

// ── Categorize each model ─────────────────────────────────────────────
const violations = [];
const orphans = [];
let gatedCount = 0;
let exemptCount = 0;

for (const model of models) {
  const camel = camelCase(model);
  const gated = gatedCamelKeys.has(camel);
  const exempt = !!allowlist[model] && !model.startsWith('$');
  if (gated) gatedCount++;
  if (exempt) exemptCount++;
  if (!gated && !exempt) violations.push(model);
  if (gated && exempt) {
    // Both: redundant — remove from allowlist
    orphans.push({ model, reason: 'model is gated; remove from allowlist' });
  }
}

// Detect allowlist entries for models that no longer exist
for (const key of Object.keys(allowlist)) {
  if (key.startsWith('$')) continue;
  if (!models.includes(key)) {
    orphans.push({ model: key, reason: 'model no longer exists in schema.prisma' });
  }
}

// ── Report ────────────────────────────────────────────────────────────
console.log(`Schema models:     ${models.length}`);
console.log(`Gated:             ${gatedCount}`);
console.log(`Allowlisted:       ${exemptCount}`);
console.log(`Orphans:           ${orphans.length}`);
console.log(`Violations:        ${violations.length}`);

if (orphans.length > 0) {
  console.log('\n⚠ Orphaned allowlist entries (clean these up):');
  for (const o of orphans) console.log(`  ${o.model}  — ${o.reason}`);
}

if (violations.length === 0 && orphans.length === 0) {
  console.log('\n✓ Privacy-gate coverage gate passes.');
  process.exit(0);
}

if (violations.length > 0) {
  console.log('\n✗ Schema models without a gate or allowlist entry:\n');
  for (const v of violations) console.log(`  ${v}`);
  console.log('\nFix by either:');
  console.log('  1. Adding a gate function + extension entry in lib/db-gated.ts.');
  console.log('     Pattern-match an existing project-scoped model (ProjectMessage)');
  console.log('     for delegated visibility, or BlitzCost for admin-only.');
  console.log('  2. Adding to scripts/privacy-gate-coverage.allowlist.json with a');
  console.log('     one-sentence reason — visible in CI failure and code review.');
}

process.exit(1);
