/**
 * migrate-pay-pending-defaults.mts — one-shot backfill that flips existing
 * NotificationPreference rows for `pay_pending` from email/instant to
 * digestMode='off'.
 *
 * Why: the registry default for `pay_pending` was changed to digestMode='off'
 * but registry defaults only apply when no preference row exists for that
 * (user, eventType) pair. Every existing user with auto-created or manually-
 * adjusted prefs keeps their old behavior unless explicitly migrated.
 *
 * Conservative scope:
 *   - Only flips rows that LOOK auto-created: digestMode='instant',
 *     emailEnabled=true, smsEnabled=false, pushEnabled=false. Anyone who
 *     explicitly customized any of those gets left alone.
 *   - Writes new digestMode='off'. Leaves channel toggles alone so a re-
 *     enable through Settings restores their prior intent.
 *   - Audits every row touched.
 *   - Re-runnable: if nothing matches, exits "nothing to do".
 *
 * Run (from kilo-energy/):
 *   npx tsx scripts/migrate-pay-pending-defaults.mts
 *
 * Verify after (read-only):
 *   Settings → Preferences for any rep — pay_pending should show as off,
 *   pay_paid still email/instant.
 */

import 'dotenv/config';
import readline from 'readline';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const prisma = new PrismaClient({ adapter });

const ACTOR_ID = 'system_pay_pending_default_migration';
const ACTOR_EMAIL = 'system+pay-pending-default@kiloenergies.com';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  pay_pending DEFAULT MIGRATION');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Flips pay_pending rows matching the OLD default (email/instant)');
  console.log('  to digestMode=off. Explicitly customized rows are left alone.');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Find every pay_pending preference row that matches the OLD default
  // exactly. Anything else is a user customization and we leave it alone.
  const candidates = await prisma.notificationPreference.findMany({
    where: {
      eventType: 'pay_pending',
      digestMode: 'instant',
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: false,
    },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  });

  if (candidates.length === 0) {
    console.log('  ✓ No untouched pay_pending rows to migrate. Nothing to do.');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`Candidates to flip pay_pending → off:  ${candidates.length}\n`);

  // Also report rows that DO exist for pay_pending but DON'T match the old
  // default exactly — those are user-customized and we're leaving them.
  const allPending = await prisma.notificationPreference.findMany({
    where: { eventType: 'pay_pending' },
    select: { id: true, userId: true },
  });
  const candidateIds = new Set(candidates.map((c) => c.id));
  const skippedCustom = allPending.filter((p) => !candidateIds.has(p.id)).length;
  console.log(`Customized rows we'll skip:          ${skippedCustom}\n`);

  console.log('Sample of candidates (first 10):');
  for (const c of candidates.slice(0, 10)) {
    const name = `${c.user?.firstName ?? ''} ${c.user?.lastName ?? ''}`.trim();
    console.log(`  ${name.padEnd(28)} ${c.user?.email ?? '—'}`);
  }
  if (candidates.length > 10) console.log(`  ... + ${candidates.length - 10} more`);

  const ans = await ask(`\nApply migration to all ${candidates.length} rows? (y/n): `);
  if (ans !== 'y' && ans !== 'yes') {
    console.log('Aborted.');
    await prisma.$disconnect();
    process.exit(0);
  }

  let updated = 0;
  for (const c of candidates) {
    await prisma.notificationPreference.update({
      where: { id: c.id },
      data: { digestMode: 'off' },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
        action: 'notification_preference_update',
        entityType: 'NotificationPreference',
        entityId: c.id,
        oldValue: JSON.stringify({ digestMode: 'instant', userId: c.userId, eventType: 'pay_pending' }),
        newValue: JSON.stringify({ digestMode: 'off', reason: 'pay_pending default rebalance (Phase E)' }),
      },
    });
    updated++;
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  ✓ MIGRATION COMPLETE`);
  console.log(`     Rows updated:    ${updated}`);
  console.log(`     Customized rows: ${skippedCustom} (untouched)`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
