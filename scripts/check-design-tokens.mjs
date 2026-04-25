#!/usr/bin/env node
/**
 * check-design-tokens.mjs — gate against raw hex/rgba regressions.
 *
 * Run: npm run check:tokens
 *
 * Walks app/ and lib/ and reports raw color literals inside inline style
 * props or Tailwind arbitrary class syntax. Compares the count against a
 * frozen baseline (docs/.tokens-audit/baseline.json). Exits non-zero if
 * the count grew, so a PR that adds new raw hex fails CI / pre-push.
 *
 * Why this exists: docs/design-tokens.md mandates `var(--token)` for all
 * theme-able colors. Without enforcement, the agent loop adds 5-10 raw
 * hex per cycle and the codebase drifts.
 *
 * Adjusting the baseline: if you intentionally add a hex (e.g. a new
 * brand-mark variant or chart color that doesn't fit the taxonomy),
 * update docs/.tokens-audit/baseline.json with the new count and a
 * note in the commit message explaining why the raw value is correct.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'lib'];
const BASELINE_PATH = 'docs/.tokens-audit/baseline.json';

// Files / paths to skip. Tests, generated code, and SVG illustrations
// don't count — we expect raw hex in those.
const SKIP_PATTERNS = [
  /node_modules/,
  /\.next/,
  /generated/,
  /\.test\./,
  /\.spec\./,
  /apple-icon\.tsx$/,
  /icon\.tsx$/,
];

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_PATTERNS.some((re) => re.test(full))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA_RE = /rgba?\([^)]+\)/g;

function countLiterals() {
  let hex = 0;
  let rgba = 0;
  for (const root of ROOTS) {
    for (const file of walkFiles(root)) {
      const content = readFileSync(file, 'utf8');
      const hexMatches = content.match(HEX_RE) ?? [];
      const rgbaMatches = content.match(RGBA_RE) ?? [];
      hex += hexMatches.length;
      rgba += rgbaMatches.length;
    }
  }
  return { hex, rgba };
}

const baseline = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
})();

const current = countLiterals();

if (!baseline) {
  console.log('No baseline yet — writing one.');
  console.log(JSON.stringify(current, null, 2));
  console.log(`Save this to ${BASELINE_PATH} and rerun.`);
  process.exit(0);
}

const hexDelta = current.hex - baseline.hex;
const rgbaDelta = current.rgba - baseline.rgba;

console.log(`Raw hex literals: ${current.hex} (baseline ${baseline.hex}, delta ${hexDelta >= 0 ? '+' : ''}${hexDelta})`);
console.log(`Raw rgba()/rgb(): ${current.rgba} (baseline ${baseline.rgba}, delta ${rgbaDelta >= 0 ? '+' : ''}${rgbaDelta})`);

if (hexDelta > 0 || rgbaDelta > 0) {
  console.error('');
  console.error('FAIL: raw color literals increased above baseline.');
  console.error('See docs/design-tokens.md — use var(--token) for theme-able colors.');
  console.error(`If the addition is intentional, bump ${BASELINE_PATH} in the same commit.`);
  process.exit(1);
}

if (hexDelta < 0 || rgbaDelta < 0) {
  console.log('');
  console.log(`Nice — count went down. Update ${BASELINE_PATH} to lock in the gain:`);
  console.log(JSON.stringify(current, null, 2));
}
