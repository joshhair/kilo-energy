// Helpers shared across E2E tests. Pure helpers — no DB access. Tests hit
// the app's APIs the way real users would; that's both simpler (no Prisma
// import wrestling with Playwright's loader) and a more honest integration
// test (it exercises the serialization seam, RBAC, and Zod at the same time).

import type { APIRequestContext } from '@playwright/test';

/** A customer-name prefix used for every fixture project. Makes cleanup
 *  by wildcard match safe — we never touch real data. */
export const E2E_PREFIX = 'E2E-';

/** Unique customer name for a single test. */
export function e2eCustomerName(label: string): string {
  return `${E2E_PREFIX}${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

export interface ApiUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

/** Fetch the canonical E2E users by hitting /api/data as admin and looking
 *  them up by the seed emails. Runs once per describe; cached across tests. */
export async function getE2eUsers(adminRequest: APIRequestContext): Promise<{
  admin: ApiUser;
  rep: ApiUser;
  subDealer: ApiUser;
  pm: ApiUser;
}> {
  const res = await adminRequest.get('/api/data');
  if (!res.ok()) {
    throw new Error(`GET /api/data failed: ${res.status()} ${await res.text()}`);
  }
  const payload = await res.json();

  // /api/data returns reps + subDealers arrays; admin-role users aren't
  // in those buckets, so we also need to fetch /api/users/me or similar.
  // For simplicity, assume the admin request itself can identify the admin
  // via /api/auth/me.
  const meRes = await adminRequest.get('/api/auth/me');
  const admin: ApiUser = await meRes.json();

  const find = (list: ApiUser[], email: string) => {
    const u = list.find((x) => x.email === email);
    if (!u) throw new Error(`E2E user not found: ${email} — did you run npm run test:e2e:setup?`);
    return u;
  };

  return {
    admin,
    rep: find(payload.reps, 'e2e-rep@kiloenergies.com'),
    subDealer: find(payload.subDealers, 'e2e-subdealer@kiloenergies.com'),
    pm: { id: '', firstName: 'E2E', lastName: 'PM', email: 'e2e-pm@kiloenergies.com', role: 'project_manager' },
    // PM role isn't in reps/subDealers buckets; the golden-path tests don't
    // need the PM id directly, so we leave it blank. Add /api/users lookup
    // if a future test needs it.
  };
}

/** Pick the first active installer + non-Cash financer from /api/data. */
export async function pickReferenceData(adminRequest: APIRequestContext): Promise<{
  installerId: string;
  financerId: string;
}> {
  const res = await adminRequest.get('/api/data');
  const payload = await res.json();
  const installerName = payload.installers.find((i: { name: string; active: boolean }) => i.active)?.name;
  const financerName = payload.financers.find(
    (f: { name: string; active: boolean }) => f.active && f.name !== 'Cash',
  )?.name;
  if (!installerName || !financerName) {
    throw new Error('No active installer / financer in seed data');
  }
  const installerId = payload._idMaps.installerNameToId[installerName];
  const financerId = payload._idMaps.financerNameToId[financerName];
  return { installerId, financerId };
}

/** Delete every E2E-prefixed project via the admin DELETE endpoint. Takes
 *  an admin-authed request context. Run in afterAll of test files that
 *  create deals. */
export async function purgeE2eProjects(adminRequest: APIRequestContext): Promise<number> {
  const res = await adminRequest.get('/api/data');
  const payload = await res.json();
  const toDelete = payload.projects
    .filter((p: { customerName: string; id: string }) => p.customerName.startsWith(E2E_PREFIX))
    .map((p: { id: string }) => p.id);

  for (const id of toDelete) {
    await adminRequest.delete(`/api/projects/${id}`);
  }
  return toDelete.length;
}
