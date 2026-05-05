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

// Skip marketing/auth pages — those are intentionally dark
const SKIPS = ['sign-in', 'sign-up', 'legal'];
const root = 'C:/Users/Jarvis/Projects/kilo-energy/app';
const files = walk(root).filter(f => !SKIPS.some(s => f.includes(s)));

let totalSwaps = 0, filesChanged = 0;
const fileCounts = new Map();

for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const orig = src;
  let n = 0;

  src = src.replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(0?\.\d+|1(?:\.0+)?)\s*\)/g, (_m, a) => {
    n++;
    const alpha = parseFloat(a);
    if (alpha <= 0.20) return `color-mix(in srgb, var(--text-primary) ${Math.round(alpha * 100)}%, transparent)`;
    if (alpha <= 0.30) return 'var(--text-dim)';
    if (alpha <= 0.50) return 'var(--text-muted)';
    if (alpha <= 0.70) return 'var(--text-secondary)';
    return 'var(--text-primary)';
  });

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
