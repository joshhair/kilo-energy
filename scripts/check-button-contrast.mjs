/**
 * check:button-contrast — guard against the white-text-on-emerald regression.
 *
 * Background:
 *   The "View Projects" button on MobileNewDeal.tsx kept regressing to
 *   white text on bright emerald (unreadable in dark mode). Root cause:
 *   inline style `background: 'var(--accent-emerald-text)'` (which is the
 *   TEXT color, intended for emerald text on dark surfaces — NOT a button
 *   background) paired with `color: '#fff'`. Lighter accent colors when
 *   used as backgrounds need dark foreground text (--text-on-accent = #000)
 *   to clear WCAG contrast.
 *
 * This gate scans every .tsx file under app/ + lib/ for two bad patterns:
 *
 *   1. Hardcoded `color: '#fff'` or `color: 'white'` in inline styles
 *      (use `var(--text-on-accent)` for buttons on accent fills, or
 *      `var(--text-primary)` if you genuinely mean primary text — but
 *      not `'#fff'`/`'white'` literal, since that loses theme-awareness).
 *
 *   2. `background: 'var(--accent-*-text)'` or `background: 'var(--accent-*-display)'`
 *      — these tokens are TEXT colors (high-contrast for use ON surfaces),
 *      NOT BACKGROUND fills. Using them as backgrounds breaks dark/light
 *      mode parity and forces contrast workarounds.
 *
 * Allowlist (scripts/button-contrast.allowlist.json) for legitimate
 * one-offs (e.g., illustration components, brand-mark fills).
 *
 * Exit 1 on any unallowlisted violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCAN_DIRS = ['app', 'lib'];
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'generated', 'dist', '.git']);

const ALLOWLIST_PATH = join(ROOT, 'scripts', 'button-contrast.allowlist.json');
let allowlist = { whiteText: [], textColorAsBackground: [] };
try {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
} catch {
  // First run — allowlist file doesn't exist yet, that's fine.
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

const violations = [];

// Pattern 1: literal white text in inline styles
const WHITE_TEXT_RE = /color:\s*['"](#fff|#FFF|#ffffff|#FFFFFF|white)['"]/g;

// Pattern 2: text-color tokens used as backgrounds
const BAD_BG_RE = /background(?:Color)?:\s*['"]var\(--accent-[a-z]+-(text|display)\)['"]/g;

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const src = readFileSync(file, 'utf-8');
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const locKey = `${rel}:${ln}`;

    WHITE_TEXT_RE.lastIndex = 0;
    if (WHITE_TEXT_RE.test(line)) {
      if (!allowlist.whiteText?.includes(locKey)) {
        violations.push({
          kind: 'whiteText',
          file: rel,
          line: ln,
          snippet: line.trim().slice(0, 120),
          fix: `Replace with color: 'var(--text-on-accent)' (for buttons on accent fills) or 'var(--text-primary)' (for general text).`,
        });
      }
    }
    BAD_BG_RE.lastIndex = 0;
    if (BAD_BG_RE.test(line)) {
      if (!allowlist.textColorAsBackground?.includes(locKey)) {
        violations.push({
          kind: 'textColorAsBackground',
          file: rel,
          line: ln,
          snippet: line.trim().slice(0, 120),
          fix: `Use --accent-*-solid (filled button bg) or --accent-*-soft (tinted surface) instead of the *-text/*-display tokens which are text colors.`,
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ check:button-contrast — ${files.length} files scanned, 0 violations.`);
  if ((allowlist.whiteText?.length ?? 0) + (allowlist.textColorAsBackground?.length ?? 0) > 0) {
    console.log(`  (${(allowlist.whiteText?.length ?? 0)} whiteText + ${(allowlist.textColorAsBackground?.length ?? 0)} textColorAsBackground allowlist entries.)`);
  }
  process.exit(0);
}

console.error(`✗ check:button-contrast — ${violations.length} violation(s):`);
for (const v of violations) {
  console.error(`\n  ${v.file}:${v.line}  [${v.kind}]`);
  console.error(`    ${v.snippet}`);
  console.error(`    Fix: ${v.fix}`);
}
console.error(`\nIf the violation is intentional, add it to ${relative(ROOT, ALLOWLIST_PATH)}:`);
console.error(`  { "whiteText": ["path/to/file.tsx:LINE", ...], "textColorAsBackground": [...] }`);
process.exit(1);
