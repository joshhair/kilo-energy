import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-user',
    emailAddresses: [{ emailAddress: 'josh@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';
import { resolveTrainerRate } from '@/lib/commission';

describe('Trainer Backfill — Database Integration', () => {
  let trainerId: string;
  let traineeId: string;
  let assignmentId: string;
  let projectId: string;
  let installerId: string;
  let financerId: string;

  beforeAll(async () => {
    // Create test users
    const trainer = await prisma.user.create({
      data: {
        firstName: 'BackfillTrainer',
        lastName: 'Test',
        email: `backfill-trainer-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'closer',
      },
    });
    trainerId = trainer.id;

    const trainee = await prisma.user.create({
      data: {
        firstName: 'BackfillTrainee',
        lastName: 'Test',
        email: `backfill-trainee-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'closer',
      },
    });
    traineeId = trainee.id;

    // Create assignment with tiers
    const assignment = await prisma.trainerAssignment.create({
      data: {
        trainerId,
        traineeId,
        isActiveTraining: true,
        tiers: {
          create: [
            { upToDeal: 5, ratePerW: 0.20, sortOrder: 0 },
            { upToDeal: null, ratePerW: 0.10, sortOrder: 1 },
          ],
        },
      },
    });
    assignmentId = assignment.id;

    // Get or create installer + financer for test project
    let installer = await prisma.installer.findFirst({ where: { name: 'ESP' } });
    if (!installer) {
      installer = await prisma.installer.create({
        data: { name: 'ESP', installPayPct: 80 },
      });
    }
    installerId = installer.id;

    let financer = await prisma.financer.findFirst();
    if (!financer) {
      financer = await prisma.financer.create({
        data: { name: 'TestFinancer' },
      });
    }
    financerId = financer.id;

    // Create a test project (Installed, M2 paid)
    const project = await prisma.project.create({
      data: {
        customerName: 'Backfill Test Customer',
        closerId: traineeId,
        installerId,
        financerId,
        soldDate: '2026-01-15',
        productType: 'Loan',
        kWSize: 8.0,
        netPPW: 3.5,
        phase: 'Installed',
        m1AmountCents: 100000,
        m2AmountCents: 200000,
        m2Paid: true,
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    // Cleanup in dependency order
    await prisma.payrollEntry.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
    await prisma.trainerOverrideTier.deleteMany({ where: { assignmentId } });
    await prisma.trainerAssignment.delete({ where: { id: assignmentId } });
    await prisma.user.delete({ where: { id: trainerId } });
    await prisma.user.delete({ where: { id: traineeId } });
  });

  it('resolves trainer rate correctly for the first deal', () => {
    const result = resolveTrainerRate(
      { id: projectId, trainerId: null, trainerRate: null },
      traineeId,
      [{
        id: assignmentId,
        trainerId,
        traineeId,
        tiers: [
          { upToDeal: 5, ratePerW: 0.20 },
          { upToDeal: null, ratePerW: 0.10 },
        ],
      }],
      [], // no prior entries
    );

    expect(result.rate).toBe(0.20);
    expect(result.trainerId).toBe(trainerId);
    expect(result.reason).toBe('active-tier-0');
  });

  it('creates trainer payroll entries via backfill endpoint', async () => {
    // Import the POST handler
    const { POST } = await import('@/app/api/trainer-assignments/[id]/backfill/route');

    const req = new Request('http://localhost/api/trainer-assignments/' + assignmentId + '/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectIds: [projectId],
        statusForMilestones: 'Paid',
      }),
    });

    const res = await POST(req as Parameters<typeof POST>[0], { params: Promise.resolve({ id: assignmentId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(1);

    // Verify entries were created in DB
    const entries = await prisma.payrollEntry.findMany({
      where: { projectId, paymentStage: 'Trainer', repId: trainerId },
    });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // M2 entry should exist (project is Installed with m2Paid=true)
    const m2Entry = entries.find((e) => (e.notes ?? '').includes('Trainer override M2'));
    expect(m2Entry).toBeTruthy();
    expect(m2Entry!.status).toBe('Paid');
    // Rate = $0.20/W * 8kW * 1000W/kW * 0.80 = $1,280
    expect(m2Entry!.amountCents).toBe(128000);
  });

  it('is idempotent — re-running backfill on the same project skips duplicates', async () => {
    const { POST } = await import('@/app/api/trainer-assignments/[id]/backfill/route');

    const req = new Request('http://localhost/api/trainer-assignments/' + assignmentId + '/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectIds: [projectId],
        statusForMilestones: 'Paid',
      }),
    });

    const res = await POST(req as Parameters<typeof POST>[0], { params: Promise.resolve({ id: assignmentId }) });
    await res.json();

    expect(res.status).toBe(200);
    // Should have skipped because entries already exist from previous test
    const entries = await prisma.payrollEntry.findMany({
      where: { projectId, paymentStage: 'Trainer', repId: trainerId },
    });
    // Should not have duplicated entries — still the same count as before
    const m2Entries = entries.filter((e) => (e.notes ?? '').includes('Trainer override M2'));
    expect(m2Entries.length).toBe(1);
  });

  it('rejects non-admin requests (auth gate)', async () => {
    // Override the mock to simulate a non-admin user
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: 'non-admin' });
    (currentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'non-admin',
      emailAddresses: [{ emailAddress: 'nobody@example.com' }],
    });

    const { POST } = await import('@/app/api/trainer-assignments/[id]/backfill/route');

    const req = new Request('http://localhost/api/trainer-assignments/' + assignmentId + '/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectIds: [projectId],
        statusForMilestones: 'Paid',
      }),
    });

    const res = await POST(req as Parameters<typeof POST>[0], { params: Promise.resolve({ id: assignmentId }) });
    // Should be 401 or 403 — requireAdmin() throws for non-admin users
    expect([401, 403]).toContain(res.status);
  });
});
