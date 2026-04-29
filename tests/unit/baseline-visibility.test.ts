/**
 * Privacy contract for baseline pricing visibility.
 *
 * If any of these tests fail, a privacy regression has shipped — pricing
 * fields are leaking to roles that should not see them. The test suite
 * IS the contract; treat changes here with the same rigor as schema
 * migrations.
 *
 * Coverage strategy:
 * - Example-based tests for each known role × each visibility helper.
 * - Property-based fuzz across role combinations to catch any case where
 *   a role accidentally gets unexpected access.
 *
 * STRIDE category: I (Information Disclosure).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  canViewKiloOnBaselineTier,
  canViewKiloOnProjectOverride,
  canViewSubDealerRateOnTier,
} from '@/lib/baseline-visibility';

const ALL_ROLES = ['admin', 'rep', 'sub-dealer', 'project_manager', 'trainer'] as const;

describe('canViewKiloOnBaselineTier', () => {
  it('grants admins full access', () => {
    expect(canViewKiloOnBaselineTier({ role: 'admin' })).toBe(true);
  });
  it('grants sub-dealers access to baseline-tier kilo cost', () => {
    expect(canViewKiloOnBaselineTier({ role: 'sub-dealer' })).toBe(true);
  });
  it('denies reps', () => {
    expect(canViewKiloOnBaselineTier({ role: 'rep' })).toBe(false);
  });
  it('denies trainers', () => {
    expect(canViewKiloOnBaselineTier({ role: 'trainer' })).toBe(false);
  });
  it('denies project managers (internal)', () => {
    expect(canViewKiloOnBaselineTier({ role: 'project_manager', isVendorPM: false })).toBe(false);
  });
  it('denies vendor project managers', () => {
    expect(canViewKiloOnBaselineTier({ role: 'project_manager', isVendorPM: true })).toBe(false);
  });
  it('denies any role outside the explicit allowlist (property-based)', () => {
    fc.assert(
      fc.property(fc.string(), (randomRole) => {
        // Any string that isn't 'admin' or 'sub-dealer' must return false.
        // This catches a future role addition that accidentally gets
        // access by default.
        if (randomRole === 'admin' || randomRole === 'sub-dealer') return true;
        return canViewKiloOnBaselineTier({ role: randomRole }) === false;
      }),
    );
  });
});

describe('canViewKiloOnProjectOverride', () => {
  it('grants admins access to per-project baselineOverride.kiloPerW', () => {
    expect(canViewKiloOnProjectOverride({ role: 'admin' })).toBe(true);
  });
  it('denies sub-dealers (tighter than baseline-tier visibility)', () => {
    expect(canViewKiloOnProjectOverride({ role: 'sub-dealer' })).toBe(false);
  });
  it('denies all other roles via fuzz', () => {
    fc.assert(
      fc.property(fc.string(), (randomRole) => {
        if (randomRole === 'admin') return true;
        return canViewKiloOnProjectOverride({ role: randomRole }) === false;
      }),
    );
  });
});

describe('canViewSubDealerRateOnTier', () => {
  it('grants admins', () => {
    expect(canViewSubDealerRateOnTier({ role: 'admin' })).toBe(true);
  });
  it('denies sub-dealers themselves (their contract is administered separately)', () => {
    expect(canViewSubDealerRateOnTier({ role: 'sub-dealer' })).toBe(false);
  });
  it('denies all non-admin roles via fuzz', () => {
    fc.assert(
      fc.property(fc.string(), (randomRole) => {
        if (randomRole === 'admin') return true;
        return canViewSubDealerRateOnTier({ role: randomRole }) === false;
      }),
    );
  });
});

describe('cross-helper invariants', () => {
  it.each(ALL_ROLES)('role %s: tier-3 (admin-only) is at most as permissive as tier-2', (role) => {
    const v = { role };
    // If a role can see admin-only fields, it must also be able to see
    // sub-dealer-visible fields. Inverse: admin-only ⊆ sub-dealer-visible.
    if (canViewKiloOnProjectOverride(v)) {
      expect(canViewKiloOnBaselineTier(v)).toBe(true);
    }
    if (canViewSubDealerRateOnTier(v)) {
      expect(canViewKiloOnBaselineTier(v)).toBe(true);
    }
  });
});
