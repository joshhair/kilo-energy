// API tests for explicit chargeback creation via POST /api/payroll.
//
// Verifies the Batch 2 gates:
//   - isChargeback=true requires chargebackOfId
//   - chargebackOfId must reference an existing Paid entry
//   - Referenced entry must be on same project + rep + stage
//   - |amount| ≤ original amount
//   - Can't chargeback a chargeback
//   - Non-admin can't create chargebacks (RBAC)
//   - Isolates the legacy-Glide gate (imports can receive explicit
//     chargebacks; implicit negative entries still blocked)

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'admin@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';
import { POST } from '@/app/api/payroll/route';

describe('POST /api/payroll — chargeback flow', () => {
  let adminClerkId: string;
  let testRepId: string;
  let testProjectId: string;
  let originalEntryId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
    adminClerkId = admin.clerkUserId ?? 'x';
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const project = await prisma.project.findFirstOrThrow({ where: { importedFromGlide: false } });

    testRepId = rep.id;
    testProjectId = project.id;

    const original = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: testProjectId,
        amountCents: 100_000, // $1000
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Paid',
        date: '2026-04-01',
      },
    });
    originalEntryId = original.id;

    const { auth, currentUser } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: adminClerkId } as never);
    vi.mocked(currentUser).mockResolvedValue({
      id: adminClerkId,
      emailAddresses: [{ emailAddress: admin.email }],
    } as never);
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await prisma.payrollEntry.deleteMany({ where: { id: { in: createdIds } } });
      createdIds.length = 0;
    }
  });

  function mkRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('creates a full chargeback (happy path)', async () => {
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: testProjectId,
      amount: -1000,
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-20',
      notes: 'Deal cancelled — full M1 clawback',
      isChargeback: true,
      chargebackOfId: originalEntryId,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    createdIds.push(body.id);
    expect(body.isChargeback).toBe(true);
    expect(body.chargebackOfId).toBe(originalEntryId);
    expect(body.amount).toBe(-1000);
  });

  it('creates a partial chargeback (amount < original)', async () => {
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: testProjectId,
      amount: -400,
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-20',
      isChargeback: true,
      chargebackOfId: originalEntryId,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    createdIds.push(body.id);
    expect(body.amount).toBe(-400);
  });

  it('rejects chargeback with positive amount (Zod refine)', async () => {
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: testProjectId,
      amount: 500, // positive — invalid for chargeback
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-20',
      isChargeback: true,
      chargebackOfId: originalEntryId,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects chargeback without chargebackOfId (Zod refine)', async () => {
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: testProjectId,
      amount: -500,
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-20',
      isChargeback: true,
      // missing chargebackOfId
    }));
    expect(res.status).toBe(400);
  });

  it('rejects chargeback exceeding original amount', async () => {
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: testProjectId,
      amount: -5000, // > $1000 original
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-20',
      isChargeback: true,
      chargebackOfId: originalEntryId,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cannot exceed/i);
  });

  it('rejects chargeback against non-Paid original', async () => {
    const pending = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: testProjectId,
        amountCents: 50_000,
        type: 'Deal',
        paymentStage: 'M2',
        status: 'Pending',
        date: '2026-04-01',
      },
    });
    try {
      const res = await POST(mkRequest({
        repId: testRepId,
        projectId: testProjectId,
        amount: -500,
        type: 'Deal',
        paymentStage: 'M2',
        status: 'Draft',
        date: '2026-04-20',
        isChargeback: true,
        chargebackOfId: pending.id,
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/paid/i);
    } finally {
      await prisma.payrollEntry.delete({ where: { id: pending.id } });
    }
  });

  it('rejects chargeback on mismatched paymentStage', async () => {
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: testProjectId,
      amount: -500,
      type: 'Deal',
      paymentStage: 'M2', // original is M1
      status: 'Draft',
      date: '2026-04-20',
      isChargeback: true,
      chargebackOfId: originalEntryId,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/paymentStage/i);
  });

  it('rejects chargeback on a chargeback', async () => {
    const cb = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: testProjectId,
        amountCents: -100_000,
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Paid',
        date: '2026-04-05',
        isChargeback: true,
        chargebackOfId: originalEntryId,
      },
    });
    try {
      const res = await POST(mkRequest({
        repId: testRepId,
        projectId: testProjectId,
        amount: -500,
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Draft',
        date: '2026-04-20',
        isChargeback: true,
        chargebackOfId: cb.id,
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/chargeback/i);
    } finally {
      await prisma.payrollEntry.delete({ where: { id: cb.id } });
    }
  });

  it('allows explicit chargeback on imported-from-Glide project (the whole point of this batch)', async () => {
    const glideProj = await prisma.project.findFirst({ where: { importedFromGlide: true } });
    if (!glideProj) {
      console.log('(skip: no imported-from-Glide project seeded)');
      return;
    }
    const glideOriginal = await prisma.payrollEntry.create({
      data: {
        repId: testRepId,
        projectId: glideProj.id,
        amountCents: 80_000,
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Paid',
        date: '2026-01-10',
      },
    });
    try {
      const res = await POST(mkRequest({
        repId: testRepId,
        projectId: glideProj.id,
        amount: -800,
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Draft',
        date: '2026-04-20',
        isChargeback: true,
        chargebackOfId: glideOriginal.id,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      createdIds.push(body.id);
      expect(body.isChargeback).toBe(true);
    } finally {
      await prisma.payrollEntry.delete({ where: { id: glideOriginal.id } });
    }
  });

  it('still blocks implicit negative entries on imported projects (no isChargeback flag)', async () => {
    const glideProj = await prisma.project.findFirst({ where: { importedFromGlide: true } });
    if (!glideProj) {
      console.log('(skip: no imported-from-Glide project seeded)');
      return;
    }
    const res = await POST(mkRequest({
      repId: testRepId,
      projectId: glideProj.id,
      amount: -500,
      type: 'Deal',
      paymentStage: 'M1',
      status: 'Draft',
      date: '2026-04-20',
      // no isChargeback flag
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/imported/i);
  });

  it('non-admin cannot create chargeback (RBAC)', async () => {
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: rep.clerkUserId ?? 'y' } as never);
    vi.mocked(currentUser).mockResolvedValue({
      id: rep.clerkUserId ?? 'y',
      emailAddresses: [{ emailAddress: rep.email }],
    } as never);

    try {
      const res = await POST(mkRequest({
        repId: testRepId,
        projectId: testProjectId,
        amount: -500,
        type: 'Deal',
        paymentStage: 'M1',
        status: 'Draft',
        date: '2026-04-20',
        isChargeback: true,
        chargebackOfId: originalEntryId,
      }));
      expect(res.status).toBe(403);
    } finally {
      // Restore admin mock.
      const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
      vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
      vi.mocked(currentUser).mockResolvedValue({
        id: admin.clerkUserId ?? 'x',
        emailAddresses: [{ emailAddress: admin.email }],
      } as never);
    }
  });
});
