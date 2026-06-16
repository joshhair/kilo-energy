// revert-enfin-qpeak-dc-pw3-2026-06-16.mjs — Phase 2b. Revert the Enfin product
// "Q.Peak DUO DC + Powerwall 3" (ef-qpeak-dc-pw3) to its PRE-KEYSTROKE state.
//
// DISCOVERED BY the Phase 3 A1 read-only window-integrity audit
// (scripts/audit-pricing-windows-2026-06-16.mjs): the June-15/16 inline-grid
// keystroke session corrupted TWO Enfin products, not one. The Q.TRON product is
// handled by revert-enfin-pricing-2026-06-16.mjs; THIS product was missed by the
// original remediation and still carries 24 junk versions.
//
// Authoritative pre-keystroke state — state/backups/turso-2026-06-04-115722.json
// (June 4, well before the session) — shows this product had EXACTLY 2 versions:
//   v1 ppv_ef-qpeak-dc-pw3_v1  (from 2020-01-01, CLOSED to 2026-04-28)  — keep as-is
//   cmoiumnd8001d0bl7e7qkaoan  "Q2 2026 Pricing" (from 2026-04-28, OPEN) — the live baseline
// The session (1) created a rate-IDENTICAL "effective 2026-06-08" duplicate
// (cmqg0gusc…, which closed cmoiumnd8 to 2026-06-07) and (2) exploded 23
// degenerate same-day "2026-06-16" versions. 0 real projects reference any of
// the 24 junk versions (Project.productPricingVersionId is ON DELETE SET NULL;
// we assert zero refs ourselves regardless).
//
// Revert = delete the 24 FROZEN junk versions (+ their 96 tiers) and restore
// cmoiumnd8.effectiveTo=null. cmoiumnd8's tiers are NOT modified (asserted ==
// the June-4 baseline first). End state = the exact 2-version June-4 graph.
//
// Same Codex-hardened pattern as the Q.TRON revert: FROZEN delete IDs + in-tx
// set-equality + FULL baseline tier assert (re-run in-tx) + kept-version identity
// + rollback JSON written/verified BEFORE the tx + AuditLog + post-verify +
// rollback on mismatch.
//
//   node scripts/revert-enfin-qpeak-dc-pw3-2026-06-16.mjs            # dry-run
//   node scripts/revert-enfin-qpeak-dc-pw3-2026-06-16.mjs --commit   # apply

import { createClient } from '@libsql/client';
import * as fs from 'node:fs';
import 'dotenv/config';

const COMMIT = process.argv.includes('--commit');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || url.startsWith('file:')) { console.error('TURSO_DATABASE_URL must point at prod.'); process.exit(1); }
const db = createClient({ url, authToken });

const PID = 'ef-qpeak-dc-pw3';
const V1 = 'ppv_ef-qpeak-dc-pw3_v1';            // historical, stays CLOSED — kept, not touched
const BASE = 'cmoiumnd8001d0bl7e7qkaoan';       // the 04-28 "Q2 2026 Pricing" — restore to OPEN
const BASE_EFFECTIVE_FROM = '2026-04-28';
const BASE_EXPECTED_EFFECTIVE_TO = '2026-06-07'; // closed by the session; we restore to null
const V1_EFFECTIVE_FROM = '2020-01-01';
const V1_EXPECTED_EFFECTIVE_TO = '2026-04-28';

// FROZEN delete set — 24 junk versions (the rate-identical 06-08 dup + 23
// degenerate same-day versions). Everything for this product EXCEPT {V1, BASE}.
const FROZEN_DELETE_IDS = [
  'cmqg0gusc000004ibm3tzxgn7',
  'cmqg0pu6l000004l4j6g16jqo', 'cmqg0px68000604l47i5np0ms', 'cmqg0pxs9000c04l4qvcla5pn',
  'cmqg0q2w2000i04l43fxp4w11', 'cmqg0q7zj000o04l4wgwnqlbq', 'cmqg0q8n2000u04l4z9kgix0u',
  'cmqg0q9z5001004l455tajtj2', 'cmqg0qlhp001604l4oedpawet', 'cmqg0qlq2001c04l4eb8rs2tj',
  'cmqg0qmcs001i04l4tjgn0s89', 'cmqg0qmp6000004i6oaos4zuy', 'cmqg0qozb000604i6muzenfg6',
  'cmqg0qp8t000c04i6b0hg608a', 'cmqg0r0po000i04i6z3oduxsd', 'cmqg0r0wi000o04i6mh6rlbsf',
  'cmqg0r1ev000u04i6jm7r57hs', 'cmqg0r1p1001004i697wofp20', 'cmqg0r5vn001604i6c8ix5aap',
  'cmqg0r6nc001c04i661o3wk1i', 'cmqg0r77p001i04i6rrw868zx', 'cmqg0r9qp001o04i6crsklrhz',
  'cmqg0r9z0001u04i62eufqzf3', 'cmqg0rae0002004i6z4lsvh1n',
];
const inc = FROZEN_DELETE_IDS.map((i) => `'${i}'`).join(',');

