// revert-enfin-pricing-2026-06-16.mjs — Phase 2. Revert the Enfin product
// "Q.TRON BLK M G2.CI+AC 430 w/PW3" (cmojiij7a) to its PRE-KEYSTROKE state.
//
// Tonight's inline-grid bug minted 21 extra versions in ~3 min + set
// v1.effectiveTo=2026-06-07. The June-4 backup proves the pre-keystroke state
// was EXACTLY v1 (cmojiij8d, effectiveFrom 2026-04-29, effectiveTo=null) with
// the tiers frozen below. v1's tiers are unchanged (verified). 0 real projects
// reference any of the 21 tonight-versions (Project.productPricingVersionId is
// ON DELETE SET NULL, so deletes won't block — we assert zero refs ourselves).
//
// Revert = delete the 21 FROZEN tonight-versions (+ their tiers) and restore
// v1.effectiveTo=null. v1 tiers are NOT modified (asserted == baseline first).
//
// Hardened per Codex review 2026-06-16: (1) the 21 delete IDs are FROZEN and
// the in-tx set is asserted to equal them exactly; (2) the v1 baseline check is
// FULL (minKW/maxKW/closer/setter/kilo/subDealer) and re-run in-tx; (3) in-tx
// v1 assert covers productId/effectiveFrom/effectiveTo/tiers; (4) rollback JSON
// is written + verified BEFORE the write transaction; (5) AuditLog records the
// exact deleted IDs + before-state.
//
//   node scripts/revert-enfin-pricing-2026-06-16.mjs            # dry-run
//   node scripts/revert-enfin-pricing-2026-06-16.mjs --commit   # apply

import { createClient } from '@libsql/client';
import * as fs from 'node:fs';
import 'dotenv/config';

const COMMIT = process.argv.includes('--commit');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || url.startsWith('file:')) { console.error('TURSO_DATABASE_URL must point at prod.'); process.exit(1); }
const db = createClient({ url, authToken });

const ENFIN = 'cmojiij7a00000ajzdlmsfgzh';
const V1 = 'cmojiij8d00010ajz47h5xhne';
const V1_EFFECTIVE_FROM = '2026-04-29';
const V1_EXPECTED_EFFECTIVE_TO = '2026-06-07'; // set by tonight's first edit; we restore to null

// FROZEN delete set — the 21 versions created tonight (all Enfin non-v1).
const FROZEN_DELETE_IDS = [
  'cmqg0guv6000004l2k923f0rk', 'cmqg0jkxd000604l2ts9bxf58', 'cmqg0jleu000c04l24kqmav6h',
  'cmqg0jlrq000i04l2hluvp05o', 'cmqg0jq3x000o04l2vqu53u78', 'cmqg0jqub000u04l23ow4cbpb',
  'cmqg0jr42001004l27njcnh45', 'cmqg0jrdu001604l2n3yfl83x', 'cmqg0jtfm001c04l2k4s1pwo3',
  'cmqg0judm001i04l2xfd89jpb', 'cmqg0jv59001o04l27m4qjvp3', 'cmqg0jvk4001u04l2tfj7r496',
  'cmqg0kuoc002004l2qvpvz8xs', 'cmqg0kux4002604l2a169loyw', 'cmqg0kv6v002c04l2rrshe3qx',
  'cmqg0kwas002i04l2re3klhq0', 'cmqg0l0z9002o04l2bmaiqbuy', 'cmqg0l30n002u04l2oryt3bb8',
  'cmqg0l389003004l2d5v0x1uc', 'cmqg0l554003604l2slbql3e3', 'cmqg0l5h5003c04l2aaeivy8n',
];
const inc = FROZEN_DELETE_IDS.map((i) => `'${i}'`).join(',');

