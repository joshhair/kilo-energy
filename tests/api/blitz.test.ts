import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-user',
    emailAddresses: [{ emailAddress: 'josh@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';

describe('Blitz API — Database Integration', () => {
  let testOwnerId: string;

  beforeAll(async () => {
    const user = await prisma.user.findFirst({ where: { active: true } });
    if (!user) throw new Error('DB not seeded');
    testOwnerId = user.id;
  });

  it('can create a blitz', async () => {
    const blitz = await prisma.blitz.create({
      data: {
        name: 'Test Blitz — Vitest',
        location: 'Austin, TX',
        housing: 'Hotel',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        status: 'upcoming',
        createdById: testOwnerId,
        ownerId: testOwnerId,
      },
    });

    expect(blitz.id).toBeTruthy();
    expect(blitz.name).toBe('Test Blitz — Vitest');
    expect(blitz.status).toBe('upcoming');

    await prisma.blitz.delete({ where: { id: blitz.id } });
  });

  it('can add participants to a blitz', async () => {
    const blitz = await prisma.blitz.create({
      data: {
        name: 'Participant Test — Vitest',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        status: 'upcoming',
        createdById: testOwnerId,
        ownerId: testOwnerId,
      },
    });

    const participant = await prisma.blitzParticipant.create({
      data: {
        blitzId: blitz.id,
        userId: testOwnerId,
        joinStatus: 'approved',
      },
    });

    expect(participant.blitzId).toBe(blitz.id);
    expect(participant.joinStatus).toBe('approved');

    // Clean up
    await prisma.blitzParticipant.delete({ where: { id: participant.id } });
    await prisma.blitz.delete({ where: { id: blitz.id } });
  });

  it('can add costs to a blitz', async () => {
    const blitz = await prisma.blitz.create({
      data: {
        name: 'Cost Test — Vitest',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        status: 'upcoming',
        createdById: testOwnerId,
        ownerId: testOwnerId,
      },
    });

    const cost = await prisma.blitzCost.create({
      data: {
        blitzId: blitz.id,
        category: 'housing',
        description: 'Hotel rooms',
        amountCents: 250000,
        date: '2026-05-01',
      },
    });

    expect(cost.category).toBe('housing');
    expect(cost.amountCents).toBe(250000);

    await prisma.blitzCost.delete({ where: { id: cost.id } });
    await prisma.blitz.delete({ where: { id: blitz.id } });
  });

  it('cascade deletes participants and costs when blitz is deleted', async () => {
    const blitz = await prisma.blitz.create({
      data: {
        name: 'Cascade Test — Vitest',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        status: 'upcoming',
        createdById: testOwnerId,
        ownerId: testOwnerId,
      },
    });

    await prisma.blitzParticipant.create({
      data: { blitzId: blitz.id, userId: testOwnerId, joinStatus: 'approved' },
    });

    await prisma.blitzCost.create({
      data: { blitzId: blitz.id, category: 'travel', description: 'Flights', amountCents: 150000, date: '2026-07-01' },
    });

    // Delete blitz — should cascade
    await prisma.blitz.delete({ where: { id: blitz.id } });

    const orphanParticipants = await prisma.blitzParticipant.findMany({
      where: { blitzId: blitz.id },
    });
    expect(orphanParticipants).toHaveLength(0);

    const orphanCosts = await prisma.blitzCost.findMany({
      where: { blitzId: blitz.id },
    });
    expect(orphanCosts).toHaveLength(0);
  });
});
