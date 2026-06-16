// cleanup-fake-installers-2026-06-16.mjs — Phase 1b. Remove the 3 active
// `PricingInst-*` test installers that leaked into prod from
// tests/api/reps-installers.test.ts during the 06-11 prod test bursts and show
// in every installer dropdown. (My 06-13 cleanup matched only `TieredInst-`.)
//
// One installer (cmq96cnfv) owns one test InstallerPricingVersion (1 tier),
// referenced by 0 real projects. We delete its tier + version, then the
// installers. Pattern (hardened per Codex review 2026-06-16): frozen IDs +
// ALL reference asserts re-run INSIDE the write transaction immediately before
// the deletes (FKs are ON DELETE SET NULL/CASCADE — they won't block, we
// assert ourselves; this also covers User.scopedInstallerId which has NO
// Turso FK so foreign_key_check can't catch it) + exact rowsAffected asserts +
// before-state rollback JSON + AuditLog + post-verify + rollback on mismatch.
//
//   node scripts/cleanup-fake-installers-2026-06-16.mjs            # dry-run
//   node scripts/cleanup-fake-installers-2026-06-16.mjs --commit   # delete

import { createClient } from '@libsql/client';
import * as fs from 'node:fs';
import 'dotenv/config';

const COMMIT = process.argv.includes('--commit');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || url.startsWith('file:')) { console.error('TURSO_DATABASE_URL must point at prod.'); process.exit(1); }
const db = createClient({ url, authToken });

const INSTALLER_IDS = ['cmq91ketv000av4ws2j6k6k9j', 'cmq96cnfv000azswso8jtyiav', 'cmq96dyej000a0cwseky45sbu'];
const inc = INSTALLER_IDS.map((i) => `'${i}'`).join(',');

// Every inbound reference that must be ZERO before we delete. Run as read-only
// preflight AND re-run inside the write transaction (Codex finding #1, #3, #6).
const REF_CHECKS = [
  ['Project.installerId', `SELECT COUNT(*) AS n FROM Project WHERE installerId IN (${inc})`],
  ['Project.installerPricingVersionId', `SELECT COUNT(*) AS n FROM Project WHERE installerPricingVersionId IN (SELECT id FROM InstallerPricingVersion WHERE installerId IN (${inc}))`],
  ['Project.productId', `SELECT COUNT(*) AS n FROM Project WHERE productId IN (SELECT id FROM Product WHERE installerId IN (${inc}))`],
  ['Project.productPricingVersionId', `SELECT COUNT(*) AS n FROM Project WHERE productPricingVersionId IN (SELECT id FROM ProductPricingVersion WHERE productId IN (SELECT id FROM Product WHERE installerId IN (${inc})))`],
  ['EmailDelivery.installerId', `SELECT COUNT(*) AS n FROM EmailDelivery WHERE installerId IN (${inc})`],
  ['User.scopedInstallerId', `SELECT COUNT(*) AS n FROM User WHERE scopedInstallerId IN (${inc})`],
];
// Child counts that MUST be exactly these (we only delete tiers + versions;
// any product/catalog/prepaid child means an unexpected state — abort, don't
// delete un-exported rows). (Codex finding #2.)
const CHILD_ZERO = [
  ['Product', `SELECT COUNT(*) AS n FROM Product WHERE installerId IN (${inc})`],
  ['InstallerPrepaidOption', `SELECT COUNT(*) AS n FROM InstallerPrepaidOption WHERE installerId IN (${inc})`],
  ['ProductCatalogConfig', `SELECT COUNT(*) AS n FROM ProductCatalogConfig WHERE installerId IN (${inc})`],
];

const num = async (runner, sql) => Number((await runner.execute(sql)).rows[0].n);

// ── Read-only preflight ─────────────────────────────────────────────────────
const failures = [];
// Tightened signature (Codex #5): exact frozen IDs, PricingInst- name, active, non-catalog.
const sig = await num(db, `SELECT COUNT(*) AS n FROM Installer WHERE id IN (${inc}) AND name LIKE 'PricingInst-%' AND active = 1 AND usesProductCatalog = 0`);
if (sig !== 3) failures.push(`signature check: ${sig}/3 match (PricingInst-, active, non-catalog)`);
for (const [label, sql] of REF_CHECKS) { const c = await num(db, sql).catch((e) => { failures.push(`${label}: ${e.message}`); return 0; }); if (c) failures.push(`${label}: ${c} REAL references`); }
for (const [label, sql] of CHILD_ZERO) { const c = await num(db, sql); if (c) failures.push(`${label}: ${c} child rows present (expected 0) — aborting`); }

const tierCount = await num(db, `SELECT COUNT(*) AS n FROM InstallerPricingTier WHERE versionId IN (SELECT id FROM InstallerPricingVersion WHERE installerId IN (${inc}))`);
const versionCount = await num(db, `SELECT COUNT(*) AS n FROM InstallerPricingVersion WHERE installerId IN (${inc})`);

