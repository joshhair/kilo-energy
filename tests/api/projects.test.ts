import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock Clerk before importing route handlers
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-user',
    emailAddresses: [{ emailAddress: 'josh@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';

describe('Projects API — Database Integration', () => {
  let testInstallerId: string;
  let testFinancerId: string;
  let testCloserId: string;

  beforeAll(async () => {
    // Ensure we have test reference data
    const installer = await prisma.installer.findFirst({ where: { active: true } });
    const financer = await prisma.financer.findFirst({ where: { active: true } });
    const closer = await prisma.user.findFirst({ where: { role: 'rep', active: true } });

    if (!installer || !financer || !closer) {
      throw new Error('DB not seeded — run `npx prisma db seed` first');
    }

    testInstallerId = installer.id;
    testFinancerId = financer.id;
    testCloserId = closer.id;
  });

  it('can create a project via Prisma', async () => {
    const project = await prisma.project.create({
      data: {
        customerName: 'Test Customer — Vitest',
        closerId: testCloserId,
        installerId: testInstallerId,
        financerId: testFinancerId,
        productType: 'Loan',
        kWSize: 8.5,
        netPPW: 3.20,
        soldDate: '2026-04-01',
        phase: 'New',
      },
    });

    expect(project.id).toBeTruthy();
    expect(project.customerName).toBe('Test Customer — Vitest');
    expect(project.phase).toBe('New');
    expect(project.kWSize).toBe(8.5);

    // Clean up
    await prisma.project.delete({ where: { id: project.id } });
  });

  it('can update a project phase', async () => {
    const project = await prisma.project.create({
      data: {
        customerName: 'Phase Test — Vitest',
        closerId: testCloserId,
        installerId: testInstallerId,
        financerId: testFinancerId,
        productType: 'Loan',
        kWSize: 6.0,
        netPPW: 2.90,
        soldDate: '2026-04-01',
        phase: 'New',
      },
    });

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { phase: 'Acceptance' },
    });

    expect(updated.phase).toBe('Acceptance');

    await prisma.project.delete({ where: { id: project.id } });
  });

  it('can delete a project', async () => {
    const project = await prisma.project.create({
      data: {
        customerName: 'Delete Test — Vitest',
        closerId: testCloserId,
        installerId: testInstallerId,
        financerId: testFinancerId,
        productType: 'Cash',
        kWSize: 4.0,
        netPPW: 3.10,
        soldDate: '2026-04-01',
        phase: 'New',
      },
    });

    await prisma.project.delete({ where: { id: project.id } });

    const found = await prisma.project.findUnique({ where: { id: project.id } });
    expect(found).toBeNull();
  });

  it('enforces required fields', async () => {
    await expect(
      prisma.project.create({
        data: {
          customerName: 'Missing Fields',
          closerId: testCloserId,
          installerId: testInstallerId,
          financerId: testFinancerId,
          // Missing: productType, kWSize, netPPW, soldDate
        } as never,
      })
    ).rejects.toThrow();
  });

  it('project references valid installer and financer', async () => {
    const project = await prisma.project.create({
      data: {
        customerName: 'FK Test — Vitest',
        closerId: testCloserId,
        installerId: testInstallerId,
        financerId: testFinancerId,
        productType: 'PPA',
        kWSize: 7.0,
        netPPW: 3.50,
        soldDate: '2026-04-01',
        phase: 'New',
      },
      include: { installer: true, financer: true, closer: true },
    });

    expect(project.installer.name).toBeTruthy();
    expect(project.financer.name).toBeTruthy();
    expect(project.closer.firstName).toBeTruthy();

    await prisma.project.delete({ where: { id: project.id } });
  });

  // ── Tag-team: multi-closer / multi-setter via ProjectCloser + ProjectSetter ──
  it('can create a project with one co-closer and query them both back', async () => {
    // Grab any second active rep (non-admin) distinct from the primary.
    const coCloser = await prisma.user.findFirst({
      where: { role: 'rep', active: true, NOT: { id: testCloserId } },
    });
    if (!coCloser) {
      // If the seed only has one rep, skip rather than fabricate data that
      // would break other tests. The E2E + Glide import exercises this path.
      return;
    }

    const project = await prisma.project.create({
      data: {
        customerName: 'Tag-team Test — Vitest',
        closerId: testCloserId,
        installerId: testInstallerId,
        financerId: testFinancerId,
        productType: 'Loan',
        kWSize: 8.0,
        netPPW: 3.20,
        soldDate: '2026-04-01',
        phase: 'New',
        m1AmountCents: 50000,  // primary closer's cut at M1 ($500)
        additionalClosers: {
          create: [
            {
              userId: coCloser.id,
              m1AmountCents: 50000,  // co-closer's cut at M1 ($500)
              m2AmountCents: 0,
              position: 1,
            },
          ],
        },
      },
      include: {
        additionalClosers: { include: { user: true } },
      },
    });

    expect(project.additionalClosers).toHaveLength(1);
    expect(project.additionalClosers[0].userId).toBe(coCloser.id);
    expect(project.additionalClosers[0].m1AmountCents).toBe(50000);
    expect(project.additionalClosers[0].position).toBe(1);
    expect(project.additionalClosers[0].user.id).toBe(coCloser.id);

    // Cleanup — cascade delete drops the ProjectCloser row automatically.
    await prisma.project.delete({ where: { id: project.id } });
    const orphan = await prisma.projectCloser.findFirst({ where: { projectId: project.id } });
    expect(orphan).toBeNull();
  });

  it('rejects duplicate co-closer (same user on same project)', async () => {
    const coCloser = await prisma.user.findFirst({
      where: { role: 'rep', active: true, NOT: { id: testCloserId } },
    });
    if (!coCloser) return;

    const project = await prisma.project.create({
      data: {
        customerName: 'Dedupe Test — Vitest',
        closerId: testCloserId,
        installerId: testInstallerId,
        financerId: testFinancerId,
        productType: 'Loan',
        kWSize: 5.0,
        netPPW: 3.00,
        soldDate: '2026-04-01',
        phase: 'New',
        additionalClosers: {
          create: [{ userId: coCloser.id, m1AmountCents: 10000, position: 1 }],
        },
      },
    });

    await expect(
      prisma.projectCloser.create({
        data: { projectId: project.id, userId: coCloser.id, m1AmountCents: 1, position: 2 },
      }),
    ).rejects.toThrow(); // unique(projectId, userId)

    await prisma.project.delete({ where: { id: project.id } });
  });
});
