# Runbook: Schema Migrations

Every Prisma schema change needs to land safely in prod. The app
uses Turso (libSQL, SQLite-backed) so migrations run via hand-written
SQL scripts under `scripts/migrate-*.mjs` rather than Prisma's
`migrate deploy` — the serverless Turso environment doesn't play well
with Prisma's lockfile approach.

This checklist exists because schema drift between dev.db and prod
has bitten us before. Follow it every time.

---

## Before you touch the schema

1. **Understand the current state**:
   - Prisma schema: `prisma/schema.prisma`
   - Prod schema: `turso db shell $DB_NAME ".schema ModelName"`
   - Dev schema: `sqlite3 dev.db ".schema ModelName"`
   - Drift between them: suspicious. Reconcile BEFORE adding.

2. **Decide if it's reversible**:
   - Adding a nullable column: reversible, safe
   - Adding a NOT NULL column with default: reversible if default is stable
   - Renaming a column: one-way (Turso doesn't support atomic rename)
   - Dropping a column: one-way; backfill from audit log if needed
   - Changing a column type: complex; usually needs add-new + backfill + drop-old

3. **Plan the rollback**: write the reverse migration script BEFORE
   writing the forward one. If you can't write the reverse, the
   forward needs more thought.

---

## Authoring the migration

1. **Update `prisma/schema.prisma`** — adds the field/model/index.

2. **Create `scripts/migrate-add-{thing}.mjs`** using the
   `runMigration({ up, down })` helper pattern. Example template:

   ```js
   import { runMigration } from './migrate-helpers.mjs';

   runMigration({
     name: 'add-phase-changed-at',
     up: async (db) => {
       await db.execute(`ALTER TABLE Project ADD COLUMN phaseChangedAt DATETIME`);
     },
     down: async (db) => {
       // Turso doesn't support DROP COLUMN directly — recreate table
       // without the column. Document the full steps here.
       await db.execute(`...`);
     },
   });
   ```

3. **Create the dev-db mirror at `scripts/migrate-dev-db-{thing}.mjs`**
   — same logic but pointed at `dev.db` via better-sqlite3. This keeps
   local dev in sync with prod.

4. **Regenerate Prisma client**: `npx prisma generate`.

5. **Typecheck**: `npm run typecheck`. If anything red, fix before
   touching a database.

---

## Dry-run gauntlet (in order)

### 1. Dev DB first
```
node scripts/migrate-dev-db-{thing}.mjs
```
If this fails, stop. Debug locally. Never touch prod until dev is green.

### 2. Turso branch (if you have one)
```
turso db create staging-migration-test --from-db kilo-energy-prod
node scripts/migrate-{thing}.mjs --url=$STAGING_URL
# verify the schema change
turso db shell staging-migration-test ".schema"
# run typecheck against staging
turso db destroy staging-migration-test
```

If you don't have a staging branch, create one for anything larger
than an ALTER ADD COLUMN. Five minutes of setup beats five hours of
incident response.

### 3. Full verification on the application
```
npm run typecheck
npm run test:unit
npm run test:api   # uses dev.db, catches query regressions
```

Green across all three is the gate.

---

## Apply to prod

```
set -a && . ./.env && set +a
node scripts/migrate-{thing}.mjs
```

Immediately after:

```
turso db shell $DB_NAME ".schema ModelName"
```

Confirm the change landed. Then `npm run dev` with PROD env vars (a
temp .env.local swap) to verify the app still boots. Then deploy.

---

## The reversibility table

| Change | Reversible? | Notes |
|---|---|---|
| ADD COLUMN (nullable) | Yes — `ALTER TABLE x DROP COLUMN y` | Safest default |
| ADD COLUMN (NOT NULL with default) | Yes | Backfill happens implicitly via default |
| DROP COLUMN | **No** (without a full table rebuild) | Dump data first if you might need it |
| RENAME COLUMN | Effectively no on Turso | Add-new + backfill + drop-old pattern |
| ADD INDEX | Yes — `DROP INDEX` | Free to add/remove |
| CHANGE COLUMN TYPE | **Dangerous** | Add new column, migrate values, drop old |
| ADD TABLE | Yes — `DROP TABLE` | Free |
| DROP TABLE | **No** without full backup | Treat as destructive |

---

## Emergency: I shipped a bad migration

1. **Do NOT panic-rollback the app** — the new code expects the new
   schema. Rolling back the code while prod still has the new schema
   is worse than leaving both.

2. **If the migration's rollback is clean**: run the `down` step from
   your script. Then redeploy the prior app version.

3. **If data corruption**: restore from the latest Turso backup
   (see `docs/runbooks/backup-restore.md`). Accept data loss up to
   the backup timestamp — that's the worst-case guarantee.

4. **Postmortem**: write the incident up in `docs/runbooks/incidents/`.
   Every bad migration should produce a checklist item that prevents
   its recurrence.

---

## Things you should never do

- Run `prisma migrate deploy` against prod. We don't use the Prisma
  migration pipeline — it fights Turso's schema management.
- Apply a migration directly via `turso db shell` without a script.
  The script is the audit record.
- Skip the dev.db dry-run. "It's a small ADD COLUMN" is exactly the
  kind of change that leaks a NOT NULL constraint bug.
- Ship a forward migration without a written down step. Even if
  you're sure you won't need it.
- Modify the prod schema while the reconcile cron is running (6 UTC
  daily). Brief race, but observed.
