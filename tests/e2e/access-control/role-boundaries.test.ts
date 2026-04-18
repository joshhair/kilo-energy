// Role boundaries — proves the server-side RBAC gates hold.
//
// Negative-path tests: we authenticate as a rep and try admin-only
// operations. Expected: 403 or redirect. If a regression drops any of
// these guards, this suite catches it before a real user does.

import { test, expect, request as pwRequest } from '@playwright/test';

test('rep cannot view admin-only "Invite user" button on /dashboard/users', async ({ page }) => {
  await page.goto('/dashboard/users');
  await page.waitForLoadState('domcontentloaded');
  // The admin-gated control must not render for non-admin roles.
  const inviteBtn = page.getByRole('button', { name: /invite user/i });
  await expect(inviteBtn).toHaveCount(0);
});

test('rep cannot PATCH a project they are not on', async ({ request }) => {
  // Find a project NOT owned by the rep via admin lookup.
  const adminCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  const dataRes = await adminCtx.get('/api/data');
  const payload = await dataRes.json();
  await adminCtx.dispose();

  // Admin gets all projects; find one whose closer/setter aren't the rep.
  // The rep's id comes from reps[] where email matches the seed.
  const repRow = payload.reps.find(
    (r: { email: string }) => r.email === 'e2e-rep@kiloenergies.com',
  );
  if (!repRow) {
    test.skip(true, 'E2E rep user not found — run npm run test:e2e:setup');
    return;
  }
  const foreign = payload.projects.find(
    (p: { id: string; repId: string; setterId?: string; subDealerId?: string }) =>
      p.repId !== repRow.id && p.setterId !== repRow.id && p.subDealerId !== repRow.id,
  );
  if (!foreign) {
    test.skip(true, 'No foreign project in DB to test against');
    return;
  }

  const res = await request.patch(`/api/projects/${foreign.id}`, {
    data: { notes: 'rep should not be able to write this' },
  });
  expect(res.status()).toBe(403);
});

test('rep cannot POST to /api/payroll (admin/PM only)', async ({ request }) => {
  // Fetch rep's own id via /api/auth/me to make the payload plausible.
  const meRes = await request.get('/api/auth/me');
  const me = await meRes.json();

  const res = await request.post('/api/payroll', {
    data: {
      repId: me.id,
      projectId: null,
      amount: 1_000_000,
      type: 'Bonus',
      paymentStage: 'Bonus',
      status: 'Draft',
      date: '2026-04-16',
    },
  });

  // requireAdminOrPM → 403 on rep path.
  expect([401, 403]).toContain(res.status());
});

test('rep cannot bulk-PATCH payroll status (admin/PM only)', async ({ request }) => {
  const res = await request.patch('/api/payroll', {
    data: { ids: ['fake-id-1', 'fake-id-2'], status: 'Paid' },
  });
  expect([401, 403]).toContain(res.status());
});

test('rep cannot DELETE a project (admin only)', async ({ request }) => {
  const res = await request.delete('/api/projects/nonexistent-id');
  expect([401, 403]).toContain(res.status());
});

test('rep cannot POST an installer (admin only)', async ({ request }) => {
  const res = await request.post('/api/installers', {
    data: { name: 'Rogue Installer', installPayPct: 100 },
  });
  expect([401, 403]).toContain(res.status());
});

test('rep cannot POST a financer (admin only)', async ({ request }) => {
  const res = await request.post('/api/financers', {
    data: { name: 'Rogue Financer' },
  });
  expect([401, 403]).toContain(res.status());
});

test('rep cannot POST a blitz (admin only)', async ({ request }) => {
  const res = await request.post('/api/blitz', {
    data: { name: 'Rogue Blitz', startDate: '2026-04-01', endDate: '2026-04-30' },
  });
  expect([401, 403]).toContain(res.status());
});

test('rep cannot create another user via /api/reps (admin only)', async ({ request }) => {
  const res = await request.post('/api/reps', {
    data: { name: 'Ghost Rep', email: 'ghost@example.com', role: 'rep' },
  });
  expect([401, 403]).toContain(res.status());
});

test('rep cannot PATCH another user\'s role (admin only)', async ({ request }) => {
  // Pick an arbitrary rep id from /api/data via the admin context — we don't
  // need to find a specific one since the guard rejects before any lookup.
  const adminCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  const dataRes = await adminCtx.get('/api/data');
  const payload = await dataRes.json();
  await adminCtx.dispose();

  const victim = payload.reps.find((r: { email: string }) => r.email !== 'e2e-rep@kiloenergies.com');
  if (!victim) {
    test.skip(true, 'No victim rep found');
    return;
  }

  const res = await request.patch(`/api/users/${victim.id}`, {
    data: { role: 'sub-dealer' },
  });
  expect([401, 403]).toContain(res.status());
});

// ─── Viewer-aware scrubbing (Batch 1) ─────────────────────────────────────

test('rep /api/data projects: trainer fields are never exposed', async ({ request }) => {
  const res = await request.get('/api/data');
  expect(res.status()).toBe(200);
  const payload = await res.json();
  for (const p of payload.projects) {
    // Reps must never see per-project trainer override fields.
    expect(p.trainerId).toBeUndefined();
    expect(p.trainerName).toBeUndefined();
    expect(p.trainerRate).toBeUndefined();
  }
});

test('rep /api/data projects: baselineOverride never contains kiloPerW', async ({ request }) => {
  const res = await request.get('/api/data');
  const payload = await res.json();
  for (const p of payload.projects) {
    if (p.baselineOverride && typeof p.baselineOverride === 'object') {
      expect(p.baselineOverride.kiloPerW).toBeUndefined();
    }
  }
});

test('rep cannot see co-party breakdowns on non-own-deal blitz projects', async ({ request }) => {
  // Find a blitz the rep participates in that also has deals they're NOT on.
  const adminCtx = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' },
    storageState: 'tests/e2e/.auth/admin.json',
  });
  const adminData = await (await adminCtx.get('/api/data')).json();
  const repRow = adminData.reps.find((r: { email: string }) => r.email === 'e2e-rep@kiloenergies.com');
  if (!repRow) {
    await adminCtx.dispose();
    test.skip(true, 'E2E rep not found — run npm run test:e2e:setup');
    return;
  }
  // Find a blitz containing a project the rep is a participant on + one they're not.
  const blitzes = await (await adminCtx.get('/api/blitz')).json();
  await adminCtx.dispose();

  const candidate = blitzes.find((b: { participants?: Array<{ userId: string; joinStatus: string }> }) =>
    b.participants?.some((p) => p.userId === repRow.id && p.joinStatus === 'approved'),
  );
  if (!candidate) {
    test.skip(true, 'No blitz with rep participant to test');
    return;
  }

  const res = await request.get(`/api/blitzes/${candidate.id}`);
  expect(res.status()).toBe(200);
  const blitz = await res.json();

  for (const p of blitz.projects ?? []) {
    const isOwn = p.repId === repRow.id || p.setterId === repRow.id;
    if (isOwn) continue;
    // Non-own deal: all primary amounts zeroed AND co-party amounts zeroed.
    expect(p.netPPW).toBe(0);
    expect(p.m1Amount).toBe(0);
    expect(p.m2Amount).toBe(0);
    for (const co of p.additionalClosers ?? []) {
      expect(co.m1Amount).toBe(0);
      expect(co.m2Amount).toBe(0);
    }
    for (const co of p.additionalSetters ?? []) {
      expect(co.m1Amount).toBe(0);
      expect(co.m2Amount).toBe(0);
    }
  }
});
