import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withRequestContext, type RequestContext } from '@/lib/request-context';
import {
  reimbursementVisibilityWhere,
  projectMessageVisibilityWhere,
  projectActivityVisibilityWhere,
  projectMentionVisibilityWhere,
  blitzCostVisibilityWhere,
  projectAdminNoteVisibilityWhere,
} from '@/lib/db-gated';
import type { InternalUser } from '@/lib/api-auth';

/**
 * Policy unit tests for the privacy gates on the remaining sensitive
 * models: Reimbursement, ProjectMessage, ProjectActivity,
 * ProjectMention, BlitzCost, ProjectAdminNote.
 *
 * Project-scoped models (Message / Activity / Mention) delegate
 * visibility to the parent project's gate via Prisma relational
 * filters. We assert the WHERE shape includes the project relation,
 * not the exact compiled subquery (Prisma evaluates that at runtime).
 *
 * BlitzCost and ProjectAdminNote are admin-only (default-deny for
 * everyone else, including reps and vendor PMs).
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

describe('reimbursementVisibilityWhere', () => {
  beforeEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });
  afterEach(() => { process.env.INTERNAL_PM_EMAILS = ''; });

  it('admin → empty WHERE', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => reimbursementVisibilityWhere());
    expect(where).toEqual({});
  });
  it('vendor PM → deny', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: 'inst_x' });
    const where = withRequestContext(ctx(user), () => reimbursementVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_vendor_pm_no_reimb__' });
  });
  it('misconfigured PM → deny', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: null });
    const where = withRequestContext(ctx(user), () => reimbursementVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_misconfigured_pm__' });
  });
  it('rep → repId match', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'r1', role: 'rep' })), () => reimbursementVisibilityWhere());
    expect(where).toEqual({ repId: 'r1' });
  });
  it('unknown role → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'weird' })), () => reimbursementVisibilityWhere());
    expect(where).toEqual({ repId: '__deny_unknown_role__' });
  });
});

describe('projectMessageVisibilityWhere', () => {
  it('all roles get a project-relational filter', () => {
    const user = fixtureUser({ id: 'r1', role: 'rep' });
    const where = withRequestContext(ctx(user), () => projectMessageVisibilityWhere());
    expect(where).toHaveProperty('project');
    // For a rep, the project gate returns an OR of relationship clauses
    expect(where.project).toHaveProperty('OR');
  });
  it('admin → project gate is empty (full passthrough)', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => projectMessageVisibilityWhere());
    expect(where).toEqual({ project: {} });
  });
});

describe('projectActivityVisibilityWhere', () => {
  it('admin → project gate is empty', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => projectActivityVisibilityWhere());
    expect(where).toEqual({ project: {} });
  });
  it('rep → project gate scopes by relationship', () => {
    const where = withRequestContext(ctx(fixtureUser({ id: 'r1', role: 'rep' })), () => projectActivityVisibilityWhere());
    expect(where.project).toHaveProperty('OR');
  });
});

describe('projectMentionVisibilityWhere', () => {
  it('admin → empty (full passthrough)', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => projectMentionVisibilityWhere());
    expect(where).toEqual({});
  });
  it('rep → mentions for me, on a project I can see', () => {
    const user = fixtureUser({ id: 'r1', role: 'rep' });
    const where = withRequestContext(ctx(user), () => projectMentionVisibilityWhere());
    expect(where.userId).toBe('r1');
    expect(where).toHaveProperty('message.project');
  });
});

describe('blitzCostVisibilityWhere', () => {
  it('admin → empty', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => blitzCostVisibilityWhere());
    expect(where).toEqual({});
  });
  it('rep → deny (no operating cost visibility)', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'rep' })), () => blitzCostVisibilityWhere());
    expect(where).toEqual({ id: '__deny_non_admin_no_blitz_costs__' });
  });
  it('vendor PM → deny', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: 'inst_x' });
    const where = withRequestContext(ctx(user), () => blitzCostVisibilityWhere());
    expect(where).toEqual({ id: '__deny_non_admin_no_blitz_costs__' });
  });
  it('misconfigured PM → deny', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: null });
    const where = withRequestContext(ctx(user), () => blitzCostVisibilityWhere());
    expect(where).toEqual({ id: '__deny_non_admin_no_blitz_costs__' });
  });
});

describe('projectAdminNoteVisibilityWhere', () => {
  it('admin → empty', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'admin' })), () => projectAdminNoteVisibilityWhere());
    expect(where).toEqual({});
  });
  it('rep → deny', () => {
    const where = withRequestContext(ctx(fixtureUser({ role: 'rep' })), () => projectAdminNoteVisibilityWhere());
    expect(where).toEqual({ id: '__deny_non_admin_no_admin_notes__' });
  });
  it('vendor PM → deny (even for projects they can see)', () => {
    const user = fixtureUser({ role: 'project_manager', scopedInstallerId: 'inst_x' });
    const where = withRequestContext(ctx(user), () => projectAdminNoteVisibilityWhere());
    expect(where).toEqual({ id: '__deny_non_admin_no_admin_notes__' });
  });
});
