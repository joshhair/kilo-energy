import { PrismaClient } from './generated/prisma/client';
import path from 'node:path';

const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClient> | undefined };

let prismaInstance: InstanceType<typeof PrismaClient>;

if (globalForPrisma.prisma) {
  prismaInstance = globalForPrisma.prisma;
} else if (process.env.TURSO_DATABASE_URL) {
  // Safety TRIPWIRE (2026-06-12 incident): WARN — never throw — when a context
  // we are CONFIDENT is non-production connects to the PRODUCTION database.
  //
  // Deliberately a console warning, not a hard stop: the automated path that
  // caused the wipe (vitest via audit:pre-push) is already hard-blocked in
  // tests/setup/no-prod-db-guard.ts before it can reach this file. The only
  // residual this covers is a HUMAN running `next dev`/`next start` against
  // prod, and a loud log is enough to catch that mistake — while a throw in
  // the live app's DB-init path is the one thing we never want to risk. A
  // console.error cannot break the deployed app under any env assumption.
  //
  // Detection only fires on positively-non-prod contexts (vitest test, next
  // dev, Vercel preview/dev); the deployed prod app (NODE_ENV=production) and
  // ambiguous contexts stay silent. URL is percent-decoded, Unicode-dot-folded
  // and lowercased before the host match. Set ALLOW_PROD_DB=1 to silence it
  // for an intentional local-against-prod session.
  const PROD_DB_HOST = 'kilo-energy-joshhair.aws-us-east-2.turso.io';
  let normalizedDbUrl = process.env.TURSO_DATABASE_URL;
  try {
    for (let i = 0; i < 3 && /%[0-9a-fA-F]{2}/.test(normalizedDbUrl); i++) {
      const next = decodeURIComponent(normalizedDbUrl);
      if (next === normalizedDbUrl) break;
      normalizedDbUrl = next;
    }
  } catch { /* malformed encoding — fall back to raw */ }
  normalizedDbUrl = normalizedDbUrl.replace(/[。．｡]/g, '.');
  const targetsProd = normalizedDbUrl.toLowerCase().includes(PROD_DB_HOST);
  const vercelEnv = process.env.VERCEL_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const confidentNonProd =
    vercelEnv === 'preview' ||
    vercelEnv === 'development' ||
    (vercelEnv === undefined && (nodeEnv === 'development' || nodeEnv === 'test'));
  if (targetsProd && confidentNonProd && process.env.ALLOW_PROD_DB !== '1') {
    console.error(
      '\n⚠  WARNING: a NON-PRODUCTION runtime is connecting to the PRODUCTION database ' +
        `(VERCEL_ENV=${vercelEnv ?? 'undefined'}, NODE_ENV=${nodeEnv ?? 'undefined'}).\n` +
        '   You are about to read/write LIVE data. This is how the 2026-06-12 wipe happened.\n' +
        '   If unintended, stop now and unset TURSO_DATABASE_URL. Set ALLOW_PROD_DB=1 to silence.\n',
    );
  }
  // Production: use Turso (libSQL) adapter
  const { PrismaLibSql } = await import('@prisma/adapter-libsql');
  const adapter = new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  prismaInstance = new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
} else {
  // Local dev: use better-sqlite3 with file-based DB
  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
  const dbPath = path.resolve(process.cwd(), 'dev.db');
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prismaInstance = new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prismaInstance;
}

/**
 * Raw Prisma client — UNFILTERED. Sees every row regardless of caller.
 *
 * This is the legacy export still used by routes that haven't migrated
 * to the privacy-gated client (`db` from `lib/db-gated.ts`). New code
 * should default to `db` and only use this when an admin path
 * legitimately needs unfiltered access (cron jobs, migrations, the
 * audit log writer itself, the bulk /api/data endpoint which builds
 * its own per-role WHERE inline).
 */
export const prisma = prismaInstance;

/**
 * Explicit alias for `prisma`. Use this name in admin-only files to
 * make intent obvious at the import site:
 *
 *   import { dbAdmin } from '@/lib/db';
 *
 * vs.
 *
 *   import { db } from '@/lib/db-gated';
 *
 * The lint rule (Phase 4) will only allow `dbAdmin` imports inside
 * `lib/admin-only/` and `app/api/cron/`. Outside those paths, the
 * gated `db` client is required.
 */
export const dbAdmin = prismaInstance;
