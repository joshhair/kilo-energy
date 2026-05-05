// One-shot mass swap of hardcoded rgba/hex literals to canonical tokens.
// Run: node scripts/one-shot-token-sweep.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (e === 'node_modules' || e === '.next' || e === 'dist' || e.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.(tsx|ts)$/.test(e) && !e.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const root = process.argv[2] || 'app';
const files = walk(root);

const RULES = [
  // White-on-dark utility alphas → text-primary mix (auto-themes)
  ['rgba(255, 255, 255, 0.02)', 'color-mix(in srgb, var(--text-primary) 2%, transparent)'],
  ['rgba(255,255,255,0.02)',    'color-mix(in srgb, var(--text-primary) 2%, transparent)'],
  ['rgba(255, 255, 255, 0.03)', 'color-mix(in srgb, var(--text-primary) 3%, transparent)'],
  ['rgba(255,255,255,0.03)',    'color-mix(in srgb, var(--text-primary) 3%, transparent)'],
  ['rgba(255, 255, 255, 0.04)', 'color-mix(in srgb, var(--text-primary) 4%, transparent)'],
  ['rgba(255,255,255,0.04)',    'color-mix(in srgb, var(--text-primary) 4%, transparent)'],
  ['rgba(255, 255, 255, 0.05)', 'color-mix(in srgb, var(--text-primary) 5%, transparent)'],
  ['rgba(255,255,255,0.05)',    'color-mix(in srgb, var(--text-primary) 5%, transparent)'],
  ['rgba(255, 255, 255, 0.06)', 'color-mix(in srgb, var(--text-primary) 6%, transparent)'],
  ['rgba(255,255,255,0.06)',    'color-mix(in srgb, var(--text-primary) 6%, transparent)'],
  ['rgba(255, 255, 255, 0.07)', 'color-mix(in srgb, var(--text-primary) 7%, transparent)'],
  ['rgba(255,255,255,0.07)',    'color-mix(in srgb, var(--text-primary) 7%, transparent)'],
  ['rgba(255, 255, 255, 0.08)', 'color-mix(in srgb, var(--text-primary) 8%, transparent)'],
  ['rgba(255,255,255,0.08)',    'color-mix(in srgb, var(--text-primary) 8%, transparent)'],
  ['rgba(255, 255, 255, 0.1)',  'color-mix(in srgb, var(--text-primary) 10%, transparent)'],
  ['rgba(255,255,255,0.1)',     'color-mix(in srgb, var(--text-primary) 10%, transparent)'],
  ['rgba(255, 255, 255, 0.12)', 'color-mix(in srgb, var(--text-primary) 12%, transparent)'],
  ['rgba(255,255,255,0.12)',    'color-mix(in srgb, var(--text-primary) 12%, transparent)'],
  ['rgba(255, 255, 255, 0.15)', 'color-mix(in srgb, var(--text-primary) 15%, transparent)'],
  ['rgba(255,255,255,0.15)',    'color-mix(in srgb, var(--text-primary) 15%, transparent)'],
  ['rgba(255, 255, 255, 0.18)', 'color-mix(in srgb, var(--text-primary) 18%, transparent)'],
  ['rgba(255,255,255,0.18)',    'color-mix(in srgb, var(--text-primary) 18%, transparent)'],
  ['rgba(255, 255, 255, 0.2)',  'color-mix(in srgb, var(--text-primary) 20%, transparent)'],
  ['rgba(255,255,255,0.2)',     'color-mix(in srgb, var(--text-primary) 20%, transparent)'],

  ['rgba(255, 255, 255, 0.25)', 'var(--text-dim)'],
  ['rgba(255,255,255,0.25)',    'var(--text-dim)'],
  ['rgba(255, 255, 255, 0.3)',  'var(--text-dim)'],
  ['rgba(255,255,255,0.3)',     'var(--text-dim)'],
  ['rgba(255, 255, 255, 0.35)', 'var(--text-muted)'],
  ['rgba(255,255,255,0.35)',    'var(--text-muted)'],
  ['rgba(255, 255, 255, 0.4)',  'var(--text-muted)'],
  ['rgba(255,255,255,0.4)',     'var(--text-muted)'],
  ['rgba(255, 255, 255, 0.5)',  'var(--text-muted)'],
  ['rgba(255,255,255,0.5)',     'var(--text-muted)'],
  ['rgba(255, 255, 255, 0.6)',  'var(--text-secondary)'],
  ['rgba(255,255,255,0.6)',     'var(--text-secondary)'],
  ['rgba(255, 255, 255, 0.7)',  'var(--text-secondary)'],
  ['rgba(255,255,255,0.7)',     'var(--text-secondary)'],
  ['rgba(255, 255, 255, 0.8)',  'var(--text-primary)'],
  ['rgba(255,255,255,0.8)',     'var(--text-primary)'],
  ['rgba(255, 255, 255, 0.9)',  'var(--text-primary)'],
  ['rgba(255,255,255,0.9)',     'var(--text-primary)'],

  // Navy fills
  ['rgba(13, 21, 37, 0.4)',  'color-mix(in srgb, var(--surface-pressed) 60%, transparent)'],
  ['rgba(13,21,37,0.4)',     'color-mix(in srgb, var(--surface-pressed) 60%, transparent)'],
  ['rgba(13, 21, 37, 0.6)',  'var(--surface-pressed)'],
  ['rgba(13,21,37,0.6)',     'var(--surface-pressed)'],
  ['rgba(13, 21, 37, 0.8)',  'var(--surface-card)'],
  ['rgba(13,21,37,0.8)',     'var(--surface-card)'],
  ['rgba(13, 21, 37, 1)',    'var(--surface-card)'],
  ['rgba(13,21,37,1)',       'var(--surface-card)'],
  ['rgba(13, 27, 46, 0.85)', 'color-mix(in srgb, var(--surface-card) 85%, transparent)'],
  ['rgba(13,27,46,0.85)',    'color-mix(in srgb, var(--surface-card) 85%, transparent)'],
  ['rgba(13, 27, 46, 0.4)',  'color-mix(in srgb, var(--surface-card) 40%, transparent)'],
  ['rgba(13,27,46,0.4)',     'color-mix(in srgb, var(--surface-card) 40%, transparent)'],

  // Navy borders
  ['rgba(26, 40, 64, 0.4)', 'color-mix(in srgb, var(--border-default) 70%, transparent)'],
  ['rgba(26,40,64,0.4)',    'color-mix(in srgb, var(--border-default) 70%, transparent)'],
  ['rgba(26, 40, 64, 0.5)', 'var(--border-default)'],
  ['rgba(26,40,64,0.5)',    'var(--border-default)'],
  ['rgba(26, 40, 64, 0.6)', 'var(--border-default)'],
  ['rgba(26,40,64,0.6)',    'var(--border-default)'],

  // Other navy variants
  ['rgba(8, 12, 24, 0.88)',  'color-mix(in srgb, var(--surface-page) 88%, transparent)'],
  ['rgba(8,12,24,0.88)',     'color-mix(in srgb, var(--surface-page) 88%, transparent)'],
  ['rgba(6, 14, 26, 0.92)',  'color-mix(in srgb, var(--surface-page) 92%, transparent)'],
  ['rgba(6,14,26,0.92)',     'color-mix(in srgb, var(--surface-page) 92%, transparent)'],
  ['rgba(6, 14, 26, 1)',     'var(--surface-page)'],
  ['rgba(6,14,26,1)',        'var(--surface-page)'],
  ['rgba(22, 25, 32, 0.5)',  'color-mix(in srgb, var(--surface-card) 50%, transparent)'],
  ['rgba(22,25,32,0.5)',     'color-mix(in srgb, var(--surface-card) 50%, transparent)'],

  // Hardcoded dark hex used as backgrounds (single-quoted)
  ["'#050d18'", "'var(--surface-page)'"],
  ["'#0a1628'", "'var(--surface-page)'"],
  ["'#0d2040'", "'var(--surface-pressed)'"],
  ["'#080c14'", "'var(--surface-page)'"],
  ["'#040c1c'", "'var(--surface-page)'"],
  ["'#060e22'", "'var(--surface-page)'"],
  ["'#120b00'", "'var(--surface-card)'"],
  ["'#180e00'", "'var(--surface-card)'"],
  ["'#161920'", "'var(--surface-card)'"],
  ["'#1d2028'", "'var(--surface-elevated)'"],
  ["'#0d1525'", "'var(--surface-pressed)'"],
  ["'#141820'", "'var(--surface-pressed)'"],
  ['"#050d18"', '"var(--surface-page)"'],
  ['"#0a1628"', '"var(--surface-page)"'],
  ['"#161920"', '"var(--surface-card)"'],
  ['"#1d2028"', '"var(--surface-elevated)"'],
  ['"#0d1525"', '"var(--surface-pressed)"'],
];

let totalSwaps = 0, filesChanged = 0;
const fileCounts = new Map();

for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const orig = src;
  let fileSwaps = 0;
  for (const [from, to] of RULES) {
    const parts = src.split(from);
    const count = parts.length - 1;
    if (count > 0) {
      src = parts.join(to);
      fileSwaps += count;
    }
  }
  if (src !== orig) {
    writeFileSync(f, src);
    filesChanged++;
    totalSwaps += fileSwaps;
    fileCounts.set(f, fileSwaps);
  }
}

const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [f, n] of sorted.slice(0, 40)) {
  console.log('  ' + n.toString().padStart(3) + '  ' + f.replace(/.*[\/\\]app[\/\\]/, ''));
}
if (sorted.length > 40) console.log('  ... and ' + (sorted.length - 40) + ' more files');
console.log('\nFiles changed: ' + filesChanged);
console.log('Total swaps: ' + totalSwaps);
