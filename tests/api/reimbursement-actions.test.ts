// Covers the reimbursement admin actions added in Batch 3:
//   - PATCH /api/reimbursements/[id] accepts status + archived
//   - DELETE /api/reimbursements/[id] removes the row
//   - Reset-to-pending transition works
//
// File upload (/receipt endpoint) is exercised separately via E2E since
// it depends on Vercel Blob infra; here we confirm the Zod schema and
// DB mutation layers are correct.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { PATCH, DELETE } from '../../app/api/reimbursements/[id]/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'placeholder@example.com' }],
  }),
  clerkClient: vi.fn().mockResolvedValue({}),
}));

// @vercel/blob — the DELETE handler calls deleteBlob when a receiptUrl
// exists. Mock it so tests don't hit the network.
vi.mock('@vercel/blob', () => ({
  del: vi.fn().mockResolvedValue(undefined),
  put: vi.fn(),
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

async function mockRep() {
  const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: rep.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({
    id: rep.clerkUserId ?? 'x',
    emailAddresses: [{ emailAddress: rep.email }],
  } as never);
  return rep;
}

function patchReq(reimbursementId: string, body: unknown) {
  return {
    req: new NextRequest(`http://localhost/api/reimbursements/${reimbursementId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params: Promise.resolve({ id: reimbursementId }),
  };
}

async function createTestReimbursement(repId: string) {
  return prisma.reimbursement.create({
    data: {
      repId,
      amountCents: 12500,
      description: 'Gas — test',
      date: '2026-04-01',
      status: 'Pending',
    },
  });
}

describe('PATCH /api/reimbursements/[id] — admin actions', () => {
  beforeAll(async () => { await mockAdmin(); });

  it('approves a pending reimbursement', async () => {
    await mockAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);

    const { req, params } = patchReq(reimb.id, { status: 'Approved' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updated = await prisma.reimbursement.findUniqueOrThrow({ where: { id: reimb.id } });
    expect(updated.status).toBe('Approved');

    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });

  it('resets an approved reimbursement back to pending', async () => {
    await mockAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);
    await prisma.reimbursement.update({ where: { id: reimb.id }, data: { status: 'Approved' } });

    const { req, params } = patchReq(reimb.id, { status: 'Pending' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);
    const updated = await prisma.reimbursement.findUniqueOrThrow({ where: { id: reimb.id } });
    expect(updated.status).toBe('Pending');

    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });

  it('archives a reimbursement (soft) and unarchives it', async () => {
    await mockAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);

    const ar = patchReq(reimb.id, { archived: true });
    const archive = await PATCH(ar.req, { params: ar.params });
    expect(archive.status).toBe(200);
    let row = await prisma.reimbursement.findUniqueOrThrow({ where: { id: reimb.id } });
    expect(row.archivedAt).not.toBeNull();

    const un = patchReq(reimb.id, { archived: false });
    const unarchive = await PATCH(un.req, { params: un.params });
    expect(unarchive.status).toBe(200);
    row = await prisma.reimbursement.findUniqueOrThrow({ where: { id: reimb.id } });
    expect(row.archivedAt).toBeNull();

    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });

  it('rejects PATCH with no fields to update', async () => {
    await mockAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);

    const { req, params } = patchReq(reimb.id, {});
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);

    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });

  it('rejects non-admin caller with 403', async () => {
    await mockRep();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);

    const { req, params } = patchReq(reimb.id, { status: 'Approved' });
    const res = await PATCH(req, { params });
    expect([401, 403]).toContain(res.status);

    // cleanup needs admin
    await mockAdmin();
    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });
});

describe('DELETE /api/reimbursements/[id] — hard delete', () => {
  it('removes the row', async () => {
    await mockAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);

    const req = new NextRequest(`http://localhost/api/reimbursements/${reimb.id}`, { method: 'DELETE' });
    const params = Promise.resolve({ id: reimb.id });
    const res = await DELETE(req, { params });
    expect(res.status).toBe(200);

    const lookup = await prisma.reimbursement.findUnique({ where: { id: reimb.id } });
    expect(lookup).toBeNull();
  });

  it('rejects non-admin caller', async () => {
    await mockRep();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const reimb = await createTestReimbursement(rep.id);

    const req = new NextRequest(`http://localhost/api/reimbursements/${reimb.id}`, { method: 'DELETE' });
    const params = Promise.resolve({ id: reimb.id });
    const res = await DELETE(req, { params });
    expect([401, 403]).toContain(res.status);

    await mockAdmin();
    await prisma.reimbursement.delete({ where: { id: reimb.id } });
  });
});
