// Regression test for the 2026-05-29 incident: editing a project whose
// financer (or installer) was later archived returned 400 "Financer is
// archived", because the edit modal re-sends the current financer name on
// every save. The fix allows re-sending an already-set (since-archived)
// financer/installer; it only rejects CHANGING to an archived one.

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
import { PATCH } from '@/app/api/projects/[id]/route';

describe('PATCH /api/projects/[id] — archived financer/installer guard', () => {
  let projectId: string;
  let archivedFinancerId: string;
  let archivedFinancerName: string;
  let otherArchivedFinancerName: string;
  let activeInstallerId: string;
  const createdFinancerIds: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
    const installer = await prisma.installer.findFirstOrThrow({ where: { active: true } });
    activeInstallerId = installer.id;

    const arch = await prisma.financer.create({ data: { name: `__ArchTest_${Date.now()}`, active: false } });
    archivedFinancerId = arch.id; archivedFinancerName = arch.name; createdFinancerIds.push(arch.id);
    const arch2 = await prisma.financer.create({ data: { name: `__ArchTest2_${Date.now()}`, active: false } });
    otherArchivedFinancerName = arch2.name; createdFinancerIds.push(arch2.id);

    const project = await prisma.project.create({
      data: {
        customerName: 'Archived Financer — Vitest',
        closerId: admin.id,
        installerId: activeInstallerId,
        financerId: archivedFinancerId, // already uses the (now) archived financer
        productType: 'PPA', kWSize: 5.0, netPPW: 3.5, soldDate: '2026-04-01', phase: 'PTO',
      },
    });
    projectId = project.id;

    const { auth, currentUser } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: admin.clerkUserId ?? 'x', emailAddresses: [{ emailAddress: admin.email }] } as never);
  });

  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
    if (createdFinancerIds.length) await prisma.financer.deleteMany({ where: { id: { in: createdFinancerIds } } });
  });

  function mkPatch(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/projects/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify(body),
    });
  }

  it('allows editing a deal that already uses a since-archived financer (re-sent unchanged)', async () => {
    const res = await PATCH(mkPatch({ flagged: true, financer: archivedFinancerName }), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(200);
  });

  it('still rejects CHANGING a deal to a different archived financer', async () => {
    const res = await PATCH(mkPatch({ flagged: true, financer: otherArchivedFinancerName }), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error).toLowerCase()).toContain('archived');
  });
});
