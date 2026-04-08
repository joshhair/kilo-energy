/**
 * Generate PWA icon SVGs and (if sharp is available) PNGs.
 * Run: node scripts/generate-icons.mjs
 *
 * Output:
 *   public/icons/icon-192.svg, icon-512.svg  — primary, used by modern browsers
 *   public/icons/icon-192.png, icon-512.png  — fallback for older PWA installers
 *
 * If sharp isn't installed, only the SVGs are written. The SVGs alone are
 * sufficient for the manifest on modern browsers (Chrome/Safari/Edge all
 * accept image/svg+xml in the icons array). The PNG fallback is for older
 * Android home-screen installers.
 *
 * Design (refreshed 2026-04-08):
 *   - Diagonal navy → emerald gradient base (matches app/icon.tsx and
 *     app/apple-icon.tsx in the next/og runtime icons)
 *   - Top-left highlight halo for depth
 *   - Top-right "sun-disc" accent — solar without being literal
 *   - Bottom-left ambient cyan glow for asymmetry
 *   - Inner ring + drop shadow on the K wordmark
 *
 * Color spec:
 *   #050d18 → #0a2540 → #008f5a (base gradient stops)
 *   #00e5a0 (brand emerald, used in halos)
 *   #00b4d8 (cyan accent for the bottom-left glow)
 *   #00ffb4 (bright sun-disc center)
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');

function createSvg(size) {
  // Tunables that scale with the canvas size
  const radius = Math.round(size * 0.195);
  const fontSize = Math.round(size * 0.62);
  const ringInset = Math.max(2, Math.round(size * 0.007));
  const sunRadius = Math.round(size * 0.255);
  const sunCx = size - Math.round(size * 0.12);
  const sunCy = Math.round(size * 0.115);
  const ambRadius = Math.round(size * 0.275);
  const ambCx = Math.round(size * 0.115);
  const ambCy = size - Math.round(size * 0.12);
  const letterSpacing = Math.round(size * -0.02);
  const dropShadowBlur = Math.round(size * 0.035);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"  stop-color="#050d18"/>
      <stop offset="40%" stop-color="#0a2540"/>
      <stop offset="100%" stop-color="#008f5a"/>
    </linearGradient>
    <radialGradient id="hi" cx="25%" cy="20%" r="60%">
      <stop offset="0%"  stop-color="#00e5a0" stop-opacity="0.45"/>
      <stop offset="60%" stop-color="#00e5a0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sun" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="#00ffb4" stop-opacity="0.55"/>
      <stop offset="35%" stop-color="#00e5a0" stop-opacity="0.18"/>
      <stop offset="70%" stop-color="#00e5a0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="amb" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00b4d8" stop-opacity="0.45"/>
      <stop offset="65%" stop-color="#00b4d8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#hi)"/>
  <circle cx="${sunCx}" cy="${sunCy}" r="${sunRadius}" fill="url(#sun)"/>
  <circle cx="${ambCx}" cy="${ambCy}" r="${ambRadius}" fill="url(#amb)"/>
  <rect x="${ringInset / 2}" y="${ringInset / 2}" width="${size - ringInset}" height="${size - ringInset}" rx="${radius - ringInset / 2}" fill="none"
        stroke="#00e5a0" stroke-opacity="0.45" stroke-width="${ringInset}"/>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle"
        fill="white" font-family="system-ui,sans-serif" font-weight="900"
        font-size="${fontSize}" letter-spacing="${letterSpacing}"
        style="filter: drop-shadow(0 ${Math.round(size * 0.008)}px ${dropShadowBlur}px rgba(0,229,160,0.55));">K</text>
</svg>`;
}

// Write SVG versions (used as the primary icons)
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
  console.log('sharp not available — only SVG files created.');
  console.log('To regenerate the PNG fallbacks too:');
  console.log('  npm install --save-dev sharp && node scripts/generate-icons.mjs');
}
