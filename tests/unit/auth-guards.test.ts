/**
 * Auth-guard policy tests.
 *
 * Locks the behavior of `isVendorPM` and `isInternalPM` — the two
 * predicates that route handlers branch on to decide whether a
 * project_manager user gets full access, scoped access, or default-
 * deny. If these drift, the routes that depend on them silently
 * widen visibility (the Joe-Dale-class regression).
 *
 * Routes that call into these helpers as their privacy gate:
 *   - /api/data           (vendor PM scoping + misconfigured PM deny)
 *   - /api/reps           (vendor PM + misconfigured PM → empty list)
 *   - /api/reps/[id]      (vendor PM + misconfigured PM → 403)
 *   - /api/projects/[id]  (vendor PM scoped to installer)
 *   - /api/blitzes/[id]/* (cost-visibility decisions)
 *   - lib/db-gated.ts     (every gated query)
 *
 * If any test here flips, every dependent route flips with it. That's
 * the point — the helpers are the load-bearing piece. Lock them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isVendorPM, isInternalPM, type InternalUser } from '@/lib/api-auth';

function fixture(overrides: Partial<InternalUser> = {}): InternalUser {
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

describe('isVendorPM', () => {
  it('returns true for project_manager WITH scopedInstallerId', () => {
    const user = fixture({ role: 'project_manager', scopedInstallerId: 'inst_bvi' });
    expect(isVendorPM(user)).toBe(true);
  });

  it('returns false for project_manager WITHOUT scopedInstallerId', () => {
    const user = fixture({ role: 'project_manager', scopedInstallerId: null });
    expect(isVendorPM(user)).toBe(false);
  });

  it('returns false for project_manager with empty-string scope (treats as null)', () => {
    // Form layer can submit empty string for "unset". The DB column is
    // nullable, but be defensive — empty string is truthy in JS and would
    // route through the scoped branch with an invalid id otherwise.
    const user = fixture({ role: 'project_manager', scopedInstallerId: '' });
    // isVendorPM uses `!!user.scopedInstallerId` which treats '' as falsy → not vendor.
    expect(isVendorPM(user)).toBe(false);
  });

  it('returns false for admin (even with scopedInstallerId set)', () => {
    const user = fixture({ role: 'admin', scopedInstallerId: 'inst_bvi' });
    expect(isVendorPM(user)).toBe(false);
  });

  it('returns false for rep (even with scopedInstallerId set)', () => {
    const user = fixture({ role: 'rep', scopedInstallerId: 'inst_bvi' });
    expect(isVendorPM(user)).toBe(false);
  });

  it('returns false for sub-dealer', () => {
    const user = fixture({ role: 'sub-dealer' });
    expect(isVendorPM(user)).toBe(false);
  });

  it('returns false for unknown role', () => {
    const user = fixture({ role: 'fictional' });
    expect(isVendorPM(user)).toBe(false);
  });

  it('returns false for empty role string', () => {
    const user = fixture({ role: '' });
    expect(isVendorPM(user)).toBe(false);
  });
});

describe('isInternalPM', () => {
  // INTERNAL_PM_EMAILS is read from process.env at module-load time, so
  // changing it inside a test won't take effect for the already-imported
  // module. The fixtures here exercise the LOGIC of the function given a
  // known allowlist value at the time of import. To exercise allowlist
  // matching, we set the env BEFORE the auth-guards module is loaded by
  // the test runner — Vitest fresh-imports per file.
  const ORIGINAL_ENV = process.env.INTERNAL_PM_EMAILS;

  beforeEach(() => {
    // Defensive: tests in this describe block don't need the allowlist
    // populated; we test the LOGIC, not the live allowlist behavior.
    // The "on allowlist" cases are exercised in the privacy-gate tests
    // which do their own env manipulation + module re-import.
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.INTERNAL_PM_EMAILS;
    else process.env.INTERNAL_PM_EMAILS = ORIGINAL_ENV;
  });

  it('returns false for non-PM roles regardless of email', () => {
    expect(isInternalPM(fixture({ role: 'admin', email: 'whatever@kilo.com' }))).toBe(false);
    expect(isInternalPM(fixture({ role: 'rep', email: 'whatever@kilo.com' }))).toBe(false);
    expect(isInternalPM(fixture({ role: 'sub-dealer', email: 'whatever@kilo.com' }))).toBe(false);
    expect(isInternalPM(fixture({ role: 'fictional', email: 'whatever@kilo.com' }))).toBe(false);
  });

  it('returns false for project_manager WITH scopedInstallerId (vendor PM, never internal)', () => {
    // Even if their email happens to be on the allowlist, a vendor PM
    // (scope set) is NEVER treated as internal. This is the critical
    // invariant that prevents a vendor PM from accidentally getting
    // org-wide access via an admin email collision.
    const user = fixture({
      role: 'project_manager',
      scopedInstallerId: 'inst_bvi',
      email: 'admin@kilo.com',
    });
    expect(isInternalPM(user)).toBe(false);
  });

  it('returns false for misconfigured PM (no scope, email NOT on allowlist)', () => {
    // INTERNAL_PM_EMAILS is empty in the default test env, so any
    // unscoped PM email returns false. This is the "Joe Dale" case —
    // unscoped vendor PM that fell through to the allowlist branch
    // and got full access pre-P0.
    const user = fixture({
      role: 'project_manager',
      scopedInstallerId: null,
      email: 'random@vendor.com',
    });
    expect(isInternalPM(user)).toBe(false);
  });

  it('returns false for project_manager with no email (defensive)', () => {
    const user = fixture({
      role: 'project_manager',
      scopedInstallerId: null,
      email: '',
    });
    expect(isInternalPM(user)).toBe(false);
  });

  // The "PM on allowlist" path is exercised in
  // tests/unit/privacy-gate-project.test.ts which sets
  // INTERNAL_PM_EMAILS before importing the module. Replicating that
  // here would require dynamic re-import; the existing test covers it.
});

describe('Combined: every PM shape resolves to exactly one privacy bucket', () => {
  // The routes branch on (isVendorPM, isInternalPM) as a 2-bit decision.
  // Every PM user MUST land in exactly one of: vendor, internal, or
  // misconfigured. No PM should ever land in two buckets (overlap =
  // ambiguous policy = leak risk) or zero buckets (gap = silent fall-
  // through to "everything else" branch in route handlers).

  function bucketOf(u: InternalUser): 'vendor' | 'internal' | 'misconfigured' | 'not-pm' {
    if (u.role !== 'project_manager') return 'not-pm';
    if (isVendorPM(u)) return 'vendor';
    if (isInternalPM(u)) return 'internal';
    return 'misconfigured';
  }

  it('vendor PM (scope set, any email)', () => {
    expect(bucketOf(fixture({ role: 'project_manager', scopedInstallerId: 'inst_bvi', email: 'a@b.c' }))).toBe('vendor');
    expect(bucketOf(fixture({ role: 'project_manager', scopedInstallerId: 'inst_bvi', email: '' }))).toBe('vendor');
  });

  it('misconfigured PM (no scope, not on allowlist) → never internal, never vendor', () => {
    const u = fixture({ role: 'project_manager', scopedInstallerId: null, email: 'noone@noone.com' });
    expect(bucketOf(u)).toBe('misconfigured');
    expect(isVendorPM(u)).toBe(false);
    expect(isInternalPM(u)).toBe(false);
  });

  it('admin / rep / sub-dealer never bucket as PM', () => {
    expect(bucketOf(fixture({ role: 'admin' }))).toBe('not-pm');
    expect(bucketOf(fixture({ role: 'rep' }))).toBe('not-pm');
    expect(bucketOf(fixture({ role: 'sub-dealer' }))).toBe('not-pm');
  });
});
