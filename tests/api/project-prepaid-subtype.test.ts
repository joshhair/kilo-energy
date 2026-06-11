// PATCH /api/projects/[id] — prepaidSubType support (F1, 2026-06-10).
//
// Rebekah's report: "When editing the project, it doesn't let me choose a
// prepaid option." Three gaps stacked: the Edit modal UI never offered the
// installer prepaid options, the patch schema (.strict()) REJECTED the field
// outright, and the route had no data mapping for it. This file locks in the
// API half: the schema accepts prepaidSubType, a value persists, and an empty
// string clears the column to null (symmetric with the create route's
// `body.prepaidSubType ?? null`).

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { PATCH } from '../../app/api/projects/[id]/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'placeholder@example.com' }],
  }),
  clerkClient: vi.fn().mockResolvedValue({}),
}));

async function mockAdmin() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({
    id: admin.clerkUserId ?? 'x',
    emailAddresses: [{ emailAddress: admin.email }],
  } as never);
  return admin;
}

function patchReq(projectId: string, body: unknown) {
  return {
    req: new NextRequest(`http://localhost/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params: Promise.resolve({ id: projectId }),
  };
}

async function createTestProject() {
  const installer = await prisma.installer.findFirstOrThrow({ where: { active: true } });
  const financer = await prisma.financer.findFirstOrThrow({ where: { active: true } });
  const closer = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
  return prisma.project.create({
    data: {
      customerName: 'Prepaid PATCH Test — Vitest',
      closerId: closer.id,
      installerId: installer.id,
      financerId: financer.id,
      productType: 'Loan',
      kWSize: 7.2,
      netPPW: 3.1,
      soldDate: '2026-06-01',
      phase: 'New',
    },
  });
}

describe('PATCH /api/projects/[id] — prepaidSubType', () => {
  it('sets a prepaid sub-type on an existing deal', async () => {
    await mockAdmin();
    const project = await createTestProject();
    try {
      const { req, params } = patchReq(project.id, { prepaidSubType: 'HDM' });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(200);
      const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(row.prepaidSubType).toBe('HDM');
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it('clears the prepaid sub-type when an empty string is sent', async () => {
    await mockAdmin();
    const project = await createTestProject();
    try {
      await prisma.project.update({ where: { id: project.id }, data: { prepaidSubType: 'PE' } });
      const { req, params } = patchReq(project.id, { prepaidSubType: '' });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(200);
      const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(row.prepaidSubType).toBeNull();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it('leaves prepaidSubType untouched when the field is omitted', async () => {
    await mockAdmin();
    const project = await createTestProject();
    try {
      await prisma.project.update({ where: { id: project.id }, data: { prepaidSubType: 'HDM' } });
      const { req, params } = patchReq(project.id, { notes: 'unrelated edit' });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(200);
      const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(row.prepaidSubType).toBe('HDM');
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
