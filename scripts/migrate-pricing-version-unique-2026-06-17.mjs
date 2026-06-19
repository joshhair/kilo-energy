// migrate-pricing-version-unique-2026-06-17.mjs — Phase 3 A1 durable guard.
//
// Adds the DURABLE concurrency/idempotency constraint Codex flagged as the
// real fix for bulk-version-create (the in-tx duplicate check is only
// best-effort): a UNIQUE index on ProductPricingVersion(productId,
// effectiveFrom) so two concurrent publishes can never mint two versions for
// the same product+date. Also adds a partial UNIQUE(productId) WHERE
// effectiveTo IS NULL so a product can never have >1 open version.
//
// Pre-checked safe: the 2026-06-17 window audit shows 0 duplicate
// (productId, effectiveFrom) and 0 multiple-open products post-revert (the lone
// flag is the benign v1↔04-28 boundary overlap, which has DISTINCT effectiveFrom
// values and does not violate either index).
//
// Dry-run re-verifies there are no violations before creating the indexes.
// After --commit: run `npm run snapshot:turso-schema` and reconcile
// schema.prisma (@@unique([productId, effectiveFrom])) so check:schema stays
// green. GATED: --commit is Josh's action.
//
//   node scripts/migrate-pricing-version-unique-2026-06-17.mjs            # dry-run
//   node scripts/migrate-pricing-version-unique-2026-06-17.mjs --commit   # apply

import { createClient } from '@libsql/client';
import 'dotenv/config';

const COMMIT = process.argv.includes('--commit');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || url.startsWith('file:')) { console.error('TURSO_DATABASE_URL must point at prod.'); process.exit(1); }
const db = createClient({ url, authToken });

const IDX_UNIQUE = 'ProductPricingVersion_productId_effectiveFrom_key';
const IDX_ONE_OPEN = 'ProductPricingVersion_one_open_per_product';

// ── Pre-flight: the data must already satisfy both constraints ───────────────
const dupRows = (await db.execute(`
  SELECT productId, effectiveFrom, COUNT(*) AS n
  FROM ProductPricingVersion GROUP BY productId, effectiveFrom HAVING n > 1
`)).rows;
const multiOpen = (await db.execute(`
  SELECT productId, COUNT(*) AS n
  FROM ProductPricingVersion WHERE effectiveTo IS NULL GROUP BY productId HAVING n > 1
`)).rows;
const existing = (await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ProductPricingVersion'`)).rows.map((r) => String(r.name));

console.log(`\n══ ProductPricingVersion UNIQUE migration ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ══`);
console.log(`  duplicate (productId, effectiveFrom): ${dupRows.length}`);
for (const r of dupRows) console.log(`    ✗ ${r.productId} @ ${String(r.effectiveFrom).slice(0, 10)} ×${r.n}`);
console.log(`  products with >1 open version: ${multiOpen.length}`);
for (const r of multiOpen) console.log(`    ✗ ${r.productId} open×${r.n}`);
console.log(`  ${IDX_UNIQUE} exists: ${existing.includes(IDX_UNIQUE)}`);
console.log(`  ${IDX_ONE_OPEN} exists: ${existing.includes(IDX_ONE_OPEN)}`);

if (dupRows.length || multiOpen.length) {
  console.log('\n✗ ABORT — data violates a constraint; resolve before creating indexes.');
  process.exit(1);
}
if (!COMMIT) { console.log('\n✓ Data satisfies both constraints — safe to apply. Re-run with --commit.'); process.exit(0); }

// ── Apply (idempotent — IF NOT EXISTS) ──────────────────────────────────────
try {
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${IDX_UNIQUE} ON ProductPricingVersion(productId, effectiveFrom)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${IDX_ONE_OPEN} ON ProductPricingVersion(productId) WHERE effectiveTo IS NULL`);
} catch (e) {
  console.error(`✗ index creation failed: ${e.message}`);
  process.exit(1);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
const after = (await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ProductPricingVersion'`)).rows.map((r) => String(r.name));
const ok = after.includes(IDX_UNIQUE) && after.includes(IDX_ONE_OPEN);
const fk = (await db.execute('PRAGMA foreign_key_check')).rows.length;
console.log(`  ${IDX_UNIQUE}: ${after.includes(IDX_UNIQUE) ? 'created' : 'MISSING'}`);
console.log(`  ${IDX_ONE_OPEN}: ${after.includes(IDX_ONE_OPEN) ? 'created' : 'MISSING'}`);
console.log(`  FK check: ${fk} violations`);
console.log(ok && fk === 0
  ? '\n✓ MIGRATION COMPLETE. Next: npm run snapshot:turso-schema + add @@unique([productId, effectiveFrom]) to schema.prisma so check:schema stays green.'
  : '\n✗ verification failed.');
process.exit(ok && fk === 0 ? 0 : 1);
