/**
 * check-primitive-usage.mjs
 *
 * Walks app/dashboard/settings/sections/*.tsx and flags raw `<input>` /
 * `<button>` patterns that should be using the shared primitives in
 * components/ui/. The goal is to lock in the consistency the
 * PR 2–9 migrations established — once a section is on the primitives,
 * it shouldn't silently drift back to inline-styled buttons + inputs
 * the next time someone adds a feature.
 *
 * Heuristic-based, not a full AST analysis. Looks for two patterns:
 *
 *   1. `<input` not preceded by an annotation, OUTSIDE a context where
 *      the inline form is the right answer (e.g. inside a `<TextInput`
 *      JSX block, where `<input` is the underlying element).
 *   2. `<button` with the legacy primary-button styling (gradient or
 *      `bg-emerald-solid` solid) that should be a PrimaryButton.
 *
 * Per-section thresholds are seeded in
 * scripts/primitive-usage.allowlist.json with a count for each
 * known-untouched custom-pattern. The check fails when:
 *   - A section's raw count EXCEEDS the threshold (drift in the wrong
 *     direction)
 *   - A section's raw count is BELOW the threshold (drift toward
 *     consistency, but the allowlist needs updating to reflect it —
 *     keeps the allowlist a tight inventory)
 *
 * Run:
 *   npm run check:primitives
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const sectionsDir = join(repoRoot, 'app', 'dashboard', 'settings', 'sections');

const allowlistPath = join(here, 'primitive-usage.allowlist.json');
let allowlist = {};
if (existsSync(allowlistPath)) {
  try {
    allowlist = JSON.parse(readFileSync(allowlistPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to parse ${allowlistPath}: ${err.message}`);
    process.exit(2);
  }
}

// ── Patterns ──────────────────────────────────────────────────────────
// Match `<input` opening an element. Skip the underlying-element call
// inside the TextInput primitive itself by skipping anything matching
// `// allow-raw-input:` on the same line as a guard mechanism.
const RAW_INPUT_RE = /<input(?=[\s/>])/g;
// Match `<button` opening, but skip cases where the next ~120 chars
// contain `IconButton`, `PrimaryButton`, etc. (those are JSX names that
// happen to have `<button` as substring? actually they don't — JSX uses
// `<PrimaryButton`, capital P. So `<button` is always raw.)
const RAW_BUTTON_RE = /<button(?=[\s/>])/g;

// ── Walk ──────────────────────────────────────────────────────────────
const sections = readdirSync(sectionsDir)
  .filter((f) => f.endsWith('.tsx'))
  .sort();

const results = [];
for (const file of sections) {
  const full = join(sectionsDir, file);
  const src = readFileSync(full, 'utf-8');

  // Strip JSX comments + line comments — false positives in
  // explanatory text would inflate counts.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const rawInputs = (stripped.match(RAW_INPUT_RE) ?? []).length;
  const rawButtons = (stripped.match(RAW_BUTTON_RE) ?? []).length;

  results.push({ file, rawInputs, rawButtons });
}

// ── Compare against allowlist ─────────────────────────────────────────
const violations = [];
for (const r of results) {
  const expected = allowlist[r.file];
  if (!expected) {
    violations.push({
      file: r.file,
      kind: 'missing_entry',
      message: `No allowlist entry. Add { rawInputs: ${r.rawInputs}, rawButtons: ${r.rawButtons}, reason: "<one-line>" }.`,
    });
    continue;
  }
  if (r.rawInputs > expected.rawInputs) {
    violations.push({
      file: r.file,
      kind: 'regressed_inputs',
      message: `rawInputs went from ${expected.rawInputs} → ${r.rawInputs}. Migrate the new inline <input> to <TextInput>, or update the allowlist with rationale.`,
    });
  } else if (r.rawInputs < expected.rawInputs) {
    violations.push({
      file: r.file,
      kind: 'progress_unrecorded',
      message: `rawInputs dropped ${expected.rawInputs} → ${r.rawInputs}. Lower the allowlist threshold to lock in the win.`,
    });
  }
  if (r.rawButtons > expected.rawButtons) {
    violations.push({
      file: r.file,
      kind: 'regressed_buttons',
      message: `rawButtons went from ${expected.rawButtons} → ${r.rawButtons}. Migrate the new inline <button> to <PrimaryButton> / <IconButton>, or update the allowlist with rationale.`,
    });
  } else if (r.rawButtons < expected.rawButtons) {
    violations.push({
      file: r.file,
      kind: 'progress_unrecorded',
      message: `rawButtons dropped ${expected.rawButtons} → ${r.rawButtons}. Lower the allowlist threshold to lock in the win.`,
    });
  }
}

// ── Report ────────────────────────────────────────────────────────────
console.log('Section primitive-usage report:');
console.log('');
const fileColWidth = Math.max(...results.map((r) => r.file.length));
console.log('  ' + 'file'.padEnd(fileColWidth) + '  rawInputs  rawButtons');
for (const r of results) {
  const exp = allowlist[r.file] ?? { rawInputs: '?', rawButtons: '?' };
  const a = `${r.rawInputs}/${exp.rawInputs}`;
  const b = `${r.rawButtons}/${exp.rawButtons}`;
  console.log(`  ${r.file.padEnd(fileColWidth)}  ${a.padEnd(9)}  ${b}`);
}

if (violations.length === 0) {
  console.log('\n✓ All sections match their allowlist thresholds.');
  process.exit(0);
}

console.log('\n✗ Found drift:\n');
for (const v of violations) {
  console.log(`  ${v.file}  [${v.kind}]`);
  console.log(`    ${v.message}`);
}
console.log('\nFix paths:');
console.log('  - Regressed: migrate the new inline element to a primitive');
console.log('  - Progress unrecorded: edit primitive-usage.allowlist.json to');
console.log('    match the new lower count (locks in the consistency win)');
console.log('  - Missing entry: a new section file appeared. Add an entry.');

process.exit(1);
