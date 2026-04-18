// Covers the payroll status-transition policy exposed by
// PATCH /api/payroll/[id]. The key change in Batch 4 is the reverse
// Pending → Draft transition, admin-only. Paid is still terminal.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { PATCH } from '../../app/api/payroll/[id]/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'placeholder' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'placeholder',
    emailAddresses: [{ emailAddress: 'placeholder@example.com' }],
  }),
  clerkClient: vi.fn().mockResolvedValue({}),
}));

async function asAdmin() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({
    id: admin.clerkUserId ?? 'x',
    emailAddresses: [{ emailAddress: admin.email }],
  } as never);
  return admin;
}

async function createEntry(repId: string, status: 'Draft' | 'Pending' | 'Paid' = 'Draft') {
  return prisma.payrollEntry.create({
    data: {
      repId,
      amountCents: 50000,
      type: 'Bonus',
      paymentStage: 'Bonus',
      status,
      date: '2026-04-01',
      notes: 'test',
    },
  });
}

function patchReq(id: string, body: unknown) {
  return {
    req: new NextRequest(`http://localhost/api/payroll/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params: Promise.resolve({ id }),
  };
}

describe('PATCH /api/payroll/[id] — status transitions (Batch 4 adds reverse)', () => {
  beforeAll(async () => { await asAdmin(); });

  it('Draft → Pending succeeds', async () => {
    await asAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const entry = await createEntry(rep.id, 'Draft');
    const { req, params } = patchReq(entry.id, { status: 'Pending' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);
    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('Pending → Draft succeeds (reverse — new in Batch 4)', async () => {
    await asAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const entry = await createEntry(rep.id, 'Pending');
    const { req, params } = patchReq(entry.id, { status: 'Draft' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);
    const row = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.status).toBe('Draft');
    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('Pending → Paid succeeds', async () => {
    await asAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const entry = await createEntry(rep.id, 'Pending');
    const { req, params } = patchReq(entry.id, { status: 'Paid' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);
    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('Paid → Pending rejected (422 — money already disbursed)', async () => {
    await asAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const entry = await createEntry(rep.id, 'Paid');
    const { req, params } = patchReq(entry.id, { status: 'Pending' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(422);
    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('Draft → Paid rejected (skip-a-state, 422)', async () => {
    await asAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const entry = await createEntry(rep.id, 'Draft');
    const { req, params } = patchReq(entry.id, { status: 'Paid' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(422);
    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });

  it('amount / date / notes edits are allowed without status change', async () => {
    await asAdmin();
    const rep = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true } });
    const entry = await createEntry(rep.id, 'Draft');
    const { req, params } = patchReq(entry.id, { amount: 75.25, notes: 'updated', date: '2026-04-15' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);
    const row = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.amountCents).toBe(7525);
    expect(row.notes).toBe('updated');
    expect(row.date).toBe('2026-04-15');
    await prisma.payrollEntry.delete({ where: { id: entry.id } });
  });
});
