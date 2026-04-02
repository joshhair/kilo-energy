import { prisma } from '../lib/db.js';

async function main() {
  // Set m3Amount on projects at Installed/PTO with 80% installPayPct
  const updates = [
    { id: 'proj1', m3Amount: 473 },   // ESP, PTO
    { id: 'proj2', m3Amount: 175 },   // EXO, Installed
    { id: 'proj7', m3Amount: 315 },   // Complete Solar, Installed
    { id: 'proj13', m3Amount: 299 },  // One Source, PTO
  ];

  for (const u of updates) {
    await prisma.project.update({ where: { id: u.id }, data: { m3Amount: u.m3Amount } });
    console.log(`Updated ${u.id}: m3Amount = ${u.m3Amount}`);
  }

  const check = await prisma.project.findMany({
    where: { m3Amount: { gt: 0 } },
    select: { id: true, customerName: true, m3Amount: true, phase: true },
  });
  console.log(`\nProjects with m3Amount > 0: ${check.length}`);
  for (const p of check) {
    console.log(`  ${p.customerName} | ${p.phase} | m3: $${p.m3Amount}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
