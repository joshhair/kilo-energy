import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRequestContext, type RequestContext } from '@/lib/request-context';
import { projectFileVisibilityWhere } from '@/lib/db-gated';
import type { InternalUser } from '@/lib/api-auth';

/**
 * Policy unit tests for the ProjectFile privacy gate.
 *
 * Audience: admin + internal PM + vendor PM whose scopedInstallerId
 * matches project.installerId. All other roles (rep / setter /
 * sub-dealer / misconfigured PM / unknown) DENY — installer files
 * (utility bills, permits, etc.) are operational comms between Kilo
 * and the installer, not data the rep is party to.
 *
 * The visibility WHERE returns `{ project: <projectWhere> }` — we
 * assert on that relational shape, not on Prisma's compiled SQL.
 */

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

describe('projectFileVisibilityWhere', () => {
  beforeEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });
  afterEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });

  it('admin → project gate is empty (full passthrough)', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => projectFileVisibilityWhere());
    expect(where).toEqual({ project: {} });
  });

  // Note: internal PM allowlist branch can't be unit-tested here because
  // INTERNAL_PM_EMAILS is read at module-load time (lib/api-auth.ts:43),
  // before vitest's beforeEach can mutate process.env. The branch is
  // structurally identical to admin (both return {}); E2E tests cover
  // the allowlisted case end-to-end.

  it('vendor PM with matching installer scope → project gate scopes by installerId', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: 'inst_bvi' });
    const where = withRequestContext(ctx(user), () => projectFileVisibilityWhere());
    expect(where).toEqual({ project: { installerId: 'inst_bvi' } });
  });

  it('misconfigured PM (no scope, no allowlist) → project gate denies', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: null });
    const where = withRequestContext(ctx(user), () => projectFileVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('rep → deny (reps must not see installer files even on their own deals)', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'r1', role: 'rep' })), () => projectFileVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('sub-dealer → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'sd1', role: 'sub-dealer' })), () => projectFileVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('unknown role → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'fictitious_role' })), () => projectFileVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('no request context → throws (load-bearing assertion)', () => {
    expect(() => projectFileVisibilityWhere()).toThrow();
  });
});
