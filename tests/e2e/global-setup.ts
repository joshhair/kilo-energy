// Runs once before any Playwright project. Sets up the Clerk testing
// harness so per-role setup files can call setupClerkTestingToken({ page })
// to skip bot-protection checks during automated sign-in.

import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup() {
  await clerkSetup();
}
