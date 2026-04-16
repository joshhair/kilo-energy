// Wipe the dummy / seed data off the prod DB in preparation for the real
// Glide import. DRY-RUN BY DEFAULT — pass `--confirm` to actually delete.
//
// What gets wiped:
//   - All transactional rows (Project + every dependent: PayrollEntry,
//     Reimbursement, ProjectActivity/Message/CheckItem/Mention)
//   - All Blitz + cascading Cost/Participant/Request
//   - All Incentive + cascading Milestone
//   - All TrainerAssignment + cascading Tier
//   - AuditLog (fresh slate)
//   - Non-admin users whose email is NOT in the @kiloenergies.com domain
//     AND not in the keep-list below (seed reps: alex@kiloenergy.com etc.)
//
// What's preserved:
//   - Admin users + anyone with email ending @kiloenergies.com
//     (that includes the seeded E2E users, which is fine — they power the
//     E2E suite and are obviously taggable as "E2E Admin" / "E2E Rep" etc.)
//   - Installer + InstallerPrepaidOption + all pricing versions/tiers
//   - Financer
//   - Product + ProductCatalogConfig + product pricing versions/tiers
//
// This script does NOT touch Clerk — orphaned Clerk accounts from
// seed-only users are harmless (they can't sign in without a matching
// Prisma row). Clean those up manually via the Clerk dashboard later
// if desired.
//
// Run:
//   npm run wipe:dry       # see the counts
//   npm run wipe:confirm   # actually delete (still with an explicit --confirm)

import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL + TURSO_AUTH_TOKEN required');
  process.exit(1);
}
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const CONFIRM = process.argv.includes('--confirm');

// Keep any user whose email is in the real-domain list. Role is NOT a
// shortcut — seed data includes synthetic "admin" rows with fake domains
// (e.g. @kilosynth.test) that should be wiped.
const KEEP_EMAIL_DOMAINS = ['@kiloenergies.com'];
const KEEP_EMAIL_EXACT = [
  'jarvisbyjosh@gmail.com', // Josh's personal
];

function shouldKeepUser(u: { email: string }): boolean {
  const lower = u.email.toLowerCase();
  if (KEEP_EMAIL_EXACT.includes(lower)) return true;
  return KEEP_EMAIL_DOMAINS.some((d) => lower.endsWith(d));
}

