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

export const prisma = prismaInstance;
