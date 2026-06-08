// Regression test for the 2026-06-05 change: a deal can be attached to a blitz
// it ORIGINATED on even when it CLOSED outside the blitz date window. Kilo
// attributes closed deals to the blitz that produced them; those deals routinely
// close after the blitz ends, so the sold date must NOT gate attachment.
//   - Bryce (2026-06-02): "date sold is out of the Blitz window" blocked submit.
//   - Josh  (2026-05-23): same error blocked attaching a project to a blitz.
// Per Josh: drop the window gate, and keep manual attachments durable when a
// blitz's dates are later edited (no silent unlink).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'admin@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { PATCH as patchBlitz } from '@/app/api/blitzes/[id]/route';

describe('Blitz attach — sold date outside the window', () => {
  let blitzId: string;
  let attachTargetId: string; // created unattached, attached via PATCH in a test
  let durableProjectId: string; // pre-attached, used for the no-unlink test
  let activeInstallerId: string;
  let activeFinancerId: string;
  let adminId: string;

  beforeAll(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
    const installer = await prisma.installer.findFirstOrThrow({ where: { active: true } });
    const financer = await prisma.financer.findFirstOrThrow({ where: { active: true } });
    adminId = admin.id;
    activeInstallerId = installer.id;
    activeFinancerId = financer.id;

    // A short, already-finished blitz window: 2026-04-01 .. 2026-04-03.
    const blitz = await prisma.blitz.create({
      data: {
        name: `__WindowAttachTest_${Date.now()}`,
        startDate: '2026-04-01',
        endDate: '2026-04-03',
        status: 'completed',
        createdById: adminId,
        ownerId: adminId,
      },
    });
    blitzId = blitz.id;

    // Closer-on-blitz participation is still required, so approve the admin.
    await prisma.blitzParticipant.create({
      data: { blitzId, userId: adminId, joinStatus: 'approved' },
    });

    // Deal sold WELL AFTER the blitz ended — the case that used to 400.
    const target = await prisma.project.create({
      data: {
        customerName: 'Attach Target — Vitest',
        closerId: adminId,
        installerId: activeInstallerId,
        financerId: activeFinancerId,
        productType: 'Loan', kWSize: 7.0, netPPW: 3.2, soldDate: '2026-05-20', phase: 'New',
      },
    });
    attachTargetId = target.id;

    // Already-attached out-of-window deal, for the date-edit no-unlink test.
    const durable = await prisma.project.create({
      data: {
        customerName: 'Durable Attach — Vitest',
        closerId: adminId,
        installerId: activeInstallerId,
        financerId: activeFinancerId,
        productType: 'Cash', kWSize: 5.0, netPPW: 3.0, soldDate: '2026-05-20', phase: 'New',
        blitzId,
      },
    });
    durableProjectId = durable.id;

    const { auth, currentUser } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: admin.clerkUserId ?? 'x', emailAddresses: [{ emailAddress: admin.email }] } as never);
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: [attachTargetId, durableProjectId] } } }).catch(() => {});
    if (blitzId) {
      await prisma.blitzParticipant.deleteMany({ where: { blitzId } }).catch(() => {});
      await prisma.blitz.delete({ where: { id: blitzId } }).catch(() => {});
    }
  });

  function mkProjectPatch(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/projects/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    });
  }

  function mkBlitzPatch(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/blitzes/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    });
  }

  it('attaches a deal whose soldDate is after the blitz window (no 400)', async () => {
    const res = await patchProject(mkProjectPatch({ blitzId }), { params: Promise.resolve({ id: attachTargetId }) });
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(200);
    const after = await prisma.project.findUnique({ where: { id: attachTargetId }, select: { blitzId: true } });
    expect(after?.blitzId).toBe(blitzId);
  });

  it('keeps an out-of-window deal attached when the blitz dates are edited (no silent unlink)', async () => {
    // Shift the window; the durable deal (soldDate 2026-05-20) stays outside it.
    const res = await patchBlitz(mkBlitzPatch({ startDate: '2026-04-10', endDate: '2026-04-12' }), { params: Promise.resolve({ id: blitzId }) });
    expect(res.status).toBe(200);
    const after = await prisma.project.findUnique({ where: { id: durableProjectId }, select: { blitzId: true } });
    expect(after?.blitzId).toBe(blitzId);
  });
});
