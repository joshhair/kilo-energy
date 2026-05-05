/**
 * Smoke test: scripts/check-primitive-usage.mjs passes on the current
 * codebase. Pulls the section migrations and the per-section
 * allowlist into the unit-test fast feedback loop, so a future
 * "let me just stick a raw <button> in here" doesn't slip past CI.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

describe('primitive-usage gate', () => {
  it('passes on the current Settings sections', () => {
    const repoRoot = join(__dirname, '..', '..');
    const out = execSync(`node ${join('scripts', 'check-primitive-usage.mjs')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(out).toContain('All sections match their allowlist thresholds');
  });
});
