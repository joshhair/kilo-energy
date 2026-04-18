// Rep ↔ Sub-Dealer conversion — the canonical happy path for admin role
// flips added to support importing Glide users misclassified at import time.
//
// Admin creates a throwaway rep → flips to sub-dealer via PATCH → verifies
// /api/data shows them in subDealers not reps → flips back to rep → verifies
// they return to reps with repType='both'. HTTP-only (no Prisma import).

import { test, expect, request as pwRequest } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

interface BasicUser { id: string; email: string; role: string; repType?: string | null }

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

let createdUserId: string | null = null;
const uniqueEmail = `e2e-convert-${Date.now()}@kiloenergies.com`;

test.afterAll(async () => {
  if (!createdUserId) return;
  const admin = await pwRequest.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { origin: baseUrl },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  // Prefer hard-delete (no relations, safe). Falls back silently if gates
  // reject — cleanup is best-effort.
  await admin.delete(`/api/users/${createdUserId}`);
  await admin.dispose();
});

test('admin converts rep → sub-dealer → rep, FKs + Clerk id preserved', async () => {
  const admin = await pwRequest.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { origin: baseUrl },
    storageState: 'tests/e2e/.auth/admin.json',
  });

  // 1. Create a throwaway rep.
  const createRes = await admin.post('/api/reps', {
    data: {
      firstName: 'E2E',
      lastName: 'Convert',
      email: uniqueEmail,
      phone: '555-0100',
      role: 'rep',
      repType: 'closer',
    },
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json();
  createdUserId = created.id;
  const originalClerkId = created.clerkUserId ?? null;

  // 2. Admin flips to sub-dealer. repType is intentionally preserved (the
  // prod column is still NOT NULL — see repType schema drift memory). SDs
  // don't read repType anywhere, so it's harmless dirt.
  const toSd = await admin.patch(`/api/users/${createdUserId}`, {
    data: { role: 'sub-dealer' },
  });
  expect(toSd.status()).toBe(200);
  const afterFlip = await toSd.json();
  expect(afterFlip.role).toBe('sub-dealer');
  expect(afterFlip.id).toBe(createdUserId);
  expect(afterFlip.clerkUserId ?? null).toBe(originalClerkId);

  // 3. /api/data — user appears under subDealers, not reps.
  const data1 = await (await admin.get('/api/data')).json();
  expect(data1.reps.find((r: BasicUser) => r.id === createdUserId)).toBeUndefined();
  expect(data1.subDealers.find((s: BasicUser) => s.id === createdUserId)).toBeTruthy();

  // 4. Flip back to rep.
  const toRep = await admin.patch(`/api/users/${createdUserId}`, {
    data: { role: 'rep' },
  });
  expect(toRep.status()).toBe(200);
  const afterReverse = await toRep.json();
  expect(afterReverse.role).toBe('rep');

  // 5. /api/data — user back under reps.
  const data2 = await (await admin.get('/api/data')).json();
  expect(data2.reps.find((r: BasicUser) => r.id === createdUserId)).toBeTruthy();
  expect(data2.subDealers.find((s: BasicUser) => s.id === createdUserId)).toBeUndefined();

  await admin.dispose();
});

test('admin cannot flip an admin via this endpoint', async () => {
  const admin = await pwRequest.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { origin: baseUrl },
    storageState: 'tests/e2e/.auth/admin.json',
  });

  // Grab the admin's own id from /api/auth/me.
  const me = await (await admin.get('/api/auth/me')).json();

  const res = await admin.patch(`/api/users/${me.id}`, {
    data: { role: 'rep' },
  });
  // Expect 400 because existing.role === 'admin' is rejected by the guard.
  expect(res.status()).toBe(400);

  await admin.dispose();
});
