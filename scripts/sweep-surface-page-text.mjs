#!/usr/bin/env node
/**
 * One-shot sweep: replace `color: 'var(--surface-page)'` on accent gradient
 * buttons with `color: 'var(--text-on-accent)'`.
 *
 * Why: --surface-page flips from near-black (dark) to near-white (light).
 * On an emerald→cyan gradient that's correct in dark mode but invisible
 * in light mode (white-on-light-emerald). --text-on-accent stays #000 in
 * both themes, giving consistent dark text on bright accent fills.
 *
 * Sweeps all .tsx files under app/. Single-quoted form only — keeps the
 * substitution surgical.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync(
  `grep -rlE "color: *'var\\(--surface-page\\)'" --include='*.tsx' app/`,
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

let totalSwaps = 0;
for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const updated = original.replace(
    /color:\s*'var\(--surface-page\)'/g,
    "color: 'var(--text-on-accent)'",
  );
  const swaps = (original.match(/color:\s*'var\(--surface-page\)'/g) || []).length;
  if (swaps > 0) {
    writeFileSync(file, updated);
    console.log(`  ${swaps}× ${file}`);
    totalSwaps += swaps;
  }
}

console.log(`\n${totalSwaps} swaps across ${files.length} files`);
