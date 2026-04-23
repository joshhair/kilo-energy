import { PrismaLibSql } from '@prisma/adapter-libsql';
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const prisma = new PrismaClient({ adapter });

const tyson = await prisma.user.findFirst({ where: { firstName: 'Tyson', lastName: 'Smack' } });
console.log('Tyson:', JSON.stringify(tyson, null, 2));
await prisma.$disconnect();
