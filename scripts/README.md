# scripts/

Utility scripts for admin operations against the production database.
Organized by purpose. Each script has a header comment explaining what
it does and how to run it.

**All scripts touching prod require Turso env vars loaded**:
```bash
set -a && . ./.env && set +a
```

Most scripts default to dry-run and require `--commit` to actually
write. Never pass `--commit` without eyeballing the dry-run output first.

---

## Migrations

Schema changes. See [docs/runbooks/migrations.md](../docs/runbooks/migrations.md)
for the safety checklist before running any of these.

- `migrate-helpers.mjs` — shared `runMigration({ up, down })` scaffold
- `migrate-add-*.mjs` — targeted forward migrations (one per field/index)
- `migrate-dev-db-*.mjs` — mirrors of the above, pointed at `dev.db` via
  better-sqlite3 for local parity

---

## Backfills

One-shot data corrections. Each reads from prod, computes the expected
state, and (with `--commit`) writes corrections.

- `backfill-imported-from-glide.mts` — marks historical projects as
  imports (used to gate chargeback generation + reconcile drift scan)
- `backfill-payroll-roles.mts` — infers correct rep-role on payroll
  entries from surrounding context
- `backfill-project-expected-formula.mts` — fills M1/M2/M3 for
  imports using `splitCloserSetterPay`
- `backfill-project-expected.mts` — older version; use the `-formula`
  variant unless working with legacy data
- `backfill-project-paid-flags.mts` — sets `m1Paid/m2Paid/m3Paid`
  boolean flags from PayrollEntry rows
- `backfill-setter-readd-m1.mts` — creates orphan setter M1 entries
  for deals where the old setter-re-add guard silently dropped them
  (Batch 0 fix's historical cleanup). Skips Glide imports.

---

## Reconcile / audit tools

Read-only diagnostics. Never write without `--commit`.

- `reconcile-project-commission.mts` — scans every non-cancelled,
  non-imported project and diffs stored M1/M2/M3 against what
  `splitCloserSetterPay` would compute. `--commit` rewrites drifted
  amounts. Wired to a nightly GitHub Action (`.github/workflows/reconcile.yml`).

---

## Backup / restore

- `backup-turso.mjs` — dumps every Turso table to timestamped JSON in
  `state/backups/`. `npm run backup:now` wrapper exists.
- `restore-turso.mjs` — reverse: reads a dump, wipes tables, re-inserts.
  `npm run restore:from -- path/to/dump.json`.
- `restore-solartech-baselines.mjs` — targeted one-off for SolarTech
  product pricing.

See [docs/runbooks/backup-restore.md](../docs/runbooks/backup-restore.md)
for the rehearsal procedure.

---

## Import / seed

- `import-glide.mts` — bulk-import of 564 projects from Glide CSV
  export. One-shot; archived but kept for reference.
- `glide-review-report.mts` — diff tool for spot-checking import
  correctness.
- `analyze-glide-reps.mts` — read-only stats on rep distribution
  from Glide data.
- `debug-glide-csv.mts` — inspector for the raw Glide CSV dump.
- `seed-e2e-users.mts` — creates the E2E test users referenced by
  Playwright auth setup. `npm run test:e2e:setup`.

---

## Testing

- `load-test.mts` — k6-style concurrency smoke for the API. `npm run load:test`.
- `delete-e2e-users.mts` — cleanup inverse of `seed-e2e-users.mts`.
- `wipe-dummy-data.mts` — clears non-production data. `npm run wipe:dry` /
  `wipe:confirm`. **Gated**: will refuse to run if env points at prod.

---

## Local debug / one-offs

Short-lived scripts used to investigate a specific issue. Kept in the
tree for now so the investigation is reproducible, but candidates for
deletion once the issue has a proper test or runbook.

- `check-gary-leger.mts` — inspects Gary Leger's project + payroll
  wiring. Used during the Paul Tupou trainer-card investigation.
- `check-hunter.mts` — one-off for a specific rep's state.
- `check-prod-counts.mts` — sanity counts across tables.
- `check-role-counts.mts` — rep role distribution.
- `check-site-survey.mts` — site-survey phase investigation.
- `check-timothy-baseline.mts` — Timothy Salunga baseline check
  during the commission-drift root cause.
- `check-timothy-salunga.mts` — Timothy Salunga project + payroll
  dump. Wrapper around the orphan-setter-M1 investigation path.
- `debug-installer-columns.mts` — installer schema inspection.
- `debug-max-deal.mts` — finds the largest deal for spot-checking.
- `debug-unresponsive.mts` — locates projects stuck in a phase.

### Orphans / ignored

- `find-timothy.mts` — excluded from typecheck + lint + gitignore'd.
  References `sqlite3` + `sqlite` packages that aren't in package.json.
  Kept on disk for historical reference but out of every verification
  loop. If you need similar investigation: copy the pattern from
  `check-timothy-salunga.mts` instead (uses Prisma + Turso adapter
  properly).

### Policy

Adding new one-offs is fine for active investigation. When the
investigation resolves:

1. If the script has ongoing value → rename it to a descriptive name,
   add it to the relevant section above, commit.
2. If it's truly single-use → delete it. Git history preserves it if
   you need to reference the pattern later.
3. If unsure → leave it here ~30 days, then review.

Don't accumulate cruft forever.
