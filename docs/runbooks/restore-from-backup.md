# Runbook — Restore Turso from Backup

## When to use
- A migration corrupted production data (e.g. bad transform)
- Someone `DROP`ed or `DELETE`d rows they shouldn't have
- Clerk webhook loop wrote garbage to thousands of User rows
- Need to recover to a point before a specific incident

## Two recovery paths

We maintain **two independent** recovery strategies. Use whichever fits
the incident — they target different failure modes.

| Path | Granularity | Coverage | When to reach for it |
|---|---|---|---|
| **A. Turso PITR** (point-in-time restore via `turso db create --from-db --timestamp`) | Seconds | Recent incidents only — Turso's retention window depends on plan | A specific mutation you want to rewind — "undo everything after 11:55 UTC" |
| **B. JSON dump restore** (`scripts/restore-turso.mjs`) | One full snapshot | Disaster — total DB loss, bad migration, Turso region down | Worst case; cross-region recovery; schema-aware merge |

Both paths operate on a **new branch** — production is never touched
until you explicitly promote.

---

## Path A — Turso PITR (primary)

### 1. Identify the target timestamp
When did the bad thing happen? Narrow to within ~30 seconds.

```bash
# Check the audit log for the first bad mutation
npx tsx -e "
import { prisma } from './lib/db';
const suspicious = await prisma.auditLog.findMany({
  where: { createdAt: { gte: new Date('2026-04-15T12:00:00Z') } },
  orderBy: { createdAt: 'asc' },
  take: 20
});
console.log(suspicious);
"
```

Target = **5 minutes before** the first bad mutation. Use ISO UTC format:
`2026-04-15T11:55:00Z`.

### 2. Fork a read-only restore branch
```bash
# Install Turso CLI if not already:
#   curl -sSfL https://get.tur.so/install.sh | bash

turso auth login
turso db list                  # confirm prod DB name (likely "kilo-prod")
turso db shell kilo-prod       # quick sanity check you can connect

# Create restore branch at target timestamp
turso db create kilo-restore-$(date +%Y%m%d-%H%M) \
  --from-db kilo-prod \
  --timestamp '2026-04-15T11:55:00Z'
```

This creates a NEW database branch — production is untouched.

### 3. Verify the restore branch
Point a local dev instance at the restore branch temporarily:
```bash
turso db show kilo-restore-20260415-1155 --url
turso db tokens create kilo-restore-20260415-1155

TURSO_DATABASE_URL="libsql://kilo-restore-..." \
TURSO_AUTH_TOKEN="eyJ..." \
npm run dev
```

Check that the data looks right. Specifically:
- The bad mutation is not present
- Legitimate data from just before is present
- Count rows in the affected tables, compare to expected

### 4. Decide: promote or merge
**Option A — Full revert (fast, loses all good writes after target timestamp):**
Point the Vercel prod env vars at the restore branch.

```bash
vercel env rm TURSO_DATABASE_URL production
vercel env add TURSO_DATABASE_URL production  # paste restore branch URL
vercel env rm TURSO_AUTH_TOKEN production
vercel env add TURSO_AUTH_TOKEN production    # paste restore branch token
vercel --prod
```

**Option B — Selective merge (slow, preserves post-incident good writes):**
Only the affected rows are copied back from the restore branch. Requires
careful SQL — for each corrupted row, `SELECT` from restore branch,
`UPDATE` or `INSERT` into prod. No generic tool; write per-incident.

### 5. Audit + comms
- Write an incident note in `docs/incidents/YYYY-MM-DD-what-happened.md`
- If user data was affected (wrong commissions paid, etc.), notify
  the users who were impacted. Do not hide.
- Log the restore itself in AuditLog with `action: 'db_restore'` so
  history reflects reality.

---

## Path B — JSON dump restore (disaster fallback)

Use when PITR is unavailable (Turso outage, retention expired, plan
limitations) or when you need a cross-region cold start.

### Taking a backup
```bash
# On demand (loads .env, dumps all 25 tables to state/backups/turso-<ts>.json)
set -a && . ./.env && set +a && npm run backup:now
```

Typical size: ~4 MB for the current app. Takes ~3 seconds. Commit the
dump path, not the file itself (pre-launch it's in .gitignore).

### Restoring from a dump
```bash
# Dry-run first — safe, reports what would change
set -a && . ./.env && set +a && npm run restore:from state/backups/turso-2026-04-15-234626.json

# Commit mode after you've reviewed the dry run
set -a && . ./.env && set +a && node scripts/restore-turso.mjs state/backups/turso-2026-04-15-234626.json --commit
```

Two modes:
- `--mode=merge` (default): upsert — existing rows updated, missing rows
  inserted. Safe if you're repopulating a freshly migrated schema.
- `--mode=replace`: wipe each table before inserting. Full rollback.
  Destructive; requires explicit flag.

---

## Drill schedule
Run Path A end-to-end **once a quarter** against a non-prod branch.
If we haven't done it in 90 days, assume backups don't work until proven
otherwise.

### Last verified
- **Path B (JSON dump)**: `2026-04-15` — executed as safety net before
  the Float → Int cents money migration. Dumped 25 tables, 5984 rows,
  3.7 MB to `state/backups/turso-2026-04-15-234626.json` in ~3 s.
  Migration succeeded without needing the rollback — snapshot retained
  for audit.
- **Path A (PITR)**: `(none)` — pending first drill. Requires `turso`
  CLI auth from Josh's machine. When drilling for the first time, time
  the fork + verify steps and record them here.

## Future: automated off-site backup
Currently `scripts/backup-turso.mjs` writes locally to `state/backups/`.
For a real off-site copy, add a weekly cron that uploads the dump to
Vercel Blob (or external S3). Blocked on: decide destination + add
`@vercel/blob` dep + env vars. Tracked as post-launch backlog.
