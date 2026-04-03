import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-user',
    emailAddresses: [{ emailAddress: 'josh@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';

describe('Payroll API — Database Integration', () => {
  let testRepId: string;
  let testProjectId: string;

  beforeAll(async () => {
    const rep = await prisma.user.findFirst({ where: { role: 'rep', active: true } });
    const project = await prisma.project.findFirst();

    if (!rep || !project) {
      throw new Error('DB not seeded — run `npx prisma db seed` first');
    }

    testRepId = rep.id;
    testProjectId = project.id;
  });

  it('can create a payroll entry', async () => {
    const entry = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: testProjectId,
        amount: 1500,
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Draft',
        date: '2026-04-01',
        notes: 'Test entry — Vitest',
      },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.amount).toBe(1500);
    expect(entry.status).toBe('Draft');
    expect(entry.paymentStage).toBe('M1');

    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('can update payroll status Draft → Pending → Paid', async () => {
    const entry = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: testProjectId,
        amount: 1000,
        type: 'Deal',
        paymentStage: 'M2',
        status: 'Draft',
        date: '2026-04-01',
        notes: '',
      },
    });

    const pending = await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { status: 'Pending' },
    });
    expect(pending.status).toBe('Pending');

    const paid = await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { status: 'Paid' },
    });
    expect(paid.status).toBe('Paid');

    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('can create a bonus entry (no project)', async () => {
    const entry = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: null,
        amount: 500,
        type: 'Bonus',
        paymentStage: 'Bonus',
        status: 'Draft',
        date: '2026-04-01',
        notes: 'Q1 bonus — Vitest',
      },
    });

    expect(entry.projectId).toBeNull();
    expect(entry.type).toBe('Bonus');

    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('can create a trainer override entry', async () => {
    const entry = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: testProjectId,
        amount: 200,
        type: 'Deal',
        paymentStage: 'Trainer',
        status: 'Draft',
        date: '2026-04-01',
        notes: 'Trainer override — Vitest',
      },
    });

    expect(entry.paymentStage).toBe('Trainer');

    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('can bulk query payroll by status', async () => {
    const drafts = await prisma.payrollEntry.findMany({
      where: { status: 'Draft' },
    });
    // Should have some from seed data
    expect(Array.isArray(drafts)).toBe(true);
    for (const d of drafts) {
      expect(d.status).toBe('Draft');
    }
  });

  it('can query payroll by rep', async () => {
    const entries = await prisma.payrollEntry.findMany({
      where: { repId: testRepId },
      include: { rep: true },
    });
    expect(Array.isArray(entries)).toBe(true);
    for (const e of entries) {
      expect(e.repId).toBe(testRepId);
      expect(e.rep.id).toBe(testRepId);
    }
  });
});
