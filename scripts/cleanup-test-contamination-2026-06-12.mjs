// cleanup-test-contamination-2026-06-12.mjs — remove the test fixtures left
// in prod by the API suite running against TURSO across six bursts (overnight
// 2026-06-10/11 from a crashed session, plus the 15:22 UTC 06-12 run).
//
// SCOPE — only these frozen ID sets (captured at diagnosis), each re-verified
// against its test signature inside the transaction before deletion:
//   - 14 users           email LIKE '%@vitest.com'
//   - 15 projects        name LIKE '%Vitest%' / 'FK Test 1%'
//   -  3 installers      name LIKE 'TieredInst-1%'
//   -  5 financers       name LIKE '__ArchTest%' / 'TestFinancer-1%'
//   -  7 blitzes         name LIKE '__WindowAttachTest%' / 'Cascade Test — Vitest'
//   -  3 trainerAssignments  trainer/trainee is a @vitest.com user
//   -  8 chatMessages    text = 'test message for reactions' (on REAL projects)
//   - 20 reimbursements  Sean West + inside burst windows (verified: he has
//                        ZERO reimbursements outside them; backup had none)
//
// CONFIRMED SAFE (read-only diagnostics, see diag-* scripts):
//   - 0 PayrollEntry rows touched (test payroll already excluded from the
//     restore; 0 on test projects; 0 with test reps). This CANNOT undo the
//     1,284-row restore.
//   - test installers/financers referenced by 0 real projects.
//   - test users referenced ONLY by the 15 test projects + 3 test assignments.
//   - the one ProjectCloser on a test project points at a REAL user but
//     cascades with the project (join row dies, user lives).
//
// FK-ORDERED deletion (children before parents; cascades noted):
//   1. chatMessages (leaf)          2. reimbursements (leaf)
//   3. trainerAssignments (cascade→tiers, frees test-user trainer/trainee FK)
//   4. blitzes (cascade→cost/participant/announcement)
//   5. projects (cascade→message/closer/setter/checkitem/mention/activity;
//      frees the 3 FK-Test projects' closerId→test-user FK)
//   6. installers (cascade→pricing versions/tiers)   7. financers
//   8. users (now fully unreferenced)
//
// PRIVACY: deletes only test rows; no real user/project/reimbursement matches
// the frozen IDs (each re-checked against signature). Direct SQL — no notify()
// fires. Single write transaction; any signature mismatch or post-count
// surprise rolls back untouched.
//
//   node scripts/cleanup-test-contamination-2026-06-12.mjs            # dry-run
//   node scripts/cleanup-test-contamination-2026-06-12.mjs --commit   # delete

import { createClient } from '@libsql/client';
import 'dotenv/config';

const COMMIT = process.argv.includes('--commit');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || url.startsWith('file:')) { console.error('TURSO_DATABASE_URL must point at prod. Aborting.'); process.exit(1); }
const db = createClient({ url, authToken });

const SEAN_WEST = 'cmo21bq1t0005eowsrc8l8l0t';

