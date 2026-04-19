# ADR 003 — Turso (libSQL) for the production database

**Date**: 2026-04-03
**Status**: Accepted

## Context

Kilo needs a relational database with: ACID transactions (money),
moderate write load (tens of writes/minute peak), easy backups, low
ops overhead, and pricing that doesn't balloon at 100-500 users.

## Decision

Turso Cloud, using the libSQL fork of SQLite. Accessed from Next.js
via `@prisma/adapter-libsql` + `@libsql/client`. Development uses
plain SQLite via `better-sqlite3` against `dev.db`.

## Alternatives considered

1. **Postgres on Supabase / Neon** — more powerful, more expensive,
   more ops (connection pooling, etc.). Overkill for Kilo's size.

2. **MySQL on PlanetScale** — similar trade-off. No tangible
   advantage for our workload.

3. **DynamoDB** — non-relational, would require reshaping the
   commission model into single-table. Too much friction for a
   workflow that's fundamentally relational.

4. **Prisma + SQLite direct (no Turso)** — works locally but
   doesn't fit serverless. Every Vercel function cold-start
   would reopen a file handle, which isn't how libSQL remote works.

## Consequences

- Migrations run via hand-written SQL scripts (`scripts/migrate-*.mjs`
  using the `runMigration` helper), not Prisma's `migrate deploy`.
  Prisma's migration pipeline fights Turso's schema management. See
  `docs/runbooks/migrations.md`.
- Dev/prod schema drift is a real risk — we mitigate via
  `migrate-dev-db-*.mjs` mirrors and the nightly reconcile cron.
- Backups: JSON-dump based (`scripts/backup-turso.mjs`). Turso also
  offers point-in-time recovery via their dashboard.
- Scaling ceiling: Turso is fine up to ~millions of rows. If we
  genuinely hit that — unlikely for solar commission workflows —
  re-evaluate. Until then, it's the right tool.
