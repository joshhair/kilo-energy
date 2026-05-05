// Theme press-state flashes: active:bg-white/[0.06], active:bg-white/5
// These are invisible in light mode (white-on-white). Swap to a token-aware
// color-mix using --text-primary as the tint source.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (e === 'node_modules' || e === '.next' || e === 'dist' || e.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.(tsx|ts)$/.test(e) && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const RULES = [
  // Tailwind arbitrary value: underscores serve as spaces inside [...]
  ['active:bg-white/[0.03]', 'active:bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]'],
  ['active:bg-white/[0.06]', 'active:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]'],
  ['active:bg-white/5',      'active:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]'],
  ['active:bg-white/10',     'active:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]'],
  ['hover:bg-white/[0.03]',  'hover:bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]'],
  ['hover:bg-white/[0.06]',  'hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]'],
  ['hover:bg-white/5',       'hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]'],
  ['hover:bg-white/10',      'hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]'],
  ['bg-white/[0.03]',        'bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]'],
  ['bg-white/[0.06]',        'bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]'],
  ['bg-white/5',             'bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]'],
  ['bg-white/10',            'bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]'],
];

const root = 'C:/Users/Jarvis/Projects/kilo-energy/app';
const files = walk(root);

let totalSwaps = 0, filesChanged = 0;
const fileCounts = new Map();

for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const orig = src;
  let n = 0;
  for (const [from, to] of RULES) {
    const parts = src.split(from);
    const c = parts.length - 1;
    if (c > 0) { src = parts.join(to); n += c; }
  }
  if (src !== orig) {
    writeFileSync(f, src);
    filesChanged++;
    totalSwaps += n;
    fileCounts.set(f, n);
  }
}

const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [f, c] of sorted) {
  console.log('  ' + c.toString().padStart(3) + '  ' + f.replace(/.*[\/\\]app[\/\\]/, ''));
}
console.log('\nFiles changed: ' + filesChanged);
console.log('Total swaps: ' + totalSwaps);
