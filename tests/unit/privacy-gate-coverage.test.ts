/**
 * Two assertions:
 *   1. The privacy-gate coverage gate (scripts/check-privacy-gate-coverage.mjs)
 *      passes on the current codebase. New schema models without a gate or
 *      explicit allowlist entry break this test.
 *   2. The newly-added projectNote gate composes correctly under a rep
 *      identity — i.e. it returns the project-relational shape, mirroring
 *      the projectMessage / projectActivity gates.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { withRequestContext, type RequestContext } from '@/lib/request-context';
import { projectNoteVisibilityWhere } from '@/lib/db-gated';
import type { InternalUser } from '@/lib/api-auth';

function fixtureUser(overrides: Partial<InternalUser>): InternalUser {
  return {
    id: 'u_test',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@kilo-energy.test',
    role: 'rep',
    repType: 'closer',
    clerkUserId: null,
    scopedInstallerId: null,
    ...overrides,
  };
}
function ctx(user: InternalUser): RequestContext {
  return { user, chainTraineeIds: [] };
}

describe('privacy-gate coverage gate', () => {
  it('passes with current schema + db-gated state', () => {
    const repoRoot = join(__dirname, '..', '..');
    const out = execSync(`node ${join('scripts', 'check-privacy-gate-coverage.mjs')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(out).toContain('Privacy-gate coverage gate passes');
    expect(out).toMatch(/Violations:\s+0/);
  });
});

describe('projectNoteVisibilityWhere', () => {
  it('rep gets a project-relational filter that delegates to Project gate', () => {
    const where = withRequestContext(
      ctx(fixtureUser({ id: 'r1', role: 'rep' })),
      () => projectNoteVisibilityWhere(),
    );
    expect(where).toHaveProperty('project');
    // Project gate for a rep is the OR-of-relationship-clauses shape
    expect(where.project).toHaveProperty('OR');
  });
  it('admin gets {project: {}} — no narrowing', () => {
    const where = withRequestContext(
      ctx(fixtureUser({ role: 'admin' })),
      () => projectNoteVisibilityWhere(),
    );
    expect(where).toEqual({ project: {} });
  });
});
