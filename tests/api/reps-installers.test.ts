import { describe, it, expect, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-user',
    emailAddresses: [{ emailAddress: 'josh@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';

describe('Reps — Database Integration', () => {
  it('can create a rep', async () => {
    const rep = await prisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Rep',
        email: `test-rep-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'both',
      },
    });

    expect(rep.id).toBeTruthy();
    expect(rep.role).toBe('rep');
    expect(rep.active).toBe(true);

    await prisma.user.delete({ where: { id: rep.id } });
  });

  it('enforces unique email', async () => {
    const email = `unique-${Date.now()}@vitest.com`;
    await prisma.user.create({
      data: { firstName: 'A', lastName: 'B', email, role: 'rep' },
    });

    await expect(
      prisma.user.create({
        data: { firstName: 'C', lastName: 'D', email, role: 'rep' },
      })
    ).rejects.toThrow();

    await prisma.user.deleteMany({ where: { email } });
  });

  it('can deactivate a rep (soft delete)', async () => {
    const rep = await prisma.user.create({
      data: {
        firstName: 'Deactivate',
        lastName: 'Test',
        email: `deactivate-${Date.now()}@vitest.com`,
        role: 'rep',
      },
    });

    const updated = await prisma.user.update({
      where: { id: rep.id },
      data: { active: false },
    });

    expect(updated.active).toBe(false);

    await prisma.user.delete({ where: { id: rep.id } });
  });

  it('can create a sub-dealer', async () => {
    const sd = await prisma.user.create({
      data: {
        firstName: 'Sub',
        lastName: 'Dealer',
        email: `sub-dealer-${Date.now()}@vitest.com`,
        role: 'sub-dealer',
      },
    });

    expect(sd.role).toBe('sub-dealer');

    await prisma.user.delete({ where: { id: sd.id } });
  });
});

describe('Installers — Database Integration', () => {
  it('can create an installer', async () => {
    const inst = await prisma.installer.create({
      data: {
        name: `TestInstaller-${Date.now()}`,
        installPayPct: 80,
      },
    });

    expect(inst.id).toBeTruthy();
    expect(inst.installPayPct).toBe(80);
    expect(inst.usesProductCatalog).toBe(false);

    await prisma.installer.delete({ where: { id: inst.id } });
  });

  it('enforces unique installer name', async () => {
    const name = `UniqueInst-${Date.now()}`;
    await prisma.installer.create({ data: { name } });

    await expect(
      prisma.installer.create({ data: { name } })
    ).rejects.toThrow();

    await prisma.installer.deleteMany({ where: { name } });
  });

  it('can create a product catalog installer', async () => {
    const inst = await prisma.installer.create({
      data: {
        name: `CatalogInst-${Date.now()}`,
        installPayPct: 100,
        usesProductCatalog: true,
      },
    });

    expect(inst.usesProductCatalog).toBe(true);
    expect(inst.installPayPct).toBe(100);

    await prisma.installer.delete({ where: { id: inst.id } });
  });
});

describe('Financers — Database Integration', () => {
  it('can create a financer', async () => {
    const fin = await prisma.financer.create({
      data: { name: `TestFinancer-${Date.now()}` },
    });

    expect(fin.id).toBeTruthy();
    expect(fin.active).toBe(true);

    await prisma.financer.delete({ where: { id: fin.id } });
  });
});

describe('Pricing Versions — Database Integration', () => {
  it('can create a pricing version for an installer', async () => {
    const inst = await prisma.installer.create({
      data: { name: `PricingInst-${Date.now()}` },
    });

    const version = await prisma.installerPricingVersion.create({
      data: {
        installerId: inst.id,
        label: 'v1 — Test',
        effectiveFrom: '2026-01-01',
        rateType: 'flat',
        tiers: {
          create: {
            minKW: 0,
            closerPerW: 2.90,
            kiloPerW: 2.35,
          },
        },
      },
      include: { tiers: true },
    });

    expect(version.tiers).toHaveLength(1);
    expect(version.tiers[0].closerPerW).toBe(2.90);

    await prisma.installerPricingVersion.delete({ where: { id: version.id } });
    await prisma.installer.delete({ where: { id: inst.id } });
  });

  it('can create tiered pricing version', async () => {
    const inst = await prisma.installer.create({
      data: { name: `TieredInst-${Date.now()}` },
    });

    const version = await prisma.installerPricingVersion.create({
      data: {
        installerId: inst.id,
        label: 'v1 — Tiered Test',
        effectiveFrom: '2026-01-01',
        rateType: 'tiered',
        tiers: {
          create: [
            { minKW: 1, maxKW: 10, closerPerW: 3.00, kiloPerW: 2.50 },
            { minKW: 10, maxKW: null, closerPerW: 2.80, kiloPerW: 2.30 },
          ],
        },
      },
      include: { tiers: true },
    });

    expect(version.tiers).toHaveLength(2);
    expect(version.rateType).toBe('tiered');

    await prisma.installerPricingVersion.delete({ where: { id: version.id } });
    await prisma.installer.delete({ where: { id: inst.id } });
  });
});

describe('Reimbursements — Database Integration', () => {
  it('can create a reimbursement', async () => {
    const rep = await prisma.user.findFirst({ where: { role: 'rep', active: true } });
    if (!rep) throw new Error('DB not seeded');

    const reimb = await prisma.reimbursement.create({
      data: {
        repId: rep.id,
        amountCents: 7550,
        description: 'Gas mileage — Vitest',
        date: '2026-04-01',
        status: 'Pending',
      },
    });

    expect(reimb.status).toBe('Pending');
    expect(reimb.amountCents).toBe(7550);

    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });
});

describe('Trainer Assignments — Database Integration', () => {
  it('can create a trainer assignment with tiers', async () => {
    const users = await prisma.user.findMany({ where: { role: 'rep', active: true }, take: 2 });
    if (users.length < 2) throw new Error('Need at least 2 reps');

    const assignment = await prisma.trainerAssignment.create({
      data: {
        trainerId: users[0].id,
        traineeId: users[1].id,
        tiers: {
          create: [
            { upToDeal: 10, ratePerW: 0.20, sortOrder: 0 },
            { ratePerW: 0.10, sortOrder: 1 },
          ],
        },
      },
      include: { tiers: true },
    });

    expect(assignment.tiers).toHaveLength(2);
    expect(assignment.tiers[0].ratePerW).toBe(0.20);

    await prisma.trainerAssignment.delete({ where: { id: assignment.id } });
  });
});
