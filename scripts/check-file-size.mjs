/**
 * check-file-size.mjs — mega-file guard. Keeps the codebase organized by
 * enforcing a per-file line budget, the same ratchet pattern as
 * check-primitive-usage / check-sensitivity-coverage:
 *
 *   - A NEW (non-allowlisted) source file over HARD_MAX fails the gate — split
 *     it into cohesive modules, or (last resort) add an allowlist entry with a
 *     written reason.
 *   - LEGACY files over HARD_MAX are allowlisted at their current size and may
 *     only SHRINK — they can never grow past the recorded baseline. This makes
 *     the existing mega files a forcing-function backlog: every edit must leave
 *     them the same size or smaller.
 *   - Files over SOFT_MAX get a non-blocking advisory ("consider splitting"),
 *     the "beautiful, organized code" aspiration without breaking the build.
 *
 * Run:
 *   npm run check:file-size            # CI gate
 *   node scripts/check-file-size.mjs --update   # re-baseline the allowlist
 *                                               # (after a real split that
 *                                               #  shrinks a file, to lock it in)
 *
 * Tuning: lower HARD_MAX over time as the codebase shrinks toward the SOFT bar.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(here, '..');
const ALLOWLIST_PATH = join(here, 'file-size.allowlist.json');

const HARD_MAX = 800; // a file over this is a "mega file" — split it
const SOFT_MAX = 500; // advisory threshold — Netflix-grade target for most files
const ROOTS = ['app', 'lib', 'components'];
const SKIP_DIR = new Set(['generated', 'node_modules', '.next']);
const SKIP_FILE = (f) => f.endsWith('.d.ts') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const IS_SRC = (f) => /\.[cm]?[jt]sx?$/.test(f);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (IS_SRC(entry.name) && !SKIP_FILE(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => (existsSync(join(ROOT, r)) ? walk(join(ROOT, r)) : []));
const lineCount = (abs) => readFileSync(abs, 'utf-8').split('\n').length;
const rel = (abs) => relative(ROOT, abs).split(sep).join('/'); // stable POSIX keys

const sizes = files.map((abs) => ({ path: rel(abs), lines: lineCount(abs) })).sort((a, b) => b.lines - a.lines);

// ── --update: regenerate the allowlist from current oversized files ──────────
if (process.argv.includes('--update')) {
  const allow = {};
  for (const f of sizes) if (f.lines > HARD_MAX) allow[f.path] = f.lines;
  const payload = {
    $schema: `Per-file line-count ceiling for files that exceed HARD_MAX (${HARD_MAX}). Each value is the baseline at capture time; the gate fails if the file GROWS past it. Shrink a file then run \`node scripts/check-file-size.mjs --update\` to lock the win. New files must stay <= ${HARD_MAX} (split, don't allowlist, unless truly unavoidable with a written reason).`,
    ...allow,
  };
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(allow).length} allowlisted files to file-size.allowlist.json (HARD_MAX=${HARD_MAX}).`);
  process.exit(0);
}

const allowlist = existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8')) : {};
const legacyCount = Object.keys(allowlist).filter((k) => k !== '$schema').length;

const violations = [];
const grewIns = [];
const soft = [];
for (const f of sizes) {
  const baseline = allowlist[f.path];
  if (baseline != null) {
    if (f.lines > baseline) grewIns.push({ ...f, baseline });
  } else if (f.lines > HARD_MAX) {
    violations.push(f);
  } else if (f.lines > SOFT_MAX) {
    soft.push(f);
  }
}

if (soft.length) {
  console.log(`\nℹ ${soft.length} file(s) over the ${SOFT_MAX}-line soft target (advisory — consider splitting):`);
  for (const f of soft.slice(0, 15)) console.log(`    ${f.lines}  ${f.path}`);
  if (soft.length > 15) console.log(`    …and ${soft.length - 15} more`);
}

if (violations.length === 0 && grewIns.length === 0) {
  console.log(`\n✓ No new mega files. ${legacyCount} legacy file(s) allowlisted (ratcheting down); HARD_MAX=${HARD_MAX}.`);
  process.exit(0);
}

console.log('\n✗ File-size gate failed:\n');
for (const f of violations) {
  console.log(`  NEW MEGA FILE  ${f.lines} lines  ${f.path}`);
  console.log(`    > ${HARD_MAX} max. Split into cohesive modules (extract components/helpers into a feature folder), or — only if truly unavoidable — add it to file-size.allowlist.json with a written reason.`);
}
for (const f of grewIns) {
  console.log(`  GREW PAST BASELINE  ${f.path}: ${f.baseline} → ${f.lines}`);
  console.log(`    Allowlisted legacy files may only shrink. Move the new code into a separate module instead of growing this one.`);
}
process.exit(1);
