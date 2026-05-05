import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRequestContext, type RequestContext } from '@/lib/request-context';
import { emailDeliveryVisibilityWhere } from '@/lib/db-gated';
import type { InternalUser } from '@/lib/api-auth';

/**
 * Policy unit tests for the EmailDelivery privacy gate.
 *
 * Delivery-status records (sent/delivered/bounced) for installer
 * handoff emails. Same audience as the other installer surfaces —
 * vendor PM of the matching installer can see their own delivery
 * records (so BVI's PM knows which projects' handoff actually
 * arrived). Reps DENY.
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

describe('emailDeliveryVisibilityWhere', () => {
  beforeEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });
  afterEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });

  it('admin → project gate is empty', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => emailDeliveryVisibilityWhere());
    expect(where).toEqual({ project: {} });
  });

  // Internal PM allowlist branch is structurally identical to admin;
  // INTERNAL_PM_EMAILS env var is module-load-time so unit tests can't
  // exercise it. E2E covers it.

  it('vendor PM with matching scope → installerId scope', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: 'inst_bvi' });
    const where = withRequestContext(ctx(user), () => emailDeliveryVisibilityWhere());
    expect(where).toEqual({ project: { installerId: 'inst_bvi' } });
  });

  it('misconfigured PM → deny', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: null });
    const where = withRequestContext(ctx(user), () => emailDeliveryVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('rep → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'r1', role: 'rep' })), () => emailDeliveryVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('sub-dealer → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'sd1', role: 'sub-dealer' })), () => emailDeliveryVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('unknown role → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'weird' })), () => emailDeliveryVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('no request context → throws', () => {
    expect(() => emailDeliveryVisibilityWhere()).toThrow();
  });
});