// Full pre-keystroke v1 tiers from the June-4 backup (authoritative).
const BASELINE_V1_TIERS = [
  { minKW: 1, maxKW: 5, closerPerW: 2.9, setterPerW: 3, kiloPerW: 2.4, subDealerPerW: null },
  { minKW: 5, maxKW: 10, closerPerW: 2.7, setterPerW: 2.8, kiloPerW: 2.1, subDealerPerW: null },
  { minKW: 10, maxKW: 13, closerPerW: 2.6, setterPerW: 2.7, kiloPerW: 2, subDealerPerW: null },
  { minKW: 13, maxKW: null, closerPerW: 2.55, setterPerW: 2.65, kiloPerW: 2, subDealerPerW: null },
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
const v1Row = async (runner) => (await runner.execute({ sql: 'SELECT id,productId,effectiveFrom,effectiveTo FROM ProductPricingVersion WHERE id=?', args: [V1] })).rows[0];

// ── Read-only preflight ─────────────────────────────────────────────────────
const failures = [];
const v1 = await v1Row(db);
if (!v1) failures.push('v1 not found');
else {
  if (v1.productId !== ENFIN) failures.push(`v1.productId ${v1.productId} != ENFIN`);
  if (v1.effectiveFrom !== V1_EFFECTIVE_FROM) failures.push(`v1.effectiveFrom ${v1.effectiveFrom} != ${V1_EFFECTIVE_FROM}`);
  if (v1.effectiveTo !== V1_EXPECTED_EFFECTIVE_TO) failures.push(`v1.effectiveTo ${v1.effectiveTo} != ${V1_EXPECTED_EFFECTIVE_TO} (unexpected state)`);
}
const v1TiersMatch = norm(await tiersOf(db, V1)) === norm(BASELINE_V1_TIERS);
if (!v1TiersMatch) failures.push('v1 tiers DO NOT match the June-4 baseline (full minKW/maxKW/closer/setter/kilo/subDealer) — manual review');

// The frozen set must equal "all Enfin non-v1 versions" exactly (no stray, none missed).
const actualNonV1 = (await db.execute(`SELECT id FROM ProductPricingVersion WHERE productId='${ENFIN}' AND id != '${V1}'`)).rows.map((r) => String(r.id)).sort();
const frozenSorted = [...FROZEN_DELETE_IDS].sort();
if (JSON.stringify(actualNonV1) !== JSON.stringify(frozenSorted)) failures.push(`frozen delete-set != current Enfin non-v1 set (frozen ${frozenSorted.length}, actual ${actualNonV1.length})`);
const realRefs = await num(db, `SELECT COUNT(*) AS n FROM Project WHERE productPricingVersionId IN (${inc})`);
if (realRefs) failures.push(`${realRefs} real projects reference a to-delete version`);
const wrongProduct = await num(db, `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE id IN (${inc}) AND productId != '${ENFIN}'`);
if (wrongProduct) failures.push(`${wrongProduct} frozen ids are not on the Enfin product`);

const tierCount = await num(db, `SELECT COUNT(*) AS n FROM ProductPricingTier WHERE versionId IN (${inc})`);
const beforeVersions = (await db.execute(`SELECT * FROM ProductPricingVersion WHERE id IN (${inc})`)).rows;
const beforeTiers = (await db.execute(`SELECT * FROM ProductPricingTier WHERE versionId IN (${inc})`)).rows;
const beforeState = { deletedVersionIds: FROZEN_DELETE_IDS, versions: beforeVersions, tiers: beforeTiers, v1: { id: V1, effectiveToBefore: v1?.effectiveTo ?? null } };

console.log(`\n══ Enfin pricing revert ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ══`);
console.log(`  v1 effectiveTo now: ${v1?.effectiveTo}  →  restore to null`);
console.log(`  v1 tiers match June-4 baseline (full): ${v1TiersMatch}`);
console.log(`  frozen delete set == current non-v1 set: ${JSON.stringify(actualNonV1) === JSON.stringify(frozenSorted)}`);
console.log(`  versions to delete: ${FROZEN_DELETE_IDS.length}  (+ ${tierCount} tiers)`);
console.log(`  real-project refs: ${realRefs}`);
console.log(`  preflight failures: ${failures.length}`);
for (const f of failures) console.log(`    ✗ ${f}`);
if (failures.length) { console.log('\n✗ ABORT — guard failed.'); process.exit(1); }
if (!COMMIT) { console.log('\n(dry-run) No changes. Re-run with --commit.'); process.exit(0); }

// ── Write + verify rollback artifact BEFORE mutating (Codex #4) ─────────────
const outDir = 'state/backups';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const rollbackPath = `${outDir}/enfin-pricing-revert-rollback-2026-06-16.json`;
fs.writeFileSync(rollbackPath, JSON.stringify(beforeState, null, 1));
const verifyBack = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
if (verifyBack.deletedVersionIds.length !== 21 || verifyBack.versions.length !== beforeVersions.length) {
  console.error('✗ rollback artifact failed to write/verify — aborting BEFORE any mutation.');
  process.exit(1);
}
console.log(`  rollback artifact written + verified: ${rollbackPath}`);

// ── Commit (single write transaction; full asserts re-run in-tx) ────────────
const tx = await db.transaction('write');
try {
  // Frozen-set identity in-tx.
  const nonV1Tx = (await tx.execute(`SELECT id FROM ProductPricingVersion WHERE productId='${ENFIN}' AND id != '${V1}'`)).rows.map((r) => String(r.id)).sort();
  if (JSON.stringify(nonV1Tx) !== JSON.stringify(frozenSorted)) throw new Error(`in-tx non-v1 set != frozen set`);
  // v1 full identity + tiers in-tx.
  const v1Tx = await v1Row(tx);
  if (!v1Tx || v1Tx.productId !== ENFIN || v1Tx.effectiveFrom !== V1_EFFECTIVE_FROM || v1Tx.effectiveTo !== V1_EXPECTED_EFFECTIVE_TO) throw new Error(`in-tx v1 identity mismatch: ${JSON.stringify(v1Tx)}`);
  if (norm(await tiersOf(tx, V1)) !== norm(BASELINE_V1_TIERS)) throw new Error('in-tx v1 tiers != baseline');
  const refTx = Number((await tx.execute(`SELECT COUNT(*) AS n FROM Project WHERE productPricingVersionId IN (${inc})`)).rows[0].n);
  if (refTx) throw new Error(`in-tx ${refTx} real project refs`);

  const del = async (label, sql, expected) => {
    const r = await tx.execute(sql);
    console.log(`  ${label}: ${r.rowsAffected}`);
    if (Number(r.rowsAffected) !== expected) throw new Error(`${label} affected ${r.rowsAffected}, expected ${expected}`);
  };
  await del('tiers', `DELETE FROM ProductPricingTier WHERE versionId IN (${inc})`, tierCount);
  await del('versions', `DELETE FROM ProductPricingVersion WHERE id IN (${inc})`, 21);
  await del('restore v1 effectiveTo=null', `UPDATE ProductPricingVersion SET effectiveTo = NULL WHERE id = '${V1}'`, 1);

  await tx.execute({
    sql: `INSERT INTO AuditLog (id, actorUserId, actorEmail, action, entityType, entityId, oldValue, newValue, createdAt)
          VALUES (?, NULL, ?, 'enfin_pricing_revert', 'ProductPricingVersion', '${ENFIN}', ?, ?, ?)`,
    args: [
      `enfinrev${Date.now().toString(36)}x${Math.floor(Math.random() * 1e6).toString(36)}`,
      'jarvis-remediation',
      JSON.stringify({ deletedVersionIds: FROZEN_DELETE_IDS, deletedTierCount: tierCount, v1EffectiveToBefore: beforeState.v1.effectiveToBefore, rollbackFile: rollbackPath }),
      JSON.stringify({ result: 'reverted to v1 (effectiveTo=null)', enfinVersionsRemaining: 1 }),
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
await check('Enfin versions total', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE productId='${ENFIN}'`, 1);
await check('Enfin active versions', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE productId='${ENFIN}' AND effectiveTo IS NULL`, 1);
await check('v1 is the active one', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE id='${V1}' AND effectiveTo IS NULL`, 1);
await check('degenerate windows', `SELECT COUNT(*) AS n FROM ProductPricingVersion WHERE productId='${ENFIN}' AND effectiveFrom=effectiveTo`, 0);
await check('orphan tiers from deleted versions', `SELECT COUNT(*) AS n FROM ProductPricingTier WHERE versionId IN (${inc})`, 0);
if (norm(await tiersOf(db, V1)) !== norm(BASELINE_V1_TIERS)) { console.log('  ✗ v1 tiers changed post-revert'); bad++; }
const fk = (await db.execute('PRAGMA foreign_key_check')).rows.length;
if (fk) { console.log(`  ✗ FK violations: ${fk}`); bad++; }
console.log(bad === 0 ? '\n✓ REVERT COMPLETE + VERIFIED (rollback JSON in state/backups/).' : `\n✗ ${bad} verification issue(s).`);
process.exit(bad === 0 ? 0 : 1);