// Full pre-keystroke baseline tiers for cmoiumnd8 (BASE) from the June-4 backup.
const BASELINE_TIERS = [
  { minKW: 1, maxKW: 5, closerPerW: 3.2, setterPerW: 3.3, kiloPerW: 2.7, subDealerPerW: null },
  { minKW: 5, maxKW: 10, closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.35, subDealerPerW: null },
  { minKW: 10, maxKW: 13, closerPerW: 2.8, setterPerW: 2.9, kiloPerW: 2.25, subDealerPerW: null },
  { minKW: 13, maxKW: null, closerPerW: 2.75, setterPerW: 2.85, kiloPerW: 2.25, subDealerPerW: null },
];
// Full pre-keystroke v1 tiers from the June-4 backup. v1 is KEPT (not touched),
// but we assert its tiers too (Codex review): the two-version graph we preserve
// includes v1, so its rates must be the authoritative ones. NB: v1's 5-10kW kilo
// is 2.3, distinct from BASE's 2.35 — the two kept versions are not identical.
const BASELINE_V1_TIERS = [
  { minKW: 1, maxKW: 5, closerPerW: 3.2, setterPerW: 3.3, kiloPerW: 2.7, subDealerPerW: null },
  { minKW: 5, maxKW: 10, closerPerW: 2.85, setterPerW: 2.95, kiloPerW: 2.3, subDealerPerW: null },
  { minKW: 10, maxKW: 13, closerPerW: 2.8, setterPerW: 2.9, kiloPerW: 2.25, subDealerPerW: null },
  { minKW: 13, maxKW: null, closerPerW: 2.75, setterPerW: 2.85, kiloPerW: 2.25, subDealerPerW: null },
];
const norm = (t) => JSON.stringify((t ?? []).map((x) => ({
  minKW: x.minKW, maxKW: x.maxKW ?? null, closerPerW: x.closerPerW, setterPerW: x.setterPerW,
  kiloPerW: x.kiloPerW, subDealerPerW: x.subDealerPerW ?? null,
})));
const num = async (runner, sql) => Number((await runner.execute(sql)).rows[0].n);
const tiersOf = async (runner, versionId) => (await runner.execute({
  sql: 'SELECT minKW,maxKW,closerPerW,setterPerW,kiloPerW,subDealerPerW FROM ProductPricingTier WHERE versionId=? ORDER BY minKW, maxKW',
  args: [versionId],
})).rows;
const verRow = async (runner, id) => (await runner.execute({ sql: 'SELECT id,productId,effectiveFrom,effectiveTo FROM ProductPricingVersion WHERE id=?', args: [id] })).rows[0];
const day = (v) => (v == null ? null : String(v).slice(0, 10));

// ── Read-only preflight ─────────────────────────────────────────────────────
const failures = [];
const base = await verRow(db, BASE);
if (!base) failures.push('BASE (04-28 version) not found');
else {
  if (base.productId !== PID) failures.push(`BASE.productId ${base.productId} != ${PID}`);
  if (day(base.effectiveFrom) !== BASE_EFFECTIVE_FROM) failures.push(`BASE.effectiveFrom ${day(base.effectiveFrom)} != ${BASE_EFFECTIVE_FROM}`);
  if (day(base.effectiveTo) !== BASE_EXPECTED_EFFECTIVE_TO) failures.push(`BASE.effectiveTo ${day(base.effectiveTo)} != ${BASE_EXPECTED_EFFECTIVE_TO} (unexpected state)`);
}
const v1 = await verRow(db, V1);
if (!v1) failures.push('v1 not found');
else {
  if (v1.productId !== PID) failures.push(`v1.productId ${v1.productId} != ${PID}`);
  if (day(v1.effectiveFrom) !== V1_EFFECTIVE_FROM) failures.push(`v1.effectiveFrom ${day(v1.effectiveFrom)} != ${V1_EFFECTIVE_FROM}`);
  if (day(v1.effectiveTo) !== V1_EXPECTED_EFFECTIVE_TO) failures.push(`v1.effectiveTo ${day(v1.effectiveTo)} != ${V1_EXPECTED_EFFECTIVE_TO}`);
}
const baseTiersMatch = norm(await tiersOf(db, BASE)) === norm(BASELINE_TIERS);
if (!baseTiersMatch) failures.push('BASE tiers DO NOT match the June-4 baseline (full minKW/maxKW/closer/setter/kilo/subDealer) — manual review');
const v1TiersMatch = norm(await tiersOf(db, V1)) === norm(BASELINE_V1_TIERS);
if (!v1TiersMatch) failures.push('v1 tiers DO NOT match the June-4 baseline (full) — manual review');

