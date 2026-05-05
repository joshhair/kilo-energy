import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRequestContext, type RequestContext } from '@/lib/request-context';
import { payrollEntryVisibilityWhere } from '@/lib/db-gated';
import type { InternalUser } from '@/lib/api-auth';

/**
 * Policy unit tests for the PayrollEntry visibility gate.
 *
 * Vendor PMs see NOTHING — payroll is per-rep commission and isn't
 * shared with installer-side staff. Reps and sub-dealers see only
 * their own. Admin and internal-PM allowlist see everything.
 *
 * Default-deny is the structural property: any unknown user shape
 * returns an impossible-id where = zero rows.
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

describe('payrollEntryVisibilityWhere', () => {
  const originalEnv = process.env.INTERNAL_PM_EMAILS;
  beforeEach(() => {
    process.env.INTERNAL_PM_EMAILS = '';
  });
  afterEach(() => {
    process.env.INTERNAL_PM_EMAILS = originalEnv;
  });

  it('admin → empty WHERE', () => {
    const user = fixtureUser({ role: 'admin' });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({});
  });

  it('vendor PM → impossible repId (deny)', () => {
    const user = fixtureUser({
      role: 'project_manager',
      scopedInstallerId: 'inst_bvi',
    });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_vendor_pm_no_payroll__' });
  });

  it('PM with no scope and not on allowlist → default-DENY', () => {
    const user = fixtureUser({
      role: 'project_manager',
      scopedInstallerId: null,
    });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_misconfigured_pm__' });
  });

  it('rep → repId == own id', () => {
    const user = fixtureUser({ id: 'bryce', role: 'rep' });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({ repId: 'bryce' });
  });

  it('sub-dealer → repId == own id', () => {
    const user = fixtureUser({ id: 'frank_sd', role: 'sub-dealer' });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({ repId: 'frank_sd' });
  });

  it('unknown role → default-DENY', () => {
    const user = fixtureUser({ role: 'something-new' });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_unknown_role__' });
  });

  it('null role → default-DENY', () => {
    const user = fixtureUser({ role: null as unknown as string });
    const where = withRequestContext(ctx(user), () => payrollEntryVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_unknown_role__' });
  });

  it('throws when called outside a request context', () => {
    expect(() => payrollEntryVisibilityWhere()).toThrow(/No request context bound/);
  });
});
