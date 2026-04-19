# Runbook: Backup & Restore

Turso gives us point-in-time recovery for the managed DB, but "Turso
has it" is an unverified claim until we've actually restored from a
backup at least once. This runbook is the rehearsal procedure — the
scripts already exist (`scripts/backup-turso.mjs` +
`scripts/restore-turso.mjs`), what was missing was a tested
end-to-end procedure.

---

## What gets backed up

`scripts/backup-turso.mjs` dumps every table in the prod Turso DB to
a timestamped JSON file in `state/backups/`. Every row, every column.
File size grows with data — currently ~5 MB for 564 projects +
associated payroll, reimbursements, audit logs.

State NOT captured by the JSON dump:
- Vercel Blob receipts (stored separately in blob storage)
- Clerk user data (Clerk has its own backup; not our problem)
- Anything in memory or caches

If you need a full disaster recovery (lose Turso + Blob), restore Turso
from the JSON dump and re-upload receipts from whatever source of
truth you have. Receipts older than 30 days may already be gone from
local machines; customers may need to resend.

---

## Quick backup (run anytime, read-only)

```bash
set -a && . ./.env && set +a
npm run backup:now
```

Output: `state/backups/turso-dump-YYYY-MM-DD-HHmm.json` — path
printed on completion.

**Do this before any risky operation** (bulk import, large migration,
admin script that touches prod). Two minutes of insurance.

---

## Anchor backups (long-term retention)

Some backups are worth keeping indefinitely — the state right before
a major data import, the state right before a schema migration, etc.
To promote a routine backup to a permanent anchor:

```bash
mv state/backups/turso-dump-2026-04-15-1530.json \
   state/backups/anchor-pre-glide-import-2026-04-15.json
git add state/backups/anchor-pre-glide-import-2026-04-15.json
git commit -m "Anchor backup: pre-Glide-import state"
```

`.gitignore` is configured to keep `anchor-*.json` but ignore regular
`turso-dump-*.json` rotational backups. That way the repo stays small
while critical historical states are versioned.

---

## Restore procedure

### Scenario A: Full recovery into an empty Turso DB

1. **Have** the JSON dump file path handy.
2. **Have** TURSO_DATABASE_URL pointing at the target DB (typically
   a fresh-empty one you've created). Do NOT run this against a DB
   that still has data unless you're OK wiping it.

```bash
set -a && . ./.env && set +a
npm run restore:from -- state/backups/turso-dump-YYYY-MM-DD-HHmm.json
```

The script wipes every table and re-inserts every row from the
dump. Duration scales with row count; the 564-project dataset takes
~90 seconds.

### Scenario B: Surgical restore of one table

The script is written whole-DB. For a single-table recovery (e.g.
"the AuditLog table got truncated by accident"), the fastest path
is to modify a copy of the script to restore only that table. Not
covered by the standard procedure; if you need this, it's an
incident — write it up.

### Scenario C: Revert the last 10 minutes (Turso PITR)

Turso Cloud offers point-in-time recovery via their dashboard:

1. Log into Turso Cloud → select the DB
2. Click "Restore" → pick a timestamp within the retention window
3. Turso creates a NEW DB with the restored state
4. Point `TURSO_DATABASE_URL` at the new DB (requires Vercel env var
   update + redeploy)

Use this for "we accidentally shipped a data-corrupting migration in
the last N minutes." Slower than the JSON-dump path for a targeted
restore, but faster if the blast radius is broad.

---

## The rehearsal itself — how to test this without touching prod

Do this quarterly. Mark it on the calendar.

1. **Take a prod backup** via `npm run backup:now`.
2. **Create a staging DB**: `turso db create staging-restore-test`.
3. **Point env at staging**:
   ```bash
   export TURSO_DATABASE_URL=$(turso db show staging-restore-test --url)
   export TURSO_AUTH_TOKEN=$(turso db tokens create staging-restore-test)
   ```
4. **Run the restore**:
   ```bash
   npm run restore:from -- state/backups/turso-dump-YYYY-MM-DD-HHmm.json
   ```
5. **Spot-check**: connect via `turso db shell staging-restore-test`,
   count rows in 3 tables, pick one Project and verify its fields
   match what you see in prod.
6. **Boot the app against staging**: swap `.env.local` to point at
   staging, `npm run dev`, log in, visit a project detail page. If
   it renders correctly, the restore procedure works end-to-end.
7. **Cleanup**: `turso db destroy staging-restore-test`.
8. **Document**: update this runbook with the date of the successful
   rehearsal and any surprises below.

---

## Rehearsal log

- **2026-04-19**: Runbook created. First rehearsal pending — schedule
  for next Monday's operations block.
- _(add entries as rehearsals complete)_

---

## What to do during an actual incident

1. **Stop writes** first if possible — put the app in maintenance mode
   via Vercel dashboard (env var flag to a "we're down, back soon"
   page). Prevents new corrupt data while you work.
2. **Snapshot current state** — take a backup even of the corrupted
   DB. If the restore goes sideways, you want the "before restore"
   state.
3. **Communicate** — DM affected users. Even a "we're investigating"
   beats silence.
4. **Restore** via the appropriate scenario above.
5. **Verify** — have someone other than you spot-check 5 random
   projects + 5 random payroll rows against expectation.
6. **Unlock writes** — remove the maintenance flag.
7. **Postmortem** within 48 hours. What caused it? What detect
   mechanism missed it? What prevent-mechanism needs to land?
