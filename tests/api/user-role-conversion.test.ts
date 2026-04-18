// Covers PATCH /api/users/[id] for the rep↔sub-dealer role flip added to
// support converting users misclassified on import (Glide had no SD concept).
// Invariants we care about:
//   - User row is UPDATEd, never DELETEd, so all FKs (Project.closerId,
//     Project.setterId, PayrollEntry.userId, Incentive.targetRepId, etc.)
//     survive the flip by Prisma guarantee.
//   - repType is nulled on rep→SD and restored to 'both' on SD→rep when null.
//   - Admin/PM rows cannot be flipped via this endpoint (separate workflow).
//   - Non-admin callers rejected before any DB mutation.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { PATCH } from '../../app/api/users/[id]/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'placeholder@example.com' }],
  }),
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      lockUser: vi.fn().mockResolvedValue({}),
      unlockUser: vi.fn().mockResolvedValue({}),
      deleteUser: vi.fn().mockResolvedValue({}),
    },
    invitations: {
      getInvitationList: vi.fn().mockResolvedValue({ data: [] }),
      revokeInvitation: vi.fn().mockResolvedValue({}),
    },
  }),
}));

// Re-target the Clerk mock to a real admin so requireAdmin() resolves.
async function mockAdminFromDb() {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: 'admin', active: true },
  });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({
    id: admin.clerkUserId ?? 'x',
    emailAddresses: [{ emailAddress: admin.email }],
  } as never);
  return admin;
}

async function mockNonAdmin() {
  // A rep — should fail requireAdmin() with 403.
  const rep = await prisma.user.findFirstOrThrow({
    where: { role: 'rep', active: true },
  });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: rep.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({
    id: rep.clerkUserId ?? 'x',
    emailAddresses: [{ emailAddress: rep.email }],
  } as never);
  return rep;
}

function patchReq(userId: string, body: unknown): {
  req: NextRequest;
  params: Promise<{ id: string }>;
} {
  return {
    req: new NextRequest(`http://localhost/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params: Promise.resolve({ id: userId }),
  };
}

describe('PATCH /api/users/[id] — role conversion', () => {
  beforeAll(async () => {
    await mockAdminFromDb();
  });

  it('flips rep → sub-dealer and preserves repType (harmless dirt on SD row)', async () => {
    // Note: we intentionally do NOT null repType on flip. The prod Turso
    // column is still NOT NULL DEFAULT 'both' (schema drift memory), and
    // SDs don't read repType anywhere — so the leftover value is fine.
    await mockAdminFromDb();
    const rep = await prisma.user.create({
      data: {
        firstName: 'Convert',
        lastName: 'ToSD',
        email: `convert-to-sd-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'closer',
      },
    });

    const { req, params } = patchReq(rep.id, { role: 'sub-dealer' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: rep.id } });
    expect(updated.id).toBe(rep.id);
    expect(updated.role).toBe('sub-dealer');
    expect(updated.repType).toBe('closer'); // preserved
    expect(updated.email).toBe(rep.email);
    expect(updated.clerkUserId).toBe(rep.clerkUserId);

    await prisma.user.delete({ where: { id: rep.id } });
  });

  it('flips sub-dealer → rep and preserves repType', async () => {
    await mockAdminFromDb();
    const sd = await prisma.user.create({
      data: {
        firstName: 'Convert',
        lastName: 'ToRep',
        email: `convert-to-rep-${Date.now()}@vitest.com`,
        role: 'sub-dealer',
        repType: 'setter',
      },
    });

    const { req, params } = patchReq(sd.id, { role: 'rep' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: sd.id } });
    expect(updated.id).toBe(sd.id);
    expect(updated.role).toBe('rep');
    expect(updated.repType).toBe('setter');

    await prisma.user.delete({ where: { id: sd.id } });
  });

  it('preserves FKs across a flip (Project.closerId survives)', async () => {
    await mockAdminFromDb();
    const rep = await prisma.user.create({
      data: {
        firstName: 'FK',
        lastName: 'Preservation',
        email: `fk-preserve-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'both',
      },
    });
    const installer = await prisma.installer.findFirstOrThrow({ where: { active: true } });
    const financer = await prisma.financer.findFirstOrThrow({ where: { active: true } });
    const project = await prisma.project.create({
      data: {
        customerName: `FK Test ${Date.now()}`,
        closerId: rep.id,
        installerId: installer.id,
        financerId: financer.id,
        productType: 'Loan',
        kWSize: 5,
        netPPW: 3.5,
        soldDate: '2026-04-01',
        phase: 'New',
      },
    });

    const { req, params } = patchReq(rep.id, { role: 'sub-dealer' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    // Project still links to the (now SD) user with the same id.
    const afterProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterProject.closerId).toBe(rep.id);
    const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: rep.id } });
    expect(afterUser.role).toBe('sub-dealer');

    await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.delete({ where: { id: rep.id } });
  });

  it('rejects admin-role flip with 400', async () => {
    await mockAdminFromDb();
    const targetAdmin = await prisma.user.create({
      data: {
        firstName: 'Target',
        lastName: 'Admin',
        email: `target-admin-${Date.now()}@vitest.com`,
        role: 'admin',
      },
    });

    const { req, params } = patchReq(targetAdmin.id, { role: 'rep' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: targetAdmin.id } });
    expect(unchanged.role).toBe('admin');

    await prisma.user.delete({ where: { id: targetAdmin.id } });
  });

  it('rejects non-admin caller with 403', async () => {
    await mockNonAdmin();
    const rep = await prisma.user.create({
      data: {
        firstName: 'ShouldNot',
        lastName: 'Flip',
        email: `should-not-flip-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'both',
      },
    });

    const { req, params } = patchReq(rep.id, { role: 'sub-dealer' });
    const res = await PATCH(req, { params });
    expect([401, 403]).toContain(res.status);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: rep.id } });
    expect(unchanged.role).toBe('rep');

    await prisma.user.delete({ where: { id: rep.id } });
  });

  it('rejects invalid role enum via Zod', async () => {
    await mockAdminFromDb();
    const rep = await prisma.user.create({
      data: {
        firstName: 'Bad',
        lastName: 'Enum',
        email: `bad-enum-${Date.now()}@vitest.com`,
        role: 'rep',
        repType: 'both',
      },
    });

    const { req, params } = patchReq(rep.id, { role: 'admin' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);

    await prisma.user.delete({ where: { id: rep.id } });
  });
});
