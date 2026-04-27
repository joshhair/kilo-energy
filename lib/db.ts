import { PrismaClient } from './generated/prisma/client';
import path from 'node:path';

const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClient> | undefined };

let prismaInstance: InstanceType<typeof PrismaClient>;

if (globalForPrisma.prisma) {
  prismaInstance = globalForPrisma.prisma;
} else if (process.env.TURSO_DATABASE_URL) {
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
