import { test as setup, expect } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';

const AUTH_FILE = 'tests/e2e/.auth/rep.json';
const EMAIL = 'e2e-rep@kiloenergies.com';

setup('authenticate as rep', async ({ page, baseURL }) => {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const users = await clerk.users.getUserList({ emailAddress: [EMAIL] });
  if (users.totalCount === 0) {
    throw new Error(`Seed user missing: ${EMAIL}. Run npm run test:e2e:setup`);
  }
  const ticket = await clerk.signInTokens.createSignInToken({
    userId: users.data[0].id,
    expiresInSeconds: 120,
  });

  await page.goto(`${baseURL}/sign-in?__clerk_ticket=${ticket.token}`);
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/dashboard(\/|$)/);

  await page.context().storageState({ path: AUTH_FILE });
});
