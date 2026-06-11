/**
 * Static guard for the T1.8 fixed-positioning fix (the fast, PR-time half).
 *
 * Background: several one-shot page/section enter animations are applied with
 * `animation-fill-mode: both`, so the element keeps its FINAL keyframe state
 * after the animation settles. If that final state is `transform: translateY(0)`
 * (or any non-`none` transform), or the wrapper class carries a persistent
 * `will-change: transform`, the settled wrapper creates a CSS *containing block*.
 * Every `position: fixed` descendant then resolves to that wrapper instead of
 * the viewport — landing footer-style with dead space instead of pinning to the
 * bottom of the screen. This is the root cause behind the New-Deal / Payroll /
 * Project-Detail bottom-bar and mis-positioned-modal bugs.
 *
 * The fix: end these enter keyframes at `transform: none` (identity interpolation
 * keeps the slide visually identical) and drop the persistent `will-change`.
 *
 * This test locks that in at unit-test speed (no browser). The runtime
 * symptom-level guard (walks every visible position:fixed element's ancestors)
 * lives in tests/e2e/visual.test.ts and runs nightly. If THIS test fails, a
 * wrapper keyframe regressed back to a non-`none` final transform — fix the
 * keyframe in app/globals.css (or the inline keyframes in MobileSettings.tsx).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const globalsCss = readFileSync(join(repoRoot, 'app', 'globals.css'), 'utf-8');
const mobileSettings = readFileSync(
  join(repoRoot, 'app', 'dashboard', 'mobile', 'MobileSettings.tsx'),
  'utf-8',
);

/**
 * Returns the body of `@keyframes <name> { ... }` via brace-counting (keyframe
 * blocks nest `{ }` per step, so a non-greedy regex isn't enough).
 */
function keyframeBlock(css: string, name: string): string {
  const marker = `@keyframes ${name}`;
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`@keyframes ${name} not found`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated @keyframes ${name}`);
}

/** The `transform:` value declared in the keyframe's FINAL step (`to` or `100%`). */
function finalTransform(block: string): string | null {
  // Split into step blocks: `to { ... }`, `100% { ... }`, `from { ... }`, etc.
  const steps = [...block.matchAll(/([a-z0-9%, ]+)\{([^}]*)\}/gi)];
  const finalStep = steps.find((m) => /(^|[\s,])(to|100%)([\s,]|$)/i.test(m[1].trim()));
  if (!finalStep) return null;
  const tx = finalStep[2].match(/transform\s*:\s*([^;]+);/i);
  return tx ? tx[1].trim() : null;
}

// Enter-animation wrappers that wrap content containing position:fixed
// descendants (page/section-level). Each MUST settle at `transform: none`.
const GLOBALS_ENTER_KEYFRAMES = [
  'pageEnter',
  'mobileTabEnter',
  'viewEnter',
  'deal-step-enter-fwd',
  'deal-step-enter-back',
  'settings-section-enter',
  'settings-section-fwd',
  'settings-section-back',
  'mobileSlideIn',
];

describe('T1.8 fixed-positioning CSS guard (globals.css)', () => {
  for (const name of GLOBALS_ENTER_KEYFRAMES) {
    it(`@keyframes ${name} settles at transform: none (no persistent containing block)`, () => {
      const final = finalTransform(keyframeBlock(globalsCss, name));
      expect(final, `@keyframes ${name} has no final transform declaration`).not.toBeNull();
      // `translateX(0)` / `translateY(0)` / `scale(1)` are still a transform
      // value → still a containing block. Only `none` clears it.
      expect(final).toBe('none');
    });
  }

  // The persistent `will-change: transform` on these one-shot enter wrappers is
  // itself a containing-block creator — it must be gone. We assert the class
  // blocks no longer declare it.
  const WILL_CHANGE_FREE_CLASSES = [
    '.deal-step-enter-fwd',
    '.deal-step-enter-back',
    '.animate-settings-section-fwd',
    '.animate-settings-section-back',
    '.animate-mobile-slide-in',
  ];
  for (const cls of WILL_CHANGE_FREE_CLASSES) {
    it(`${cls} declares no persistent will-change: transform`, () => {
      // Grab the single-rule block for this exact class (the `.foo { ... }`
      // line/blocks; these are all written on one line or a short block).
      const re = new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`, 'g');
      const matches = [...globalsCss.matchAll(re)];
      expect(matches.length, `${cls} rule not found`).toBeGreaterThan(0);
      for (const m of matches) {
        expect(/will-change\s*:\s*[^;]*transform/i.test(m[1])).toBe(false);
      }
    });
  }
});

describe('T1.8 fixed-positioning CSS guard (MobileSettings.tsx inline keyframes)', () => {
  // ms-slide-in / ms-slide-back wrap the settings section content, which holds
  // the fixed settings sheet + bulk action bar.
  for (const name of ['ms-slide-in', 'ms-slide-back']) {
    it(`@keyframes ${name} settles at transform: none`, () => {
      const final = finalTransform(keyframeBlock(mobileSettings, name));
      expect(final).toBe('none');
    });
  }
});
