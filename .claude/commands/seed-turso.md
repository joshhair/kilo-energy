Sync the local SQLite dev.db data to the Turso production database.

## Context
- Local dev DB: `C:\Users\Jarvis\Projects\kilo-energy\dev.db` (SQLite via better-sqlite3)
- Production DB: Turso at `TURSO_DATABASE_URL` in `.env`
- Schema: `prisma/schema.prisma`

## Steps

1. Read the Turso credentials from `.env` (`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`)
2. Connect to Turso and check the current state (user count, project count, etc.)
3. Read the local dev.db and export all data from key tables:
   - User, Installer, Financer, Project, PayrollEntry, Reimbursement
   - TrainerAssignment, TrainerOverrideTier, Incentive, IncentiveMilestone
   - Blitz, BlitzParticipant, BlitzCost, BlitzRequest
   - InstallerPricingVersion, InstallerPricingTier
   - Product, ProductPricingVersion, ProductPricingTier
   - ProductCatalogConfig, InstallerPrepaidOption
4. For each table, INSERT OR REPLACE rows into Turso (handle FK ordering — parents before children)
5. Report how many rows were synced per table

## Safety
- This is additive — it adds/updates rows, does NOT delete existing Turso data
- Always confirm the Turso connection works before writing
- Report a dry-run summary before executing (show row counts per table)
- Ask for confirmation before writing to production
