import { defineConfig, devices } from '@playwright/test';

// E2E projects are split by authentication state:
//   - `setup` runs once, signs in as each seeded role, writes a storage
//     state JSON per role under tests/e2e/.auth/
//   - `chromium-<role>` projects reuse that storage state so every test
//     starts already-signed-in as the right user
//   - `chromium-anon` runs the existing unauthenticated smoke suite
//   - `mobile` keeps the existing viewport-focused pass
//
// Seeded E2E users live in Clerk test-mode + Prisma; regen with
//   `npx tsx scripts/seed-e2e-users.ts` before the first run.

// PLAYWRIGHT_BASE_URL lets CI / local runs target a different port without
// editing this file. Default is 3000; set PLAYWRIGHT_BASE_URL=http://localhost:3001
// if you already have a dev server running there.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const BASE_PORT = Number(new URL(BASE_URL).port) || 3000;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  globalSetup: require.resolve('./tests/e2e/global-setup.ts'),
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    // middleware.ts asserts same-origin on every mutation. Browser
    // contexts set Origin automatically on page navigations, but
    // Playwright's bare `request` context does not — set it here so
    // every fetch from tests passes CSRF.
    extraHTTPHeaders: {
      origin: BASE_URL,
    },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\/.*\.setup\.ts/,
    },
    // No admin-specific tests yet — the admin flows are exercised from
    // within the rep's golden-path test via a browser.newContext() switch.
    // Re-add this project with testMatch when we need admin-tagged cases
    // (e.g. user invitation, bulk payroll publish from admin UI).
    {
      name: 'chromium-rep',
      dependencies: ['setup'],
      testMatch: [/golden\/.*\.test\.ts/, /access-control\/.*\.test\.ts/],
      use: {
        browserName: 'chromium',
        storageState: 'tests/e2e/.auth/rep.json',
      },
    },
    {
      name: 'chromium-anon',
      testMatch: [/smoke\.test\.ts/],
      use: { browserName: 'chromium' },
    },
    {
      name: 'mobile',
      testMatch: [/mobile\.test\.ts/],
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14 Pro'].userAgent,
      },
    },
    {
      name: 'tablet',
      testMatch: [/mobile\.test\.ts/],
      use: {
        browserName: 'chromium',
        viewport: { width: 1024, height: 1366 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: BASE_PORT,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