async function main() {
  console.log(`\n── Wipe plan ── ${CONFIRM ? 'EXECUTING' : '(dry-run — pass --confirm to delete)'}\n`);

  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, firstName: true, lastName: true },
  });
  const keep = users.filter(shouldKeepUser);
  const wipe = users.filter((u) => !shouldKeepUser(u));

  const counts = {
    payrollEntries: await prisma.payrollEntry.count(),
    reimbursements: await prisma.reimbursement.count(),
    projects: await prisma.project.count(),
    projectActivity: await prisma.projectActivity.count(),
    projectMessages: await prisma.projectMessage.count(),
    blitzes: await prisma.blitz.count(),
    blitzCosts: await prisma.blitzCost.count(),
    blitzParticipants: await prisma.blitzParticipant.count(),
    blitzRequests: await prisma.blitzRequest.count(),
    incentives: await prisma.incentive.count(),
    incentiveMilestones: await prisma.incentiveMilestone.count(),
    trainerAssignments: await prisma.trainerAssignment.count(),
    trainerOverrideTiers: await prisma.trainerOverrideTier.count(),
    auditLog: await prisma.auditLog.count(),
  };

  console.log('Will DELETE (transactional):');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }

  console.log(`\nUsers:`);
  console.log(`  ${String(keep.length).padStart(4)} kept   (admin + @kiloenergies.com + Josh)`);
  for (const u of keep) {
    console.log(`    ✓ ${u.email}  [${u.role}]  ${u.firstName} ${u.lastName}`);
  }
  console.log(`  ${String(wipe.length).padStart(4)} wiped  (seed dummies)`);
  for (const u of wipe.slice(0, 10)) {
    console.log(`    x ${u.email}  [${u.role}]`);
  }
  if (wipe.length > 10) console.log(`    … (${wipe.length - 10} more)`);

  if (!CONFIRM) {
    console.log('\n(dry-run) No rows deleted. Add --confirm to actually wipe.\n');
    await prisma.$disconnect();
    return;
  }

  // Quick "are you really sure" — delay before the destructive step so an
  // accidental ctrl-C window exists.
  console.log('\n⚠  --confirm supplied. Deleting in 3 seconds. Ctrl+C to abort.\n');
  await new Promise((r) => setTimeout(r, 3000));

  // Deletion order honors the FK graph. Cascades (Project → Activity,
  // Blitz → Cost/Participant, Incentive → Milestone, TrainerAssignment
  // → Tier) mean we don't have to explicitly enumerate every dependent,
  // but non-cascading FKs (PayrollEntry, Reimbursement, BlitzRequest)
  // must go first.
  //
  // Ordering rationale:
  //   1. PayrollEntry — FK to User + Project, no cascade
  //   2. Reimbursement — FK to User, no cascade
  //   3. BlitzRequest — FK to User (restrict) + Blitz (SetNull)
  //   4. Project — cascades to Activity/Message/CheckItem/Mention
  //   5. Blitz — cascades to Cost/Participant
  //   6. Incentive — cascades to Milestone
  //   7. TrainerAssignment — cascades to Tier
  //   8. AuditLog
  //   9. User rows that aren't in the keep list (do last since everything
  //      that FKs to User must be gone)

  const userIdsToWipe = new Set(wipe.map((u) => u.id));

  console.log('→ PayrollEntry');
  const delPayroll = await prisma.payrollEntry.deleteMany({});
  console.log(`  deleted ${delPayroll.count}`);

  console.log('→ Reimbursement');
  const delReimb = await prisma.reimbursement.deleteMany({});
  console.log(`  deleted ${delReimb.count}`);

  console.log('→ BlitzRequest');
  const delBR = await prisma.blitzRequest.deleteMany({});
  console.log(`  deleted ${delBR.count}`);

  console.log('→ Project  (cascades to Activity/Message/CheckItem/Mention)');
  const delProj = await prisma.project.deleteMany({});
  console.log(`  deleted ${delProj.count}`);

  console.log('→ Blitz  (cascades to Cost/Participant)');
  const delBlitz = await prisma.blitz.deleteMany({});
  console.log(`  deleted ${delBlitz.count}`);

  console.log('→ Incentive  (cascades to Milestone)');
  const delInc = await prisma.incentive.deleteMany({});
  console.log(`  deleted ${delInc.count}`);

  console.log('→ TrainerAssignment  (cascades to Tier)');
  const delTA = await prisma.trainerAssignment.deleteMany({});
  console.log(`  deleted ${delTA.count}`);

  console.log('→ AuditLog');
  const delAudit = await prisma.auditLog.deleteMany({});
  console.log(`  deleted ${delAudit.count}`);

  if (userIdsToWipe.size > 0) {
    console.log(`→ User  (${userIdsToWipe.size} seed dummies)`);
    const delUsers = await prisma.user.deleteMany({
      where: { id: { in: [...userIdsToWipe] } },
    });
    console.log(`  deleted ${delUsers.count}`);
  }

  console.log('\n✓ Wipe complete. Verifying residual counts:');
  console.log(`  projects:         ${await prisma.project.count()}`);
  console.log(`  payrollEntries:   ${await prisma.payrollEntry.count()}`);
  console.log(`  reimbursements:   ${await prisma.reimbursement.count()}`);
  console.log(`  blitzes:          ${await prisma.blitz.count()}`);
  console.log(`  incentives:       ${await prisma.incentive.count()}`);
  console.log(`  users kept:       ${await prisma.user.count()}`);
  console.log(`  installers:       ${await prisma.installer.count()}  (preserved)`);
  console.log(`  financers:        ${await prisma.financer.count()}  (preserved)`);
  console.log(`  products:         ${await prisma.product.count()}  (preserved)`);
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
