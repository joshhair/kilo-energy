/**
 * view-as.test.ts — locks the View-As security boundary.
 *
 * The single rule that matters: only an admin can impersonate, only to a
 * resolvable active user, and any unauthorized/invalid ?viewAs scopes the
 * caller to THEMSELVES (never errors, never widens). A rep must never be
 * able to view-as another rep.
 */

import { describe, it, expect, vi } from 'vitest';
import { canViewAs, resolveEffectiveUser } from '@/lib/view-as';
import type { InternalUser } from '@/lib/api-auth';

const u = (over: Partial<InternalUser> & { id: string; role: string }): InternalUser => ({
  firstName: 'F', lastName: 'L', email: `${over.id}@x.com`, repType: null,
  clerkUserId: null, scopedInstallerId: null, ...over,
});

const ADMIN = u({ id: 'admin1', role: 'admin' });
const REP = u({ id: 'rep1', role: 'rep' });
const REP2 = u({ id: 'rep2', role: 'rep' });

describe('canViewAs', () => {
  it('is true only for admins', () => {
    expect(canViewAs(ADMIN)).toBe(true);
    expect(canViewAs(REP)).toBe(false);
    expect(canViewAs(u({ id: 'pm1', role: 'project_manager' }))).toBe(false);
    expect(canViewAs(u({ id: 'sd1', role: 'sub-dealer' }))).toBe(false);
  });
});

describe('resolveEffectiveUser', () => {
  const fetchOk = (target: InternalUser) => vi.fn(async (id: string) => (id === target.id ? target : null));

  it('admin → valid target impersonates that user', async () => {
    const fetch = fetchOk(REP);
    const r = await resolveEffectiveUser(ADMIN, REP.id, fetch);
    expect(r.impersonating).toBe(true);
    expect(r.effectiveUser.id).toBe(REP.id);
    expect(fetch).toHaveBeenCalledWith(REP.id);
  });

  it('a REP passing ?viewAs={other} is IGNORED → scoped to self (never fetches)', async () => {
    const fetch = fetchOk(REP2);
    const r = await resolveEffectiveUser(REP, REP2.id, fetch);
    expect(r.impersonating).toBe(false);
    expect(r.effectiveUser.id).toBe(REP.id);
    expect(fetch).not.toHaveBeenCalled(); // unauthorized short-circuits before any lookup
  });

  it('no ?viewAs → self', async () => {
    const r = await resolveEffectiveUser(ADMIN, null, fetchOk(REP));
    expect(r.impersonating).toBe(false);
    expect(r.effectiveUser.id).toBe(ADMIN.id);
  });

  it('admin viewAs self → self (no impersonation)', async () => {
    const r = await resolveEffectiveUser(ADMIN, ADMIN.id, fetchOk(ADMIN));
    expect(r.impersonating).toBe(false);
    expect(r.effectiveUser.id).toBe(ADMIN.id);
  });

  it('admin → missing/inactive target falls back to self (fetcher returns null)', async () => {
    const fetch = vi.fn(async () => null);
    const r = await resolveEffectiveUser(ADMIN, 'ghost', fetch);
    expect(r.impersonating).toBe(false);
    expect(r.effectiveUser.id).toBe(ADMIN.id);
  });

  it('admin can impersonate any role (subset of their own full visibility)', async () => {
    const pm = u({ id: 'pm1', role: 'project_manager', scopedInstallerId: 'inst_x' });
    const r = await resolveEffectiveUser(ADMIN, pm.id, fetchOk(pm));
    expect(r.impersonating).toBe(true);
    expect(r.effectiveUser.scopedInstallerId).toBe('inst_x');
  });
});
