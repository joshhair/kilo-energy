/**
 * view-as.ts — server-side "View-As" (admin impersonation) resolution.
 *
 * Shared by the read-only GET endpoints (/api/data, /api/my-pay) so the
 * native iOS app can re-fetch any screen with `?viewAs={userId}` and get
 * that person's server-scoped data verbatim — no scoping logic in the app
 * binary, and the two surfaces can't disagree.
 *
 * SECURITY BOUNDARY (this is the only authorization that matters):
 *   - Only an ADMIN may impersonate. A rep/sub-dealer/PM passing ?viewAs is
 *     silently IGNORED and scoped to themselves — never an error, never a
 *     widened scope. (A rep must never be able to view-as another rep.)
 *   - Admin impersonation is safe by construction: an admin already has
 *     full visibility, so re-scoping the response AS another user can only
 *     ever NARROW it. There is nothing an impersonated view exposes that the
 *     admin couldn't already see.
 *   - The target must resolve to an active user; otherwise scope to self.
 *
 * The caller substitutes the returned `effectiveUser` into the SAME
 * per-viewer scoping it already runs for a real user. Audit the
 * impersonation at the call site (real actor id + effectiveUserId).
 */

import type { InternalUser } from './api-auth';

/** Whether this (real) caller is allowed to impersonate at all. */
export function canViewAs(realUser: Pick<InternalUser, 'role'>): boolean {
  return realUser.role === 'admin';
}

export interface ViewAsResolution {
  /** The user whose scope the response should reflect. */
  effectiveUser: InternalUser;
  /** True only when a valid impersonation actually took effect. */
  impersonating: boolean;
}

/**
 * Resolve the effective user for a request.
 *
 * @param realUser   the authenticated caller (the real actor)
 * @param viewAsId   the requested `?viewAs` target id (or null/empty)
 * @param fetchUser  loads an InternalUser by id (returns null if missing/
 *                   inactive) — injected so this is unit-testable without a DB
 */
export async function resolveEffectiveUser(
  realUser: InternalUser,
  viewAsId: string | null | undefined,
  fetchUser: (id: string) => Promise<InternalUser | null>,
): Promise<ViewAsResolution> {
  // No target, self-target, or unauthorized caller → scope to self. Silent
  // by design: an unauthorized ?viewAs must behave exactly like no ?viewAs.
  if (!viewAsId || viewAsId === realUser.id || !canViewAs(realUser)) {
    return { effectiveUser: realUser, impersonating: false };
  }
  const target = await fetchUser(viewAsId);
  if (!target) {
    return { effectiveUser: realUser, impersonating: false };
  }
  return { effectiveUser: target, impersonating: true };
}