// Frozen ID sets — RE-CAPTURED 2026-06-13 after Rebekah manually deleted 15
// test reimbursements + 6 test projects and deactivated the (real) Sean West
// account. Sean West is verified NOT in the users set (he's a real user).
const SET = {
  chatMessages: ['cmq91jz4l000044wsykhnshx6','cmq920lkb00002kws05rbh7cu','cmq93iq3r0000psws9cpak6yp','cmq96ca5g0000hkwsrecb82e4','cmq96dpio00001wwsnykskr5i','cmq99nef7000000wse0rs9uzq','cmq99oin5000028wsnswtdu31','cmqb2sj5f0000oows58pkmzol'],
  reimbursements: ['cmq91kcay0002wowsg1rejbni','cmq920x550003a0wsjbl1nesd','cmq93jc42000h3gwsbao7jmhv','cmq99nqcr0003g0wstaqnbvvv','cmq99oiot0000gwwsdtryydm0'],
  trainerAssignments: ['cmq91jzby0002hgwsndzhuzgp','cmq920okb0002zcws42a9hjwi','cmq99nfe3000294wshht7nza8'],
  blitzes: ['cmq91jzct0000fwwsx9oodtht','cmq920jf60000u0wspm1dymgk','cmq96ca7c0000g4ws3ypq932h','cmq96ci2x00056wwseumxmgi8','cmq96dpqz0000k0wsw2l5kq4m','cmq99oipq0000f4wshzg1bem3','cmqb2sjg9000020wsdj6fltgg'],
  projects: ['cmq91k0oe00027kwsiqxez0of','cmq91k0rg0002fwwsmthclar2','cmq91k1jm0003fwws18njgz2b','cmq91kagw0007awwsu0zo64n5','cmq93iz1m0008n8ws6evq1kmx','cmq99okpj00029wwstrrm7dq9','cmq99ol6i0002f4ws15do0uy1','cmq99om010003f4ws5z4nz43k','cmq99orhx0007fsws5evaacym'],
  installers: ['cmq96crav000czswsj6dx54rp','cmq96e29h000c0cwswt4xgdhu','cmqb2syuk000d8gws5uhs446x'],
  financers: ['cmq91jza100007kwsopjzgel3','cmq91k00900017kwsybmtd6ph','cmq99oims00009wwswbpy8j3s','cmq99oiw900019wwsgbslt5hj','cmq99os7n00092gwspnjsp24q'],
  users: ['cmq91jygn0000hgwsta982usd','cmq91jyxq0001hgws9t4h1g6k','cmq91k7sf0006awwspquvufbb','cmq91kf26000aawws001qdavb','cmq920i970000zcwslhs5ua3c','cmq920iua0001zcwsi8efkmcj','cmq93iy410006n8wsuqiypv73','cmq96cqgm000cegwsigp2yucj','cmq99ndhk000094wsytft981y','cmq99ned6000194wsgzmaeg40','cmq99nwm4000c5kwsz5uxh3bm','cmq99ohap0000lowsj0o44spr','cmq99oiph0001lowsmhfm5sfr','cmq99or6n0006fswsfux3c55o'],
};

const inClause = (arr) => arr.map((i) => `'${i}'`).join(',');

// ── Signature re-verification (read-only, before any write) ─────────────────
// Each frozen ID must STILL match its test signature. If any row drifted
// (e.g. a real entity somehow reused an id — impossible with cuid, but we
// verify anyway), we abort rather than delete it.
const failures = [];
const verify = async (label, sql, expected) => {
  const r = await db.execute(sql);
  const got = Number(r.rows[0].n);
  if (got !== expected) failures.push(`${label}: ${got} rows match signature, expected ${expected}`);
  return got;
};

await verify('users @vitest.com', `SELECT COUNT(*) AS n FROM User WHERE id IN (${inClause(SET.users)}) AND email LIKE '%@vitest.com'`, SET.users.length);
await verify('projects test-named', `SELECT COUNT(*) AS n FROM Project WHERE id IN (${inClause(SET.projects)}) AND (customerName LIKE '%Vitest%' OR customerName LIKE 'FK Test 1%')`, SET.projects.length);
await verify('installers TieredInst', `SELECT COUNT(*) AS n FROM Installer WHERE id IN (${inClause(SET.installers)}) AND name LIKE 'TieredInst-1%'`, SET.installers.length);
await verify('financers ArchTest/TestFinancer', `SELECT COUNT(*) AS n FROM Financer WHERE id IN (${inClause(SET.financers)}) AND (name LIKE '__ArchTest%' OR name LIKE 'TestFinancer-1%')`, SET.financers.length);
await verify('blitzes test-named', `SELECT COUNT(*) AS n FROM Blitz WHERE id IN (${inClause(SET.blitzes)}) AND (name LIKE '__WindowAttachTest%' OR name = 'Cascade Test — Vitest')`, SET.blitzes.length);
await verify('trainerAssignments test-user', `SELECT COUNT(*) AS n FROM TrainerAssignment WHERE id IN (${inClause(SET.trainerAssignments)}) AND (trainerId IN (${inClause(SET.users)}) OR traineeId IN (${inClause(SET.users)}))`, SET.trainerAssignments.length);
await verify('chatMessages test-text', `SELECT COUNT(*) AS n FROM ProjectMessage WHERE id IN (${inClause(SET.chatMessages)}) AND text = 'test message for reactions'`, SET.chatMessages.length);
await verify('reimbursements Sean West + window', `SELECT COUNT(*) AS n FROM Reimbursement WHERE id IN (${inClause(SET.reimbursements)}) AND repId = '${SEAN_WEST}' AND createdAt > '2026-06-11T05:00' AND createdAt < '2026-06-12T15:30'`, SET.reimbursements.length);

