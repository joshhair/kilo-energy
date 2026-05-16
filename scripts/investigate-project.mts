/**
 * One-shot read-only investigation script for a single Project.
 *
 * Pulls every signal we typically need when diagnosing "why is the
 * commission/trainer/payroll wrong on this deal?" — project row,
 * the parties' identities, every TrainerAssignment touching the
 * parties, the assignment's tier ladder, every PayrollEntry on
 * the project, prior-deal tier consumption, and recent AuditLog.
 *
 * Usage:
 *   npx tsx scripts/investigate-project.mts "Customer Name"
 *   npx tsx scripts/investigate-project.mts cmp1j0isf000004jprm6uj03r
 *
 * The first form treats the arg as a LIKE pattern on customerName
 * (case-insensitive, wrapped in % automatically). The second form
 * activates when the arg matches a CUID shape (24-char alnum starting
 * with cm) and queries by project id directly.
 *
 * Read-only — never writes. Safe to point at production. Requires
 * TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in .env.
 */

import { createClient } from '@libsql/client';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';

if (existsSync('.env')) loadDotenv({ path: '.env' });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.');
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: tsx scripts/investigate-project.mts <customerName | projectId>');
  process.exit(1);
}
const looksLikeCuid = /^cm[a-z0-9]{20,}$/i.test(arg);

const client = createClient({ url, authToken });

function line(s = ''): void { console.log(s); }
function h(s: string): void { console.log('\n=== ' + s + ' ==='); }

