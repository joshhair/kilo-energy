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
