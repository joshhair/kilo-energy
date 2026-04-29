/**
 * Smoke test for scripts/check-audit-coverage.mjs.
 *
 * Doesn't reimplement the parser — just shells out to the script in a
 * subprocess and asserts exit code 0 + the expected line in stdout.
 * This way the gate's logic stays in one file and the CI invariant
 * ("audit coverage passes on main") is enforceable from `vitest run`
 * without spawning a separate npm script run.
 *
 * If this test fails, run `npm run check:audit` locally — the script
 * prints the offending route(s) and the next step.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

describe('audit-coverage gate', () => {
  it('passes with current coverage state', () => {
    const repoRoot = join(__dirname, '..', '..');
    const out = execSync(`node ${join('scripts', 'check-audit-coverage.mjs')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    // Sanity: gate emitted its passing line. If "Violations: 0" but the
    // success line went missing, something has drifted in the script.
    expect(out).toContain('Audit coverage gate passes');
    expect(out).toMatch(/Violations:\s+0/);
  });
});
