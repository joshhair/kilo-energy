import { prisma } from '../lib/db.js';

async function main() {
  const email = 'josh@kiloenergies.com';

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.log('User already exists:', existing.id, existing.firstName, existing.lastName, existing.role);
    // Update to admin if not already
    if (existing.role !== 'admin') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin' } });
      console.log('Updated to admin role');
    }
  } else {
    const user = await prisma.user.create({
      data: {
        firstName: 'Josh',
        lastName: 'Hair',
        email,
        phone: '',
        role: 'admin',
        repType: 'closer',
        active: true,
      },
    });
    console.log('Created admin user:', user.id, user.firstName, user.lastName, user.role);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
