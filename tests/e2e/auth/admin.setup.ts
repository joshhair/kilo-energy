// Playwright setup — signs in via Clerk backend ticket (no UI form).
// Bypasses MFA entirely because ticket-based sign-in is admin-authored
// and doesn't require second-factor verification. This is the pattern
// Clerk recommends for E2E when the instance has MFA enforced for real
// user flows.
//
// Why not the UI sign-in flow with setupClerkTestingToken? In theory it
// should bypass MFA, but the instance's factor-two redirect takes
// precedence over the testing token. Backend tickets skip that entirely.

import { test as setup, expect } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';

const AUTH_FILE = 'tests/e2e/.auth/admin.json';
const EMAIL = 'e2e-admin@kiloenergies.com';

setup('authenticate as admin', async ({ page, baseURL }) => {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const users = await clerk.users.getUserList({ emailAddress: [EMAIL] });
  if (users.totalCount === 0) {
    throw new Error(`Seed user missing: ${EMAIL}. Run npm run test:e2e:setup`);
  }
  const userId = users.data[0].id;

  const ticket = await clerk.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 120,
  });

  // Clerk processes the ticket at /sign-in (the SignIn component reads
  // the __clerk_ticket query param, exchanges it for a session, then
  // forwards to NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL = /dashboard).
  await page.goto(`${baseURL}/sign-in?__clerk_ticket=${ticket.token}`);
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/dashboard(\/|$)/);

  await page.context().storageState({ path: AUTH_FILE });
});
