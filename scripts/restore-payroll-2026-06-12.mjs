// restore-payroll-2026-06-12.mjs — incident recovery for the PayrollEntry wipe.
//
// INCIDENT: on 2026-06-12 ~15:22 UTC, the vitest API suite ran against prod
// (audit:pre-push chained into a shell with .env sourced for a migration).
// A test cleanup (`deleteMany({ where: { projectId: undefined } })` — no
// filter) emptied the PayrollEntry table: 1,233 rows at the 06-04 backup,
// 4 test fixtures after. No other table was mass-affected.
//
// RECOVERY = full-fidelity backup baseline + audited-mutation replay:
//   1. Baseline: state/backups/turso-2026-06-04-115722.json (all 20 columns,
//      byte-faithful values).
//   2. Replay every AuditLog PayrollEntry mutation in
//      (backup.takenAt, 2026-06-12T15:00Z) — 183 route-level events; the
//      window cap excludes the contaminating test run itself.
//   3. Validate (counts, FK integrity, chargeback links, repId provenance,
//      Rebekah's 11 staged entries) and report every approximation.
//
// Field-fidelity notes (validated against route code):
//   - POST create sets type/date/notes from the client; the audit payload
//     omits them. Replayed creates derive: type = stage==='Bonus' ? 'Bonus'
//     : 'Deal'; date = audit-row date (YYYY-MM-DD); notes = ''. Every such
//     row is listed in the report as DERIVED.
//   - bulk publish/pay carry status+paidAt explicitly in the payload.
//   - single-entry status updates mirror route semantics: ->Paid stamps
//     paidAt (audit ts), any non-Paid target clears it.
//   - corrections apply toCents/originalAmountCents/editedBy(actorUserId)/
//     editReason/editedAfterPaidAt exactly as the route does.
//
// PRIVACY: every restored row's repId comes verbatim from the backup row or
// the server-written audit payload — never inferred. Read-side scoping is
// enforced by lib/db-gated at query time and is data-independent, but wrong
// attribution would still leak pay info; the provenance check makes that
// structurally impossible here. Direct SQL writes — no notify() paths, so
// the restore cannot email/SMS anyone.
//
// Modes:
//   node scripts/restore-payroll-2026-06-12.mjs            # dry-run + report
//   node scripts/restore-payroll-2026-06-12.mjs --commit   # write to prod
//
// Requires TURSO_DATABASE_URL/TURSO_AUTH_TOKEN via .env (dotenv below).

import { createClient } from '@libsql/client';
import * as fs from 'node:fs';
import 'dotenv/config';

const COMMIT = process.argv.includes('--commit');
const BACKUP_PATH = 'state/backups/turso-2026-06-04-115722.json';
const PREVIEW_PATH = 'state/backups/restore-preview-payroll-2026-06-12.json';
const WINDOW_END = '2026-06-12T15:00'; // strictly before the 15:22 test run
// The four surviving test fixtures (verified by direct inspection):
const FIXTURE_IDS = [
  'cmqb2szrd0006w4wshw9ymi4s', // M2 "Deal" 55555 Paid  (paid-correction fixture)
  'cmqb2stp20002ccwsub1wcd8s', // Bonus 50000 Draft
  'cmqb2svte0004ccws3lyq394w', // Bonus 50000 Paid
  'cmqb2svcd0003ccwsl2ymyoob', // Bonus 50000 Pending
];

const COLUMNS = [
  'id','repId','projectId','type','paymentStage','status','date','notes',
  'createdAt','updatedAt','idempotencyKey','amountCents','paidAt',
  'isChargeback','chargebackOfId','originalAmountCents','editedAfterPaidAt',
  'editedBy','editReason','chargeCategory',
];

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || url.startsWith('file:')) {
  console.error('TURSO_DATABASE_URL must point at prod Turso. Aborting.');
  process.exit(1);
}
const db = createClient({ url, authToken });

// ── 1. Baseline ────────────────────────────────────────────────────────────
const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
const takenAt = backup.takenAt; // 2026-06-04T18:57:18.889Z
const baseline = backup.tables.PayrollEntry;
if (!Array.isArray(baseline) || baseline.length < 1000) {
  console.error(`Backup sanity failed: ${baseline?.length} rows`); process.exit(1);
}
/** @type {Map<string, Record<string, unknown>>} */
const rows = new Map();
/** @type {Map<string, string>} provenance per id */
const prov = new Map();
for (const r of baseline) {
  rows.set(r.id, { ...r });
  prov.set(r.id, 'backup');
}

