/**
 * seed-e2e-users.ts — idempotent setup for Playwright E2E test accounts.
 *
 * Creates 4 Clerk users (one per role) AND their matching Prisma User rows.
 * The email is the join key: lib/api-auth.ts#getInternalUser() looks up by
 * email and lazy-links the Clerk user ID on first sign-in, so we seed both
 * sides up-front to make the E2E suite deterministic.
 *
 * Safe to run repeatedly. If a user already exists on either side, we
 * reconcile (link ids, flip active=true) without recreating.
 *
 * Env:
 *   CLERK_SECRET_KEY      — from .env (sk_test_*)
 *   TURSO_DATABASE_URL    — from .env (optional, defaults to local SQLite)
 *   TURSO_AUTH_TOKEN      — from .env (optional, required if TURSO URL set)
 *   E2E_USER_PASSWORD     — shared password for all 4 test accounts. If unset,
 *                           defaults to `E2eTestPassword!2026`. Override in CI.
 *
 * Run:
 *   set -a && . ./.env && set +a && npx tsx scripts/seed-e2e-users.ts
 */

import { createClerkClient } from '@clerk/backend';
import { PrismaLibSql } from '@prisma/adapter-libsql';

// Can't import ../lib/db because it uses top-level await and tsx/Node ESM
// can't transform that transitively. Load the Prisma client via dynamic
// import instead — tsx runs its TS→JS transform on async imports.
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be in env');
  process.exit(1);
}
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'E2eTestPassword!2026';

interface Seed {
  email: string;
  phone: string;   // Clerk test instance requires one; use the E.164 test block.
  firstName: string;
  lastName: string;
  role: 'admin' | 'rep' | 'sub-dealer' | 'project_manager';
  repType: 'closer' | 'setter' | 'both';
  pmFlags?: { canCreateDeals?: boolean; canAccessBlitz?: boolean; canExport?: boolean };
}

// Clerk's documented dev-test phone block is +1 555 555 01xx — libphonenumber
// accepts these as valid E.164 but they're never actually routed.
const SEEDS: Seed[] = [
  { email: 'e2e-admin@kiloenergies.com',     phone: '+15555550101', firstName: 'E2E', lastName: 'Admin',     role: 'admin',           repType: 'both' },
  { email: 'e2e-rep@kiloenergies.com',       phone: '+15555550102', firstName: 'E2E', lastName: 'Rep',       role: 'rep',             repType: 'both' },
  { email: 'e2e-subdealer@kiloenergies.com', phone: '+15555550103', firstName: 'E2E', lastName: 'SubDealer', role: 'sub-dealer',      repType: 'both' },
  { email: 'e2e-pm@kiloenergies.com',        phone: '+15555550104', firstName: 'E2E', lastName: 'PM',        role: 'project_manager', repType: 'both',
    pmFlags: { canCreateDeals: true, canAccessBlitz: true, canExport: true } },
];

async function main() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.error('CLERK_SECRET_KEY is required (should be in .env)');
    process.exit(1);
  }
  const clerk = createClerkClient({ secretKey: secret });

  for (const seed of SEEDS) {
    // 1. Clerk side — create or find by email.
    let clerkUserId: string;
    const existingClerk = await clerk.users.getUserList({ emailAddress: [seed.email] });
    if (existingClerk.totalCount > 0) {
      clerkUserId = existingClerk.data[0].id;
      console.log(`  = Clerk user exists  ${seed.email}  (${clerkUserId})`);
    } else {
      const created = await clerk.users.createUser({
        emailAddress: [seed.email],
        phoneNumber: [seed.phone],
        password: PASSWORD,
        firstName: seed.firstName,
        lastName: seed.lastName,
        skipPasswordChecks: true,
      });
      clerkUserId = created.id;
      console.log(`  + Clerk user created ${seed.email}  (${clerkUserId})`);
    }

    // 2. Prisma side — upsert with the fresh Clerk id pre-linked.
    const data = {
      firstName: seed.firstName,
      lastName: seed.lastName,
      email: seed.email,
      role: seed.role,
      repType: seed.repType,
      active: true,
      clerkUserId,
      ...(seed.pmFlags ?? {}),
    };
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: data,
      create: data,
    });
    console.log(`  ~ Prisma User synced ${seed.email}  (${user.id}, role=${user.role})`);
  }

  await prisma.$disconnect();
  console.log('\n✓ E2E users seeded.');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