// Frozen set must equal "all versions of this product except {V1, BASE}" exactly.
const actualOther = (await db.execute(`SELECT id FROM ProductPricingVersion WHERE productId='${PID}' AND id NOT IN ('${V1}','${BASE}')`)).rows.map((r) => String(r.id)).sort();
const frozenSorted = [...FROZEN_DELETE_IDS].sort();
if (JSON.stringify(actualOther) !== JSON.stringify(frozenSorted)) failures.push(`frozen delete-set != current other-versions set (frozen ${frozenSorted.length}, actual ${actualOther.length})`);
const realRefs = await num(db, `SELECT COUNT(*) AS n FROM Project WHERE productPricingVersionId IN (${inc})`);
if (realRefs) failures.push(`${realRefs} real projects reference a to-delete version`);
const wrongProduct = await num(db, `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE id IN (${inc}) AND productId != '${PID}'`);
if (wrongProduct) failures.push(`${wrongProduct} frozen ids are not on this product`);

const tierCount = await num(db, `SELECT COUNT(*) AS n FROM ProductPricingTier WHERE versionId IN (${inc})`);
const beforeVersions = (await db.execute(`SELECT * FROM ProductPricingVersion WHERE id IN (${inc})`)).rows;
const beforeTiers = (await db.execute(`SELECT * FROM ProductPricingTier WHERE versionId IN (${inc})`)).rows;
const beforeState = { deletedVersionIds: FROZEN_DELETE_IDS, versions: beforeVersions, tiers: beforeTiers, base: { id: BASE, effectiveToBefore: day(base?.effectiveTo) ?? null } };

console.log(`\n══ Q.Peak DUO DC + Powerwall 3 pricing revert ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ══`);
console.log(`  BASE (04-28) effectiveTo now: ${day(base?.effectiveTo)}  →  restore to null (re-open)`);
console.log(`  BASE tiers match June-4 baseline (full): ${baseTiersMatch}`);
console.log(`  v1 tiers match June-4 baseline (full): ${v1TiersMatch}`);
console.log(`  v1 stays closed: from ${day(v1?.effectiveFrom)} to ${day(v1?.effectiveTo)}`);
console.log(`  frozen delete set == current other-versions set: ${JSON.stringify(actualOther) === JSON.stringify(frozenSorted)}`);
console.log(`  versions to delete: ${FROZEN_DELETE_IDS.length}  (+ ${tierCount} tiers)`);
console.log(`  real-project refs: ${realRefs}`);
console.log(`  preflight failures: ${failures.length}`);
for (const f of failures) console.log(`    ✗ ${f}`);
if (failures.length) { console.log('\n✗ ABORT — guard failed.'); process.exit(1); }
if (!COMMIT) { console.log('\n(dry-run) No changes. Re-run with --commit.'); process.exit(0); }

// ── Write + verify rollback artifact BEFORE mutating ────────────────────────
const outDir = 'state/backups';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const rollbackPath = `${outDir}/enfin-qpeak-dc-pw3-revert-rollback-2026-06-16.json`;
fs.writeFileSync(rollbackPath, JSON.stringify(beforeState, null, 1));
const verifyBack = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
if (verifyBack.deletedVersionIds.length !== 24 || verifyBack.versions.length !== beforeVersions.length) {
  console.error('✗ rollback artifact failed to write/verify — aborting BEFORE any mutation.');
  process.exit(1);
}
console.log(`  rollback artifact written + verified: ${rollbackPath}`);

