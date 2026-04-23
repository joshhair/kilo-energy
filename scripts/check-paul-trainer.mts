// Quick probe: does Paul Tupou have any TrainerAssignment, and what
// would his rate resolve to for Tyson Smack specifically?

import { PrismaLibSql } from '@prisma/adapter-libsql';

const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const prisma = new PrismaClient({ adapter });

const paul = await prisma.user.findFirst({
  where: { firstName: 'Paul', lastName: 'Tupou' },
});
if (!paul) { console.log('Paul not found'); process.exit(1); }

console.log(`Paul Tupou (${paul.id})`);

const asgs = await prisma.trainerAssignment.findMany({
  where: { trainerId: paul.id },
  include: { trainee: { select: { firstName: true, lastName: true } }, tiers: { orderBy: { sortOrder: 'asc' } } },
});
console.log(`  TrainerAssignments where Paul is trainer: ${asgs.length}`);
for (const a of asgs) {
  console.log(`    → ${a.trainee?.firstName} ${a.trainee?.lastName} (active=${a.isActiveTraining})`);
  for (const t of a.tiers) console.log(`        tier upTo=${t.upToDeal} rate=${t.ratePerW}`);
}

const tyson = await prisma.user.findFirst({ where: { firstName: 'Tyson', lastName: 'Smack' } });
if (tyson) {
  console.log(``);
  console.log(`Tyson Smack (${tyson.id})`);
  const asgForTyson = await prisma.trainerAssignment.findMany({
    where: { traineeId: tyson.id },
    include: { trainer: { select: { firstName: true, lastName: true } } },
  });
  console.log(`  TrainerAssignments where Tyson is trainee: ${asgForTyson.length}`);
  for (const a of asgForTyson) {
    console.log(`    ← trainer: ${a.trainer?.firstName} ${a.trainer?.lastName} (active=${a.isActiveTraining})`);
  }
}

await prisma.$disconnect();