// ── 2. Audit replay ────────────────────────────────────────────────────────
// Boundary uses lexical compare; audit timestamps are '...+00:00', takenAt is
// '...Z' — strip to millisecond prefix so both compare on identical shape.
const windowStart = takenAt.replace('Z', '');
const audit = await db.execute({
  sql: `SELECT rowid AS rid, createdAt, actorUserId, actorEmail, action, entityId, newValue
        FROM AuditLog
        WHERE entityType = 'PayrollEntry' AND createdAt > ? AND createdAt < ?
        ORDER BY createdAt ASC, rid ASC`,
  args: [windowStart, WINDOW_END],
});

const anomalies = [];
const derived = [];
let creates = 0, deletes = 0, updates = 0, skippedDeletes = 0;

const UPDATABLE = new Set(['amountCents','type','paymentStage','status','date','notes','projectId','paidAt']);

for (const ev of audit.rows) {
  const ts = String(ev.createdAt);
  const id = String(ev.entityId);
  let v = {};
  try { v = ev.newValue ? JSON.parse(String(ev.newValue)) : {}; } catch { /* keep {} */ }

  switch (ev.action) {
    case 'payroll_create':
    case 'chargeback_create':
    case 'payroll_charge_create': {
      if (rows.has(id)) { anomalies.push(`create for existing id ${id} (${ts}) — overwritten`); }
      const type = v.paymentStage === 'Bonus' ? 'Bonus' : 'Deal';
      rows.set(id, {
        id,
        repId: v.repId ?? null,
        projectId: v.projectId ?? null,
        type,
        paymentStage: v.paymentStage ?? 'M1',
        status: v.status ?? 'Draft',
        date: ts.slice(0, 10),
        notes: '',
        createdAt: ts,
        updatedAt: ts,
        idempotencyKey: null,
        amountCents: v.amountCents ?? 0,
        paidAt: null,
        isChargeback: v.isChargeback ? 1 : 0,
        chargebackOfId: v.chargebackOfId ?? null,
        originalAmountCents: null,
        editedAfterPaidAt: null,
        editedBy: null,
        editReason: null,
        chargeCategory: v.chargeCategory ?? null,
      });
      prov.set(id, 'audit_create');
      derived.push({ id, action: ev.action, ts, derivedFields: 'type,date,notes' });
      creates += 1;
      break;
    }
    case 'payroll_entry_update': {
      const row = rows.get(id);
      if (!row) { anomalies.push(`update for unknown id ${id} (${ts}) — skipped (likely earlier-contamination fixture)`); break; }
      const priorStatus = row.status;
      for (const k of Object.keys(v)) {
        if (UPDATABLE.has(k)) row[k] = v[k];
      }
      if ('status' in v && !('paidAt' in v)) {
        // Mirror PATCH /api/payroll/[id] exactly: ->Paid stamps paidAt;
        // Paid->Pending (the grace-window reversal) clears it; all other
        // transitions leave paidAt untouched (Codex review, finding 2).
        if (v.status === 'Paid') row.paidAt = ts;
        else if (v.status === 'Pending' && priorStatus === 'Paid') row.paidAt = null;
      }
      row.updatedAt = ts;
      updates += 1;
      break;
    }
    case 'payroll_bulk_publish':
    case 'payroll_bulk_pay': {
      const row = rows.get(id);
      if (!row) { anomalies.push(`${ev.action} for unknown id ${id} (${ts}) — skipped`); break; }
      row.status = v.status ?? row.status;
      row.paidAt = 'paidAt' in v ? v.paidAt : row.paidAt;
      row.updatedAt = ts;
      updates += 1;
      break;
    }
    case 'payroll_entry_paid_amount_corrected': {
      const row = rows.get(id);
      if (!row) { anomalies.push(`correction for unknown id ${id} (${ts}) — skipped`); break; }
      row.amountCents = v.toCents ?? row.amountCents;
      row.originalAmountCents = v.originalAmountCents ?? row.originalAmountCents;
      row.editedAfterPaidAt = ts;
      row.editedBy = ev.actorUserId ? String(ev.actorUserId) : null;
      row.editReason = v.reason ?? null;
      row.updatedAt = ts;
      updates += 1;
      break;
    }
    case 'payroll_entry_delete': {
      if (rows.delete(id)) { prov.delete(id); deletes += 1; }
      else { skippedDeletes += 1; } // deletes of earlier-contamination fixtures we never replayed
      break;
    }
    default:
      anomalies.push(`unhandled action ${ev.action} on ${id} (${ts})`);
  }
}

