/**
 * Smoke test: scripts/check-file-size.mjs passes on the current codebase.
 * Pulls the mega-file ratchet into the fast unit-test loop so a future
 * "let me just add 400 lines to this already-huge file" doesn't slip past CI.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

describe('file-size gate', () => {
  it('passes on the current tree (no new mega files, no allowlisted file grew)', () => {
    const repoRoot = join(__dirname, '..', '..');
    const out = execSync(`node ${join('scripts', 'check-file-size.mjs')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(out).toContain('No new mega files');
  });
});
