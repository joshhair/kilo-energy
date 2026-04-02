/**
 * Generate PWA icon PNGs using sharp (or canvas).
 * Run: node scripts/generate-icons.mjs
 *
 * Since we can't easily generate PNGs without a dependency, this script
 * creates SVGs and converts them. If sharp isn't available, it just
 * creates the SVGs as placeholders.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');

function createSvg(size) {
  const fontSize = Math.round(size * 0.55);
  const radius = Math.round(size * 0.18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2563eb"/>
      <stop offset="100%" style="stop-color:#10b981"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
        fill="white" font-family="system-ui,sans-serif" font-weight="900"
        font-size="${fontSize}" letter-spacing="-2">K</text>
</svg>`;
}

// Write SVG versions (these can be used as fallbacks)
for (const size of [192, 512]) {
  const svg = createSvg(size);
  writeFileSync(join(iconsDir, `icon-${size}.svg`), svg);
  console.log(`Created icon-${size}.svg`);
}

// Try to convert to PNG using sharp
try {
  const sharp = (await import('sharp')).default;
  for (const size of [192, 512]) {
    const svg = createSvg(size);
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(join(iconsDir, `icon-${size}.png`));
    console.log(`Created icon-${size}.png`);
  }
} catch {
  console.log('sharp not available — SVG files created. Install sharp to generate PNGs:');
  console.log('  npm install --save-dev sharp && node scripts/generate-icons.mjs');
}