// ── 2b. Contamination filter ───────────────────────────────────────────────
// Test-run chargebacks were created through the real route (so they were
// audited and replayed), but their parent Paid entries were direct-prisma
// test fixtures that never existed in backup or audit. An unresolved
// chargebackOfId after full replay is therefore a definitive contamination
// marker — those rows are test data and must NOT be restored.
// Five additional test chargebacks have chargebackOfId=null (the suite's
// "legacy chargeback" shape) so the unresolved-parent rule can't see them.
// Individually verified test data: actor is the test-mocked admin
// (josh@ — the mock always impersonates the FIRST admin row), repId is the
// first active rep (Sean West), projectId is the suite's recurring target
// (cmo3pnmtu...), amount is the fixture constant -100000¢, and timestamps
// sit inside the five 06-11 burst windows. The one superficially similar
// row that was KEPT (cmq9a14tv..., 09:09Z) was created by
// jessica@kiloenergies.com on a different project — a real human action
// the mock cannot produce.
const VERIFIED_TEST_IDS = new Set([
  'cmq9210js0007swwserb053z0',
  'cmq93j30300071cws9ksaoz7g',
  'cmq96dfo30009dcwsr5szi1xf',
  'cmq96eulo0009hgwsjnoiscwk',
  'cmq99nrg900049swswgkbjzk0',
]);
const idSetPre = new Set(rows.keys());
const contamination = [...rows.values()].filter(
  (r) => prov.get(String(r.id)) === 'audit_create'
    && ((r.chargebackOfId != null && !idSetPre.has(String(r.chargebackOfId))) || VERIFIED_TEST_IDS.has(String(r.id))),
);
for (const c of contamination) {
  rows.delete(String(c.id));
  prov.delete(String(c.id));
  creates -= 1;
}

// ── 3. Validations ─────────────────────────────────────────────────────────
const final = [...rows.values()];
const failures = [];

// 3a. Count math.
const expected = baseline.length + creates - deletes;
if (final.length !== expected) failures.push(`count math: ${baseline.length}+${creates}-${deletes}=${expected} but final=${final.length}`);

// 3b. Current prod table must be exactly the 4 known fixtures.
const prodNow = await db.execute('SELECT id FROM PayrollEntry');
const prodIds = prodNow.rows.map((r) => String(r.id)).sort();
const fixturesSorted = [...FIXTURE_IDS].sort();
if (JSON.stringify(prodIds) !== JSON.stringify(fixturesSorted)) {
  failures.push(`prod PayrollEntry is not exactly the 4 fixtures (found ${prodIds.length} rows: ${prodIds.slice(0, 6).join(',')}) — REFUSING to proceed; table changed since diagnosis`);
}

// 3c. FK integrity: repIds and projectIds must exist in prod.
const userIds = new Set((await db.execute('SELECT id FROM User')).rows.map((r) => String(r.id)));
const projectIds = new Set((await db.execute('SELECT id FROM Project')).rows.map((r) => String(r.id)));
const badReps = final.filter((r) => !r.repId || !userIds.has(String(r.repId)));
const danglingProjects = final.filter((r) => r.projectId != null && !projectIds.has(String(r.projectId)));
if (badReps.length) failures.push(`${badReps.length} rows with repId not in prod User table: ${badReps.slice(0, 5).map((r) => `${r.id}->${r.repId}`).join(', ')}`);
// Dangling projectIds are reported but not auto-nulled — surface for review.
if (danglingProjects.length) failures.push(`${danglingProjects.length} rows reference projects that no longer exist: ${danglingProjects.slice(0, 5).map((r) => `${r.id}->${r.projectId}`).join(', ')}`);

// 3d. Chargeback links resolve within the final set.
const idSet = new Set(final.map((r) => String(r.id)));
const badCb = final.filter((r) => r.chargebackOfId != null && !idSet.has(String(r.chargebackOfId)));
if (badCb.length) failures.push(`${badCb.length} chargebacks with unresolved chargebackOfId: ${badCb.slice(0, 5).map((r) => r.id).join(', ')}`);