// ── Commit (single write transaction; full asserts re-run in-tx) ────────────
const tx = await db.transaction('write');
try {
  const otherTx = (await tx.execute(`SELECT id FROM ProductPricingVersion WHERE productId='${PID}' AND id NOT IN ('${V1}','${BASE}')`)).rows.map((r) => String(r.id)).sort();
  if (JSON.stringify(otherTx) !== JSON.stringify(frozenSorted)) throw new Error('in-tx other-versions set != frozen set');
  const baseTx = await verRow(tx, BASE);
  if (!baseTx || baseTx.productId !== PID || day(baseTx.effectiveFrom) !== BASE_EFFECTIVE_FROM || day(baseTx.effectiveTo) !== BASE_EXPECTED_EFFECTIVE_TO) throw new Error(`in-tx BASE identity mismatch: ${JSON.stringify(baseTx)}`);
  if (norm(await tiersOf(tx, BASE)) !== norm(BASELINE_TIERS)) throw new Error('in-tx BASE tiers != baseline');
  const v1Tx = await verRow(tx, V1);
  if (!v1Tx || v1Tx.productId !== PID || day(v1Tx.effectiveFrom) !== V1_EFFECTIVE_FROM || day(v1Tx.effectiveTo) !== V1_EXPECTED_EFFECTIVE_TO) throw new Error(`in-tx v1 identity mismatch: ${JSON.stringify(v1Tx)}`);
  if (norm(await tiersOf(tx, V1)) !== norm(BASELINE_V1_TIERS)) throw new Error('in-tx v1 tiers != baseline');
  const refTx = Number((await tx.execute(`SELECT COUNT(*) AS n FROM Project WHERE productPricingVersionId IN (${inc})`)).rows[0].n);
  if (refTx) throw new Error(`in-tx ${refTx} real project refs`);

  const del = async (label, sql, expected) => {
    const r = await tx.execute(sql);
    console.log(`  ${label}: ${r.rowsAffected}`);
    if (Number(r.rowsAffected) !== expected) throw new Error(`${label} affected ${r.rowsAffected}, expected ${expected}`);
  };
  await del('tiers', `DELETE FROM ProductPricingTier WHERE versionId IN (${inc})`, tierCount);
  await del('versions', `DELETE FROM ProductPricingVersion WHERE id IN (${inc})`, 24);
  await del('restore BASE effectiveTo=null', `UPDATE ProductPricingVersion SET effectiveTo = NULL WHERE id = '${BASE}'`, 1);

  await tx.execute({
    sql: `INSERT INTO AuditLog (id, actorUserId, actorEmail, action, entityType, entityId, oldValue, newValue, createdAt)
          VALUES (?, NULL, ?, 'enfin_pricing_revert', 'ProductPricingVersion', '${PID}', ?, ?, ?)`,
    args: [
      `enfinrevqp${Date.now().toString(36)}x${Math.floor(Math.random() * 1e6).toString(36)}`,
      'jarvis-remediation',
      JSON.stringify({ deletedVersionIds: FROZEN_DELETE_IDS, deletedTierCount: tierCount, baseEffectiveToBefore: beforeState.base.effectiveToBefore, rollbackFile: rollbackPath }),
      JSON.stringify({ result: 'reverted to June-4 graph (v1 closed + 04-28 open)', versionsRemaining: 2 }),
      new Date().toISOString().replace('Z', '+00:00'),
    ],
  });
  await tx.commit();
} catch (e) {
  try { await tx.rollback(); } catch { /* closed */ }
  console.error(`✗ ABORTED, rolled back: ${e.message}`);
  process.exit(1);
}

// ── Post-verify ─────────────────────────────────────────────────────────────
let bad = 0;
const check = async (label, sql, want) => { const n = await num(db, sql); if (n !== want) { console.log(`  ✗ ${label}: ${n} (want ${want})`); bad++; } };
await check('product versions total', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE productId='${PID}'`, 2);
await check('product open versions', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE productId='${PID}' AND effectiveTo IS NULL`, 1);
await check('BASE is the open one', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE id='${BASE}' AND effectiveTo IS NULL`, 1);
await check('v1 stays closed', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE id='${V1}' AND effectiveTo IS NOT NULL`, 1);
await check('degenerate same-day windows', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE productId='${PID}' AND effectiveFrom=effectiveTo`, 0);
await check('orphan tiers from deleted versions', `SELECT COUNT(*) AS n FROM ProductPricingTier WHERE versionId IN (${inc})`, 0);
if (norm(await tiersOf(db, BASE)) !== norm(BASELINE_TIERS)) { console.log('  ✗ BASE tiers changed post-revert'); bad++; }
if (norm(await tiersOf(db, V1)) !== norm(BASELINE_V1_TIERS)) { console.log('  ✗ v1 tiers changed post-revert'); bad++; }
const fk = (await db.execute('PRAGMA foreign_key_check')).rows.length;
if (fk) { console.log(`  ✗ FK violations: ${fk}`); bad++; }
console.log(bad === 0 ? '\n✓ REVERT COMPLETE + VERIFIED (rollback JSON in state/backups/).' : `\n✗ ${bad} verification issue(s).`);
process.exit(bad === 0 ? 0 : 1);
