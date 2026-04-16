// Remove the 4 E2E Clerk users (and implicitly the Prisma rows on next seed).
// Use when Clerk instance config changes (e.g. MFA requirement flipped) and
// the existing users carry stale requirements — re-seed to pick up the new
// defaults.

import { createClerkClient } from '@clerk/backend';

const EMAILS = [
  'e2e-admin@kiloenergies.com',
  'e2e-rep@kiloenergies.com',
  'e2e-subdealer@kiloenergies.com',
  'e2e-pm@kiloenergies.com',
];

const secret = process.env.CLERK_SECRET_KEY;
if (!secret) {
  console.error('CLERK_SECRET_KEY required');
  process.exit(1);
}
const clerk = createClerkClient({ secretKey: secret });

for (const email of EMAILS) {
  const list = await clerk.users.getUserList({ emailAddress: [email] });
  if (list.totalCount === 0) {
    console.log(`  - ${email} (not found)`);
    continue;
  }
  for (const u of list.data) {
    await clerk.users.deleteUser(u.id);
    console.log(`  x ${email} deleted (${u.id})`);
  }
}
console.log('\n✓ E2E Clerk users removed. Now run `npm run test:e2e:setup`.');
