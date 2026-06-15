// Runs once before any Playwright project. Sets up the Clerk testing
// harness so per-role setup files can call setupClerkTestingToken({ page })
// to skip bot-protection checks during automated sign-in.

import { clerkSetup } from '@clerk/testing/playwright';
import { assertNotProdDb } from '../setup/db-guard';

export default async function globalSetup() {
  // Safety gate (2026-06-12 incident): the e2e golden tests mutate data
  // through the local dev webServer, which inherits this shell's env. If
  // TURSO_DATABASE_URL was sourced from prod .env, abort before any test
  // runs. (The nightly visual job hits the deployed URL and sets no
  // TURSO_DATABASE_URL, so it is unaffected; a non-prod remote test DB is
  // still allowed — only production is blocked.)
  assertNotProdDb('playwright global-setup');
  await clerkSetup();
}