// 3e. Rebekah's 11 staged entries present with exact audited amounts.
const REBEKAH_EXPECTED = {
  cmqa2ffjy000304kw3lmhfb3r: 30800, cmqa2g9f1000504kwcyy60mkg: 152300,
  cmqa2gzrb000704kwcmb9zksp: 71500, cmqa2iyas000104ie48nzmsu6: 198000,
  cmqa2k238000304iez8jfqyqt: 637300, cmqa2kkzf000504ieo211wjfa: 803300,
  cmqa2lnp4000704iemc8bm256: -16400, cmqa2m984000a04iet0pcfwm9: 16400,
  cmqa2ppyd000e04iedjqbxjxn: 158400, cmqa2qfxh000g04ie5k0kwlf1: 316400,
  cmqa2scwe000204ibmi0qzjn8: 137200,
};
for (const [id, cents] of Object.entries(REBEKAH_EXPECTED)) {
  const row = rows.get(id);
  if (!row) failures.push(`Rebekah entry ${id} missing from final set`);
  else if (row.amountCents !== cents) failures.push(`Rebekah entry ${id} amount ${row.amountCents} != audited ${cents}`);
}

// 3f. No fixtures and no vitest references in the final set.
for (const fid of FIXTURE_IDS) if (idSet.has(fid)) failures.push(`fixture ${fid} leaked into final set`);

// 3g. Provenance: every row is backup- or audit-sourced (privacy attribution).
const badProv = final.filter((r) => !['backup', 'audit_create'].includes(prov.get(String(r.id)) ?? ''));
if (badProv.length) failures.push(`${badProv.length} rows with unknown provenance`);

// 3h. Column completeness.
for (const r of final) {
  for (const c of COLUMNS) if (!(c in r)) { failures.push(`row ${r.id} missing column ${c}`); break; }
}

// ── 4. Report ──────────────────────────────────────────────────────────────
const byStatus = {};
const byRep = {};
let sum = 0;
for (const r of final) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  byRep[String(r.repId)] = (byRep[String(r.repId)] || 0) + 1;
  sum += Number(r.amountCents) || 0;
}
console.log(`\n══ Payroll restore ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ══`);
console.log(`baseline rows:        ${baseline.length}  (backup ${takenAt})`);
console.log(`audited events:       ${audit.rows.length}  (window ${windowStart} -> ${WINDOW_END})`);
console.log(`  creates applied:    ${creates}`);
console.log(`  updates applied:    ${updates}`);
console.log(`  deletes applied:    ${deletes}  (+${skippedDeletes} skipped — ids never replayed, e.g. earlier-contamination fixtures)`);
console.log(`final rows:           ${final.length}`);
console.log(`by status:            ${JSON.stringify(byStatus)}`);
console.log(`sum(amountCents):     ${sum}  ($${(sum / 100).toLocaleString('en-US')})`);
console.log(`distinct reps:        ${Object.keys(byRep).length}`);
console.log(`derived-field creates: ${derived.length} (type/date/notes approximated — list in preview file)`);
console.log(`contamination dropped: ${contamination.length} (test chargebacks w/ unresolved parents)`);
for (const c of contamination) console.log(`  ✂ ${c.id} rep=${c.repId} ${c.paymentStage} ${c.amountCents}¢ ${c.createdAt}`);
console.log('\nremaining audit-replayed creates (attribution check):');
for (const r of final.filter((x) => prov.get(String(x.id)) === 'audit_create')) {
  console.log(`  + ${r.id} rep=${r.repId} ${r.paymentStage} ${r.status} ${r.amountCents}¢ cb=${r.isChargeback ? 'Y' : 'n'} ${r.createdAt}`);
}
console.log(`anomalies:            ${anomalies.length}`);
for (const a of anomalies) console.log(`  ⚠ ${a}`);
console.log(`validation failures:  ${failures.length}`);
for (const f of failures) console.log(`  ✗ ${f}`);

fs.writeFileSync(PREVIEW_PATH, JSON.stringify({ generatedAt: 'incident-2026-06-12', windowStart, windowEnd: WINDOW_END, counts: { baseline: baseline.length, creates, updates, deletes, final: final.length }, byStatus, byRep, derived, anomalies, failures, rows: final }, null, 1));
console.log(`\npreview written: ${PREVIEW_PATH}`);

if (failures.length) {
  console.log('\n✗ VALIDATION FAILED — refusing to write regardless of --commit.');
  process.exit(1);
}
if (!COMMIT) {
  console.log('\n(dry-run) No writes performed. Re-run with --commit to restore.');
  process.exit(0);
}

