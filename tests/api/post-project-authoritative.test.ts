// POST /api/projects — server-authoritative commission + admin-gating of money
// config (2026-06). Locks in the security fix from the POST-authoritative review:
// a non-admin caller must NOT be able to craft baselineOverrideJson / noChainTrainer
// / a per-project trainer override to inflate the authoritative commission. Mirrors
// PATCH's PM/REP_BLOCKED_FIELDS. Admin callers stay trusted.

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { POST } from '../../app/api/projects/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'x' }),
  currentUser: vi.fn().mockResolvedValue({ id: 'x', emailAddresses: [{ emailAddress: 'x@example.com' }] }),
  clerkClient: vi.fn().mockResolvedValue({}),
}));
// Deal-submitted emails are best-effort side effects — stub so the test stays
// hermetic (we're asserting persisted money config, not email delivery).
vi.mock('../../lib/notifications/service', () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/handoff-service', () => ({ sendInstallerHandoff: vi.fn().mockResolvedValue(undefined) }));

async function mockUser(role: 'admin' | 'rep') {
  const u = await prisma.user.findFirstOrThrow({ where: { role, active: true, clerkUserId: { not: null } } });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: u.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({ id: u.clerkUserId ?? 'x', emailAddresses: [{ emailAddress: u.email }] } as never);
  return u;
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/projects', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

async function baseDealBody(closerId: string) {
  const installer = await prisma.installer.findFirstOrThrow({ where: { active: true, name: { not: 'SolarTech' } } });
  const financer = await prisma.financer.findFirstOrThrow({ where: { active: true } });
  return {
    customerName: 'POST-auth security test — vitest', closerId, setterId: null, soldDate: '2026-06-01',
    installerId: installer.id, financerId: financer.id, productType: 'Loan', kWSize: 7.2, netPPW: 3.1, phase: 'New',
  };
}

describe('POST /api/projects — admin-gating of money config', () => {
  it('STRIPS baselineOverrideJson / noChainTrainer / trainer override from a non-admin', async () => {
    const rep = await mockUser('rep');
    const body = await baseDealBody(rep.id);
    const res = await POST(postReq({
      ...body,
      baselineOverrideJson: JSON.stringify({ closerPerW: 99, kiloPerW: 0 }), // crafted to inflate
      noChainTrainer: true,
      trainerId: rep.id,
      trainerRate: 5,
      m1Amount: 99999, m2Amount: 99999, m3Amount: 99999, // arbitrary client amounts
    }));
    expect(res.status).toBe(201);
    const created = await res.json();
    try {
      const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      // All admin-only money config was ignored for the non-admin caller:
      expect(row.baselineOverrideJson).toBeNull();
      expect(row.noChainTrainer).toBe(false);
      expect(row.trainerId).toBeNull();
      expect(row.trainerRate).toBeNull();
      // Amounts are server-derived, NOT the arbitrary client values (even if the
      // recompute fell back — non-admin never keeps client amounts).
      expect(row.m1AmountCents).not.toBe(9999900);
      expect(row.m2AmountCents).not.toBe(9999900);
    } finally {
      await prisma.project.delete({ where: { id: created.id } });
    }
  });

  it('does NOT let a non-admin use subDealerId to skip the recompute (bypass closed)', async () => {
    const rep = await mockUser('rep');
    const body = await baseDealBody(rep.id);
    // A rep attaches a subDealerId (their own id is a valid user FK) hoping to hit
    // the sub-dealer bypass and keep arbitrary amounts — but role !== 'sub-dealer'
    // so it's NOT trusted; the recompute runs and the client amounts are discarded.
    const res = await POST(postReq({ ...body, subDealerId: rep.id, m1Amount: 99999, m2Amount: 99999 }));
    expect(res.status).toBe(201);
    const created = await res.json();
    try {
      const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.m1AmountCents).not.toBe(9999900); // server-derived, not the client value
    } finally {
      await prisma.project.delete({ where: { id: created.id } });
    }
  });

  it('HONORS an admin baseline override (admin is trusted)', async () => {
    await mockUser('admin'); // sets the auth mock; the deal's closer is a separate rep
    const closer = await prisma.user.findFirstOrThrow({ where: { role: 'rep', active: true, clerkUserId: { not: null } } });
    const body = await baseDealBody(closer.id);
    const override = JSON.stringify({ closerPerW: 1.5, kiloPerW: 0.5, setterPerW: 0 });
    const res = await POST(postReq({ ...body, baselineOverrideJson: override, noChainTrainer: true }));
    expect(res.status).toBe(201);
    const created = await res.json();
    try {
      const row = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.baselineOverrideJson).toBe(override); // admin override persisted
      expect(row.noChainTrainer).toBe(true);            // admin chain-clear persisted
    } finally {
      await prisma.project.delete({ where: { id: created.id } });
    }
  });
});
