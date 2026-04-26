// Convert hardcoded accent rgba() literals to color-mix on the accent-solid token.
// This preserves alpha semantics while letting the underlying color follow the
// theme (currently the solids are theme-invariant, but this keeps the door open).
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

// Color signatures → accent token name
// Numbers below match the rgb() of each canonical accent and known variants
const COLOR_TO_TOKEN = [
  // Red family
  [[255, 82, 82],   'red'],
  [[255, 107, 107], 'red'],
  [[255, 100, 100], 'red'],
  [[239, 68, 68],   'red'],
  // Amber family
  [[255, 176, 32],  'amber'],
  [[245, 166, 35],  'amber'],
  [[245, 158, 11],  'amber'],
  [[249, 115, 22],  'amber'],
  [[234, 179, 8],   'amber'],
  // Emerald family
  [[0, 224, 122],   'emerald'],
  [[0, 229, 160],   'emerald'],
  [[16, 185, 129],  'emerald'],
  [[34, 197, 94],   'emerald'],
  // Cyan family
  [[0, 196, 240],   'cyan'],
  [[0, 180, 216],   'cyan'],
  [[14, 165, 233],  'cyan'],
  // Blue family
  [[77, 159, 255],  'blue'],
  [[59, 130, 246],  'blue'],
  [[37, 99, 235],   'blue'],
  [[99, 102, 241],  'blue'],
  // Purple family
  [[168, 85, 247],  'purple'],
  [[180, 125, 255], 'purple'],
  [[124, 58, 237],  'purple'],
  [[139, 92, 246],  'purple'],
  [[217, 70, 239],  'purple'],
  // Teal family
  [[0, 212, 200],   'teal'],
  [[20, 184, 166],  'teal'],
  // Muted gray (--text-muted family in dark)
  [[136, 145, 168], 'text-muted-mix'],
  [[136, 153, 170], 'text-muted-mix'],
];

const SKIPS = ['sign-in', 'sign-up', 'legal'];
const root = 'C:/Users/Jarvis/Projects/kilo-energy/app';
const files = walk(root).filter(f => !SKIPS.some(s => f.includes(s)));

let totalSwaps = 0, filesChanged = 0;
const fileCounts = new Map();

for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const orig = src;
  let n = 0;

  src = src.replace(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0?\.\d+|1(?:\.0+)?)\s*\)/g, (m, r, g, b, a) => {
    const rgb = [+r, +g, +b];
    // Don't touch black, white, or near-grays — those are handled by other sweeps
    if (rgb.every(x => x === 0)) return m;            // rgba(0,0,0,*) — modal overlays
    if (rgb.every(x => x >= 250)) return m;            // already-handled white
    const match = COLOR_TO_TOKEN.find(([rgb2]) => rgb2[0] === rgb[0] && rgb2[1] === rgb[1] && rgb2[2] === rgb[2]);
    if (!match) return m;
    const [, token] = match;
    const alpha = parseFloat(a);
    const pct = Math.round(alpha * 100);
    n++;
    if (token === 'text-muted-mix') {
      return `color-mix(in srgb, var(--text-muted) ${pct}%, transparent)`;
    }
    return `color-mix(in srgb, var(--accent-${token}-solid) ${pct}%, transparent)`;
  });

  if (src !== orig) {
    writeFileSync(f, src);
    filesChanged++;
    totalSwaps += n;
    fileCounts.set(f, n);
  }
}

const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [f, c] of sorted.slice(0, 50)) {
  console.log('  ' + c.toString().padStart(3) + '  ' + f.replace(/.*[\/\\]app[\/\\]/, ''));
}
if (sorted.length > 50) console.log('  ... and ' + (sorted.length - 50) + ' more');
console.log('\nFiles changed: ' + filesChanged);
console.log('Total swaps: ' + totalSwaps);