// Before-state export — everything we will delete (Codex #2: complete).
const beforeInstallers = (await db.execute(`SELECT * FROM Installer WHERE id IN (${inc})`)).rows;
const beforeVersions = (await db.execute(`SELECT * FROM InstallerPricingVersion WHERE installerId IN (${inc})`)).rows;
const beforeTiers = (await db.execute(`SELECT * FROM InstallerPricingTier WHERE versionId IN (SELECT id FROM InstallerPricingVersion WHERE installerId IN (${inc}))`)).rows;

console.log(`\n══ Fake-installer cleanup ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ══`);
console.log(`  installers ${INSTALLER_IDS.length} · versions ${versionCount} · tiers ${tierCount}`);
console.log(`  preflight failures: ${failures.length}`);
for (const f of failures) console.log(`    ✗ ${f}`);
if (failures.length) { console.log('\n✗ ABORT — guard failed.'); process.exit(1); }
if (!COMMIT) { console.log('\n(dry-run) No deletes. Re-run with --commit.'); process.exit(0); }

// ── Commit (single write transaction; ALL asserts re-run in-tx) ─────────────
const tx = await db.transaction('write');
try {
  // Re-assert signature + every reference + child-zero INSIDE the tx, right
  // before deleting, to close the preflight→write race (Codex #1).
  const sigTx = Number((await tx.execute(`SELECT COUNT(*) AS n FROM Installer WHERE id IN (${inc}) AND name LIKE 'PricingInst-%' AND active = 1 AND usesProductCatalog = 0`)).rows[0].n);
  if (sigTx !== 3) throw new Error(`in-tx signature ${sigTx}/3`);
  for (const [label, sql] of [...REF_CHECKS, ...CHILD_ZERO]) {
    const c = Number((await tx.execute(sql)).rows[0].n);
    if (c) throw new Error(`in-tx ${label} = ${c} (expected 0) — rolling back`);
  }
  const del = async (label, sql, expected) => {
    const r = await tx.execute(sql);
    console.log(`  ${label}: ${r.rowsAffected}`);
    if (Number(r.rowsAffected) !== expected) throw new Error(`${label} deleted ${r.rowsAffected}, expected ${expected}`);
  };
  await del('tiers', `DELETE FROM InstallerPricingTier WHERE versionId IN (SELECT id FROM InstallerPricingVersion WHERE installerId IN (${inc}))`, tierCount);
  await del('versions', `DELETE FROM InstallerPricingVersion WHERE installerId IN (${inc})`, versionCount);
  await del('installers', `DELETE FROM Installer WHERE id IN (${inc}) AND name LIKE 'PricingInst-%'`, 3);
  await tx.execute({
    sql: `INSERT INTO AuditLog (id, actorUserId, actorEmail, action, entityType, entityId, newValue, createdAt)
          VALUES (?, NULL, ?, 'fake_installer_cleanup', 'Installer', 'phase1b-2026-06-16', ?, ?)`,
    args: [
      `fakeinst${Date.now().toString(36)}x${Math.floor(Math.random() * 1e6).toString(36)}`,
      'jarvis-remediation',
      JSON.stringify({ installers: beforeInstallers, versions: beforeVersions, tiers: beforeTiers }),
      new Date().toISOString().replace('Z', '+00:00'),
    ],
  });
  await tx.commit();
} catch (e) {
  try { await tx.rollback(); } catch { /* closed */ }
  console.error(`✗ ABORTED, rolled back: ${e.message}`);
  process.exit(1);
}

const outDir = 'state/backups';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/fake-installers-rollback-2026-06-16.json`, JSON.stringify({ installers: beforeInstallers, versions: beforeVersions, tiers: beforeTiers }, null, 1));

// ── Post-verify (Codex #6: incl. SET-NULL-invisible refs) ───────────────────
let bad = 0;
const check = async (label, sql, want = 0) => { const n = await num(db, sql); if (n !== want) { console.log(`  ✗ ${label}: ${n} (want ${want})`); bad++; } };
await check('target installers remain', `SELECT COUNT(*) AS n FROM Installer WHERE id IN (${inc})`);
await check('any PricingInst- remain', `SELECT COUNT(*) AS n FROM Installer WHERE name LIKE 'PricingInst-%'`);
await check('users scoped to deleted installers', `SELECT COUNT(*) AS n FROM User WHERE scopedInstallerId IN (${inc})`);
const fk = (await db.execute('PRAGMA foreign_key_check')).rows.length;
if (fk !== 0) { console.log(`  ✗ FK violations: ${fk}`); bad++; }
console.log(bad === 0 ? '\n✓ CLEANUP COMPLETE + VERIFIED (rollback JSON in state/backups/).' : `\n✗ ${bad} verification issue(s).`);
process.exit(bad === 0 ? 0 : 1);
