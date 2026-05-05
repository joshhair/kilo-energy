#!/usr/bin/env node
/**
 * One-shot sweep: hero stat callsites use accent-X-text but should use
 * accent-X-display now that we have a punchier variant tuned for ≥3:1
 * large-text on white card.
 *
 * Heuristic: swap accent-X-text → accent-X-display ONLY on lines that
 * also contain a display-context indicator (DM Serif Display family,
 * stat-value class, text-3xl / text-4xl, large clamp ranges, font-black
 * tabular-nums). Small label uses (text-xs, regular size) keep -text
 * because their ≥4.5:1 contrast on softs matters more than punch.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const ACCENTS = ['emerald', 'cyan', 'blue', 'red', 'amber', 'purple', 'teal'];

// Detect display-context indicators that mean "this is a hero/large stat,
// punchier visual is welcome." Conservative — small labels keep -text.
const DISPLAY_INDICATORS = [
  /'DM Serif Display'/,
  /m-font-display/,
  /\bstat-value\b/,
  /\btext-3xl\b/,
  /\btext-4xl\b/,
  /\btext-5xl\b/,
  /\btext-6xl\b/,
  /\btext-2xl\s+font-black\b/,
  /font-black\s+tabular-nums\b/,
  /fontSize:\s*['"]?clamp\([^)]*[2-9](\.\d+)?rem/,
  /fontSize:\s*\d{2,}\b/,           // numeric pixel sizes ≥10
];

// Find every tsx file under app/ that uses any accent-*-text token.
const files = execSync(
  `grep -rlE "accent-(emerald|cyan|blue|red|amber|purple|teal)-text" --include='*.tsx' app/`,
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

const replacements = ACCENTS.map((a) => ({
  textRegex: new RegExp(`accent-${a}-text(?!\\w)`, 'g'),
  display: `accent-${a}-display`,
}));

let totalSwaps = 0;
const fileSwapCounts = [];
for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const lines = original.split('\n');
  let fileSwaps = 0;

  const updated = lines.map((line) => {
    const isDisplay = DISPLAY_INDICATORS.some((rx) => rx.test(line));
    if (!isDisplay) return line;
    let next = line;
    for (const { textRegex, display } of replacements) {
      const matches = next.match(textRegex);
      if (matches) {
        next = next.replace(textRegex, display);
        fileSwaps += matches.length;
      }
    }
    return next;
  }).join('\n');

  if (fileSwaps > 0) {
    writeFileSync(file, updated);
    fileSwapCounts.push({ file, count: fileSwaps });
    totalSwaps += fileSwaps;
  }
}

fileSwapCounts.sort((a, b) => b.count - a.count);
for (const { file, count } of fileSwapCounts) {
  console.log(`  ${count}× ${file}`);
}
console.log(`\n${totalSwaps} swaps across ${fileSwapCounts.length} files`);
