import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRequestContext, type RequestContext } from '@/lib/request-context';
import { projectInstallerNoteVisibilityWhere } from '@/lib/db-gated';
import type { InternalUser } from '@/lib/api-auth';

/**
 * Policy unit tests for the ProjectInstallerNote privacy gate.
 *
 * Same shape as ProjectFile / ProjectSurveyLink. Distinct from
 * ProjectAdminNote (which excludes vendor PMs entirely) — installer
 * notes are FOR the vendor PM by design; that's the whole audience.
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

describe('projectInstallerNoteVisibilityWhere', () => {
  beforeEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });
  afterEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });

  it('admin → project gate is empty', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => projectInstallerNoteVisibilityWhere());
    expect(where).toEqual({ project: {} });
  });

  // Internal PM allowlist branch is structurally identical to admin;
  // INTERNAL_PM_EMAILS env var is module-load-time so unit tests can't
  // exercise it. E2E covers it.

  it('vendor PM with matching scope → installerId scope (vendor PM IS the audience)', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: 'inst_bvi' });
    const where = withRequestContext(ctx(user), () => projectInstallerNoteVisibilityWhere());
    expect(where).toEqual({ project: { installerId: 'inst_bvi' } });
  });

  it('misconfigured PM → deny', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: null });
    const where = withRequestContext(ctx(user), () => projectInstallerNoteVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('rep → deny (notes are not rep-facing)', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'r1', role: 'rep' })), () => projectInstallerNoteVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('sub-dealer → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'sd1', role: 'sub-dealer' })), () => projectInstallerNoteVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('unknown role → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'weird' })), () => projectInstallerNoteVisibilityWhere());
    expect(where).toEqual({ project: { id: '__deny_non_installer_surface__' } });
  });

  it('no request context → throws', () => {
    expect(() => projectInstallerNoteVisibilityWhere()).toThrow();
  });
});
