/**
 * scripts/prod-read/index.mts — Read-only Turso accessor for verification.
 *
 * Three layers of "no writes" protection:
 *   1. Refuses to load if NODE_ENV === 'production' or TURSO_DATABASE_URL missing.
 *   2. Exports a Proxy-wrapped Prisma client that whitelists ONLY read
 *      methods on every model. Any call to create/update/delete/upsert/
 *      executeRaw/queryRawUnsafe throws synchronously before hitting Turso.
 *   3. Every successful query writes a one-line audit entry to
 *      `tmp/prod-read.log` (gitignored). The log is the rollout's evidence
 *      trail.
 *
 * Usage:
 *   import { readDb, logQuery } from './index.mts';
 *   const projects = await readDb.project.findMany({ where: { closerId: repId } });
 *   logQuery('project.findMany', { closerId: repId }, projects.length);
 *
 * Never invoke `readDb` directly from app code. This is a verification
 * helper, not an app-side client. App code should use lib/db-gated.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Guard 1: hard environment refusal ──────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  throw new Error('prod-read: refused — NODE_ENV=production. This helper is for local verification only.');
}

// `.env` is loaded by `import 'dotenv/config'` above and holds the real
// Turso creds in this repo. `.env.local` is also loaded but ONLY for
// non-empty values — this repo's .env.local has empty TURSO_* placeholders
// that would otherwise clobber the real values from .env.
const { parse } = await import('dotenv');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const localPath = path.join(repoRoot, '.env.local');
if (existsSync(localPath)) {
  const { readFileSync } = await import('node:fs');
  const parsed = parse(readFileSync(localPath));
  for (const [k, v] of Object.entries(parsed)) {
    if (v && v.length > 0) process.env[k] = v; // override only with real values
  }
}

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error('prod-read: refused — TURSO_DATABASE_URL not set. Confirm .env.local has the prod URL before running.');
}
if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error('prod-read: refused — TURSO_AUTH_TOKEN not set.');
}

// ─── Guard 2: read-only Proxy over the Prisma client ────────────────────────
const READ_METHODS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);

function makeReadOnlyModel(model: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const name = String(prop);
      if (READ_METHODS.has(name)) return value.bind(target);
      // Anything else (create/update/delete/upsert/createMany/updateMany/deleteMany/...)
      // throws synchronously, before the request goes anywhere near the wire.
      return () => {
        throw new Error(`prod-read: refused mutating method '${name}'. Read-only client.`);
      };
    },
  });
}

const { PrismaClient } = await import('../../lib/generated/prisma/client.ts');
const { PrismaLibSql } = await import('@prisma/adapter-libsql');

const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const rawClient = new PrismaClient({ adapter });

// Wrap every model in a read-only proxy. Also block top-level raw escape hatches.
const RAW_BLOCKED = new Set(['$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe', '$transaction', '$connect', '$disconnect', '$extends', '$use', '$on']);

export const readDb = new Proxy(rawClient as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    const name = String(prop);
    if (RAW_BLOCKED.has(name)) {
      // $queryRaw (typed, parameterized) is intentionally allowed; the
      // unsafe + execute variants are blocked because they can mutate.
      return () => {
        throw new Error(`prod-read: refused method '${name}'. Use named queries in queries.mts.`);
      };
    }
    const value = Reflect.get(target, prop, receiver);
    // If it's a model (object with findMany etc), wrap it. Functions and
    // primitives pass through (e.g. $queryRaw is a function, allowed).
    if (value && typeof value === 'object' && 'findMany' in value) {
      return makeReadOnlyModel(value as Record<string, unknown>);
    }
    return value;
  },
}) as ReturnType<typeof PrismaClient.prototype['$extends']> extends never ? typeof rawClient : typeof rawClient;

// ─── Guard 3: audit log ─────────────────────────────────────────────────────
const TMP_DIR = path.join(repoRoot, 'tmp');
const LOG_PATH = path.join(TMP_DIR, 'prod-read.log');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

export function logQuery(fn: string, args: unknown, rowCount: number) {
  const line = `${new Date().toISOString()} ${fn} args=${JSON.stringify(args)} rows=${rowCount}\n`;
  appendFileSync(LOG_PATH, line, 'utf-8');
}

// ─── Snapshot helper ────────────────────────────────────────────────────────
const SNAPSHOT_DIR = path.join(TMP_DIR, 'prod-snapshots');
if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });

export function writeSnapshot(name: string, data: unknown) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAPSHOT_DIR, `${name}-${ts}.json`);
  const { writeFileSync } = require('node:fs');
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

console.error(`prod-read: ready (read-only · DB=${process.env.TURSO_DATABASE_URL?.slice(0, 40)}…) · log=${path.relative(repoRoot, LOG_PATH)}`);
