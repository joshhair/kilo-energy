# Runbook — Restore Turso from Backup

## When to use
- A migration corrupted production data (e.g. bad transform)
- Someone `DROP`ed or `DELETE`d rows they shouldn't have
- Clerk webhook loop wrote garbage to thousands of User rows
- Need to recover to a point before a specific incident

## Turso's backup model
Turso (libSQL) supports **point-in-time restore** via database branching.
The prod DB is automatically snapshotted continuously; you can "fork" from
any prior moment into a new DB branch, inspect it, and promote if good.

## Restore procedure

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
# Get connection string for the restore branch
turso db show kilo-restore-20260415-1155 --url
turso db tokens create kilo-restore-20260415-1155

# Run the app locally against it
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
Point the Vercel prod env vars at the restore branch. Update
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel, redeploy.

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

## Drill schedule
Run this drill end-to-end **once a quarter** against a non-prod branch.
If we haven't done it in 90 days, assume backups don't work until proven
otherwise.

Last drill: (none — run first drill before public launch)