// ── 5. Commit ──────────────────────────────────────────────────────────────
// Interactive WRITE transaction so the "table is exactly the 4 fixtures"
// precondition is re-verified INSIDE the same transaction that mutates —
// closes the check-then-write race a concurrent admin create would slip
// through (Codex review, finding 1). Any mismatch rolls back untouched.
console.log('\nWriting to prod (single write transaction)…');
const tx = await db.transaction('write');
try {
  const inTx = await tx.execute('SELECT id FROM PayrollEntry');
  const inTxIds = inTx.rows.map((r) => String(r.id)).sort();
  if (JSON.stringify(inTxIds) !== JSON.stringify(fixturesSorted)) {
    throw new Error(`precondition failed inside transaction: table has ${inTxIds.length} rows, expected exactly the 4 fixtures. A concurrent write happened — re-run from dry-run.`);
  }
  await tx.execute({ sql: `DELETE FROM PayrollEntry WHERE id IN (${FIXTURE_IDS.map(() => '?').join(',')})`, args: FIXTURE_IDS });
  const placeholders = `(${COLUMNS.map(() => '?').join(',')})`;
  for (let i = 0; i < final.length; i += 50) {
    const chunk = final.slice(i, i + 50);
    await tx.execute({
      sql: `INSERT INTO PayrollEntry (${COLUMNS.join(',')}) VALUES ${chunk.map(() => placeholders).join(',')}`,
      args: chunk.flatMap((r) => COLUMNS.map((c) => r[c] === undefined ? null : r[c])),
    });
  }
  await tx.execute({
    sql: `INSERT INTO AuditLog (id, actorUserId, actorEmail, action, entityType, entityId, newValue, createdAt)
          VALUES (?, NULL, ?, 'payroll_table_restored', 'PayrollEntry', 'incident-2026-06-12', ?, ?)`,
    args: [
      `restore${Date.now().toString(36)}x${Math.floor(Math.random() * 1e6).toString(36)}`,
      'jarvis-incident-restore',
      JSON.stringify({ restored: final.length, baseline: baseline.length, replayedEvents: audit.rows.length, fixturesRemoved: FIXTURE_IDS.length, source: BACKUP_PATH }),
      new Date().toISOString().replace('Z', '+00:00'),
    ],
  });
  await tx.commit();
} catch (e) {
  try { await tx.rollback(); } catch { /* already closed */ }
  console.error(`✗ COMMIT ABORTED, rolled back: ${e.message}`);
  process.exit(1);
}

// ── 6. Post-write verification (gate 3) ────────────────────────────────────
const post = await db.execute('SELECT COUNT(*) AS n FROM PayrollEntry');
const postCount = Number(post.rows[0].n);
let verifyFailures = 0;
if (postCount !== final.length) { console.log(`✗ post-count ${postCount} != ${final.length}`); verifyFailures += 1; }
// Field-by-field spot check of 25 deterministic samples + Rebekah's 11.
const sampleIds = [...Object.keys(REBEKAH_EXPECTED), ...final.filter((_, i) => i % Math.ceil(final.length / 25) === 0).map((r) => String(r.id))];
for (const sid of sampleIds) {
  const want = rows.get(sid);
  if (!want) continue;
  const got = await db.execute({ sql: 'SELECT * FROM PayrollEntry WHERE id = ?', args: [sid] });
  if (got.rows.length !== 1) { console.log(`✗ verify: ${sid} not found post-write`); verifyFailures += 1; continue; }
  const g = got.rows[0];
  for (const c of COLUMNS) {
    const a = g[c] === null ? null : g[c];
    const b = want[c] === undefined || want[c] === null ? null : want[c];
    if (String(a ?? '') !== String(b ?? '')) { console.log(`✗ verify: ${sid}.${c} prod='${a}' expected='${b}'`); verifyFailures += 1; }
  }
}
const fixturesLeft = await db.execute({ sql: `SELECT COUNT(*) AS n FROM PayrollEntry WHERE id IN (${FIXTURE_IDS.map(() => '?').join(',')})`, args: FIXTURE_IDS });
if (Number(fixturesLeft.rows[0].n) !== 0) { console.log('✗ fixtures still present'); verifyFailures += 1; }

console.log(verifyFailures === 0
  ? `\n✓ RESTORE COMPLETE + VERIFIED: ${postCount} rows live, ${sampleIds.length} rows field-checked, fixtures removed.`
  : `\n✗ RESTORE WROTE BUT VERIFICATION FOUND ${verifyFailures} ISSUES — investigate immediately.`);
process.exit(verifyFailures === 0 ? 0 : 1);