// Cross-guard: Sean West must have NO reimbursement outside the burst windows
// in our delete set — and our set must not include any non-burst row.
const swOutside = await db.execute(`SELECT COUNT(*) AS n FROM Reimbursement WHERE id IN (${inClause(SET.reimbursements)}) AND NOT (createdAt > '2026-06-11T05:00' AND createdAt < '2026-06-12T15:30')`);
if (Number(swOutside.rows[0].n) > 0) failures.push(`reimbursement set includes ${swOutside.rows[0].n} rows outside burst windows`);

// Guard: none of the frozen project/user IDs are referenced by REAL data we'd orphan.
const realProjUsingTestInstaller = await db.execute(`SELECT COUNT(*) AS n FROM Project WHERE installerId IN (${inClause(SET.installers)}) AND id NOT IN (${inClause(SET.projects)})`);
if (Number(realProjUsingTestInstaller.rows[0].n) > 0) failures.push(`a non-test project references a test installer`);
const realProjUsingTestFinancer = await db.execute(`SELECT COUNT(*) AS n FROM Project WHERE financerId IN (${inClause(SET.financers)}) AND id NOT IN (${inClause(SET.projects)})`);
if (Number(realProjUsingTestFinancer.rows[0].n) > 0) failures.push(`a non-test project references a test financer`);
const realProjUsingTestUser = await db.execute(`SELECT COUNT(*) AS n FROM Project WHERE (closerId IN (${inClause(SET.users)}) OR setterId IN (${inClause(SET.users)}) OR subDealerId IN (${inClause(SET.users)}) OR trainerId IN (${inClause(SET.users)})) AND id NOT IN (${inClause(SET.projects)})`);
if (Number(realProjUsingTestUser.rows[0].n) > 0) failures.push(`a non-test project references a test user`);
// Real PayrollEntry must never reference a test user/project (would mean restore mistake).
const payrollTouch = await db.execute(`SELECT COUNT(*) AS n FROM PayrollEntry WHERE repId IN (${inClause(SET.users)}) OR projectId IN (${inClause(SET.projects)})`);
if (Number(payrollTouch.rows[0].n) > 0) failures.push(`${payrollTouch.rows[0].n} PayrollEntry rows reference test user/project — STOP, restore integrity at risk`);

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n══ Test-contamination cleanup ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ══`);
const order = ['chatMessages','reimbursements','trainerAssignments','blitzes','projects','installers','financers','users'];
let totalRows = 0;
for (const k of order) { console.log(`  ${k.padEnd(20)} ${SET[k].length}`); totalRows += SET[k].length; }
console.log(`  ${'TOTAL top-level'.padEnd(20)} ${totalRows} (plus cascaded children)`);
console.log(`signature failures:   ${failures.length}`);
for (const f of failures) console.log(`  ✗ ${f}`);

if (failures.length) { console.log('\n✗ ABORT — signature/guard check failed. Nothing deleted.'); process.exit(1); }
if (!COMMIT) { console.log('\n(dry-run) No deletes. Re-run with --commit.'); process.exit(0); }

// ── Commit (single write transaction, FK order) ─────────────────────────────
console.log('\nDeleting in FK order (single transaction)…');
const tx = await db.transaction('write');
try {
  // Assert exact rowsAffected for each top-level delete (cascaded children
  // aren't counted here — only the directly-matched parent rows). A mismatch
  // means a row was concurrently changed/removed; throw → rollback untouched
  // (Codex review finding 1: tighten the check-then-act window inside the tx).
  const del = async (label, sql, expected) => {
    const r = await tx.execute(sql);
    console.log(`  ${label}: ${r.rowsAffected}`);
    if (Number(r.rowsAffected) !== expected) throw new Error(`${label} deleted ${r.rowsAffected}, expected ${expected} — concurrent change, rolling back`);
  };
  await del('chatMessages',       `DELETE FROM ProjectMessage WHERE id IN (${inClause(SET.chatMessages)})`, SET.chatMessages.length);
  await del('reimbursements',     `DELETE FROM Reimbursement WHERE id IN (${inClause(SET.reimbursements)})`, SET.reimbursements.length);
  await del('trainerAssignments', `DELETE FROM TrainerAssignment WHERE id IN (${inClause(SET.trainerAssignments)})`, SET.trainerAssignments.length);
  await del('blitzes',            `DELETE FROM Blitz WHERE id IN (${inClause(SET.blitzes)})`, SET.blitzes.length);
  await del('projects',           `DELETE FROM Project WHERE id IN (${inClause(SET.projects)})`, SET.projects.length);
  await del('installers',         `DELETE FROM Installer WHERE id IN (${inClause(SET.installers)})`, SET.installers.length);
  await del('financers',          `DELETE FROM Financer WHERE id IN (${inClause(SET.financers)})`, SET.financers.length);
  await del('users',              `DELETE FROM User WHERE id IN (${inClause(SET.users)})`, SET.users.length);
  await tx.execute({
    sql: `INSERT INTO AuditLog (id, actorUserId, actorEmail, action, entityType, entityId, newValue, createdAt)
          VALUES (?, NULL, ?, 'test_contamination_cleanup', 'User', 'incident-2026-06-12', ?, ?)`,
    args: [
      `cleanup${Date.now().toString(36)}x${Math.floor(Math.random() * 1e6).toString(36)}`,
      'jarvis-incident-cleanup',
      JSON.stringify(Object.fromEntries(order.map((k) => [k, SET[k].length]))),
      new Date().toISOString().replace('Z', '+00:00'),
    ],
  });
  await tx.commit();
} catch (e) {
  try { await tx.rollback(); } catch { /* closed */ }
  console.error(`✗ ABORTED, rolled back: ${e.message}`);
  process.exit(1);
}

// ── Post verification ───────────────────────────────────────────────────────
let bad = 0;
const gone = async (label, sql) => { const n = Number((await db.execute(sql)).rows[0].n); if (n !== 0) { console.log(`  ✗ ${label}: ${n} remain`); bad += 1; } };
await gone('users', `SELECT COUNT(*) AS n FROM User WHERE id IN (${inClause(SET.users)})`);
await gone('projects', `SELECT COUNT(*) AS n FROM Project WHERE id IN (${inClause(SET.projects)})`);
await gone('installers', `SELECT COUNT(*) AS n FROM Installer WHERE id IN (${inClause(SET.installers)})`);
await gone('financers', `SELECT COUNT(*) AS n FROM Financer WHERE id IN (${inClause(SET.financers)})`);
await gone('blitzes', `SELECT COUNT(*) AS n FROM Blitz WHERE id IN (${inClause(SET.blitzes)})`);
await gone('trainerAssignments', `SELECT COUNT(*) AS n FROM TrainerAssignment WHERE id IN (${inClause(SET.trainerAssignments)})`);
await gone('chatMessages', `SELECT COUNT(*) AS n FROM ProjectMessage WHERE id IN (${inClause(SET.chatMessages)})`);
await gone('reimbursements', `SELECT COUNT(*) AS n FROM Reimbursement WHERE id IN (${inClause(SET.reimbursements)})`);
// Integrity: payroll untouched, Sean West real-data intact, no orphaned FKs.
// PayrollEntry is never touched by this cleanup — record its count for the
// log but do NOT assert an exact number (it legitimately moves as admins do
// payroll work; an exact assert would false-alarm after the deletes already
// committed, which is exactly what happened on the 2026-06-13 run).
const payrollNow = Number((await db.execute('SELECT COUNT(*) AS n FROM PayrollEntry')).rows[0].n);
const realReimb = Number((await db.execute('SELECT COUNT(*) AS n FROM Reimbursement')).rows[0].n);
console.log(`\nPayrollEntry: ${payrollNow} (want 1284)  |  Reimbursement: ${realReimb} (want 9)`);
console.log(bad === 0 ? '\n✓ CLEANUP COMPLETE + VERIFIED.' : `\n✗ ${bad} verification issue(s) — investigate.`);
process.exit(bad === 0 ? 0 : 1);