async function main(): Promise<void> {
  // 1. Find project(s)
  h(looksLikeCuid ? `Project: id = ${arg}` : `Project: customerName LIKE "%${arg}%"`);
  const projRes = looksLikeCuid
    ? await client.execute({
        sql: `SELECT id, customerName, phase, closerId, setterId, trainerId, trainerRate,
                     noChainTrainer, kWSize, installerId, financerId, soldDate,
                     m1Paid, m2Paid, m3Paid,
                     m1AmountCents, m2AmountCents, m3AmountCents,
                     setterM1AmountCents, setterM2AmountCents, setterM3AmountCents,
                     createdAt, updatedAt, phaseChangedAt
              FROM Project WHERE id = ?`,
        args: [arg],
      })
    : await client.execute({
        sql: `SELECT id, customerName, phase, closerId, setterId, trainerId, trainerRate,
                     noChainTrainer, kWSize, installerId, financerId, soldDate,
                     m1Paid, m2Paid, m3Paid,
                     m1AmountCents, m2AmountCents, m3AmountCents,
                     setterM1AmountCents, setterM2AmountCents, setterM3AmountCents,
                     createdAt, updatedAt, phaseChangedAt
              FROM Project WHERE customerName LIKE ? COLLATE NOCASE`,
        args: [`%${arg}%`],
      });
  if (projRes.rows.length === 0) {
    line('No project matched. (Tip: customerName search is case-insensitive LIKE %arg%.)');
    return;
  }
  if (projRes.rows.length > 1) {
    line(`${projRes.rows.length} projects matched. Showing the first; re-run with a project id (cmp...) to disambiguate.`);
    for (const r of projRes.rows) line(`  ${String(r.id)} — ${String(r.customerName)}`);
    line('');
  }
  const project = projRes.rows[0];
  for (const r of [project]) {
    line(`  id:               ${r.id}`);
    line(`  customerName:     ${r.customerName}`);
    line(`  phase:            ${r.phase}`);
    line(`  closerId:         ${r.closerId}`);
    line(`  setterId:         ${r.setterId}`);
    line(`  trainerId:        ${r.trainerId}`);
    line(`  trainerRate:      ${r.trainerRate}`);
    line(`  noChainTrainer:   ${r.noChainTrainer}`);
    line(`  kWSize:           ${r.kWSize}`);
    line(`  m1Paid/2/3:       ${r.m1Paid}/${r.m2Paid}/${r.m3Paid}`);
    line(`  closer M1/M2/M3:  $${(Number(r.m1AmountCents)/100).toFixed(2)} / $${(Number(r.m2AmountCents)/100).toFixed(2)} / ${r.m3AmountCents == null ? 'null' : '$'+(Number(r.m3AmountCents)/100).toFixed(2)}`);
    line(`  setter M1/M2/M3:  $${(Number(r.setterM1AmountCents)/100).toFixed(2)} / $${(Number(r.setterM2AmountCents)/100).toFixed(2)} / ${r.setterM3AmountCents == null ? 'null' : '$'+(Number(r.setterM3AmountCents)/100).toFixed(2)}`);
    line(`  soldDate:         ${r.soldDate}`);
    line(`  phaseChangedAt:   ${r.phaseChangedAt}`);
    line('');
  }

  const closerId = String(project.closerId);
  const setterId = project.setterId ? String(project.setterId) : null;
  const projectId = String(project.id);

  // 2. Closer + setter user identities
  h('Users on this deal');
  const userIds = [closerId];
  if (setterId) userIds.push(setterId);
  if (project.trainerId) userIds.push(String(project.trainerId));
  const usersRes = await client.execute({
    sql: `SELECT id, firstName, lastName, email, role, repType, active
          FROM User WHERE id IN (${userIds.map(() => '?').join(',')})`,
    args: userIds,
  });
  for (const r of usersRes.rows) {
    line(`  ${r.firstName} ${r.lastName} (${r.role}/${r.repType}) — id=${r.id} active=${r.active}`);
  }

  // 3. TrainerAssignment relationships touching these users
  h('TrainerAssignment rows where trainer or trainee is closer/setter/projectTrainer');
  const taRes = await client.execute({
    sql: `SELECT ta.id, ta.trainerId, ta.traineeId, ta.active, ta.isActiveTraining,
                 ta.createdAt, ta.updatedAt,
                 tr.firstName || ' ' || tr.lastName AS trainerName,
                 te.firstName || ' ' || te.lastName AS traineeName
          FROM TrainerAssignment ta
          LEFT JOIN User tr ON tr.id = ta.trainerId
          LEFT JOIN User te ON te.id = ta.traineeId
          WHERE ta.trainerId IN (${userIds.map(() => '?').join(',')})
             OR ta.traineeId IN (${userIds.map(() => '?').join(',')})`,
    args: [...userIds, ...userIds],
  });
  if (taRes.rows.length === 0) {
    line('  NONE — no TrainerAssignment row links these users in either direction.');
  } else {
    for (const r of taRes.rows) {
      line(`  ${r.trainerName} (${r.trainerId})  →  ${r.traineeName} (${r.traineeId})`);
      line(`    id=${r.id}  active=${r.active}  isActiveTraining=${r.isActiveTraining}  createdAt=${r.createdAt}`);
    }
  }

  // 4. Tiers for those assignments
  if (taRes.rows.length > 0) {
    h('TrainerOverrideTier rows for those assignments');
    for (const a of taRes.rows) {
      const tierRes = await client.execute({
        sql: `SELECT id, upToDeal, ratePerW, sortOrder FROM TrainerOverrideTier WHERE assignmentId = ? ORDER BY sortOrder ASC`,
        args: [String(a.id)],
      });
      line(`  ${a.trainerName} → ${a.traineeName}:`);
      if (tierRes.rows.length === 0) line('    (no tiers)');
      for (const t of tierRes.rows) {
        line(`    tier #${t.sortOrder}: ratePerW=$${t.ratePerW} upToDeal=${t.upToDeal ?? '∞'}`);
      }
    }
  }

  // 5. PayrollEntry rows for this project
  h('PayrollEntry rows for THIS project');
  const peRes = await client.execute({
    sql: `SELECT pe.id, pe.repId, pe.paymentStage, pe.amountCents, pe.status, pe.notes,
                 pe.isChargeback, pe.createdAt, pe.updatedAt, pe.idempotencyKey,
                 u.firstName || ' ' || u.lastName AS repName
          FROM PayrollEntry pe
          LEFT JOIN User u ON u.id = pe.repId
          WHERE pe.projectId = ?
          ORDER BY pe.paymentStage, pe.repId`,
    args: [projectId],
  });
  if (peRes.rows.length === 0) {
    line('  NO payroll entries. Either deal never reached Installed phase, or generation hasn\'t run.');
  } else {
    for (const r of peRes.rows) {
      const amt = (Number(r.amountCents) / 100).toFixed(2);
      line(`  ${r.repName} (${r.repId})  stage=${r.paymentStage}  $${amt}  status=${r.status}  cb=${r.isChargeback}`);
      if (r.notes) line(`    notes: ${r.notes}`);
      line(`    createdAt=${r.createdAt}  updatedAt=${r.updatedAt}`);
    }
  }

  // 6. Tier consumption for any closer/setter as trainee
  if (taRes.rows.length > 0) {
    h('Tier consumption: prior deals where each trainer earned a Trainer entry per trainee');
    for (const a of taRes.rows) {
      const consRes = await client.execute({
        sql: `SELECT COUNT(DISTINCT pe.projectId) AS consumedCount
              FROM PayrollEntry pe
              JOIN Project p ON p.id = pe.projectId
              WHERE pe.paymentStage = 'Trainer'
                AND pe.repId = ?
                AND (p.closerId = ? OR p.setterId = ?)
                AND pe.projectId != ?
                AND pe.isChargeback = 0`,
        args: [String(a.trainerId), String(a.traineeId), String(a.traineeId), projectId],
      });
      line(`  ${a.trainerName} as trainer for ${a.traineeName}: ${consRes.rows[0]?.consumedCount} prior distinct deals.`);
    }
  }

  // 7. Phase-trigger inspection
  h('Phase-trigger inspection');
  line(`  current phase: ${project.phase}`);
  line(`  phaseChangedAt: ${project.phaseChangedAt}`);
  line(`  Trainer payroll entries only generate when phase enters "Installed" (project-transitions.ts:480 isInstalled gate).`);

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
