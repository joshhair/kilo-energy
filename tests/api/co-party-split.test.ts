// POST /api/projects — coPartySplit:'even' server-side co-party split (2026-06).
// iOS keeps commission math server-authoritative, so it can't compute each
// co-closer/co-setter's M1/M2/M3 in the browser the way the web does — it would
// have to submit them at $0 and those people would be paid nothing. With
// coPartySplit:'even' the SERVER divides each milestone's pool evenly among
// (primary + co-parties), exactly like the web's "Split equally" button.
//
// The invariants under test:
//   1. each co-closer is NON-ZERO (the bug we're fixing),
//   2. co-closers are equal to each other (even split),
//   3. primary + all co-closers === the pool (no money created or lost),
//   4. it works for a NON-ADMIN (rep) caller — the iOS scenario.

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { POST } from '../../app/api/projects/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'x' }),
  currentUser: vi.fn().mockResolvedValue({ id: 'x', emailAddresses: [{ emailAddress: 'x@example.com' }] }),
  clerkClient: vi.fn().mockResolvedValue({}),
}));
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

async function baseDealBody(closerId: string, customerName: string) {
  const installer = await prisma.installer.findFirstOrThrow({ where: { active: true, name: { not: 'SolarTech' } } });
  const financer = await prisma.financer.findFirstOrThrow({ where: { active: true } });
  return {
    customerName, closerId, setterId: null, soldDate: '2026-06-01',
    installerId: installer.id, financerId: financer.id, productType: 'Loan', kWSize: 7.2, netPPW: 3.1, phase: 'New',
  };
}

describe('POST /api/projects — coPartySplit:even', () => {
  it('splits the pool evenly across primary + co-closers, cent-exact, all non-zero (rep caller)', async () => {
    const primary = await mockUser('rep'); // non-admin — the iOS scenario
    // Co-parties only need to be valid user FKs (not Clerk-linked callers).
    const others = await prisma.user.findMany({ where: { active: true, id: { not: primary.id } }, take: 2 });
    expect(others.length).toBe(2);
    const [co1, co2] = others;

    const ids: string[] = [];
    try {
      // Reference deal — no co-parties — to learn the closer pool (pool M1).
      const refRes = await POST(postReq(await baseDealBody(primary.id, 'co-party split ref — vitest')));
      expect(refRes.status).toBe(201);
      const ref = await refRes.json(); ids.push(ref.id);
      const refRow = await prisma.project.findUniqueOrThrow({ where: { id: ref.id } });
      const poolM1 = refRow.m1AmountCents;
      expect(poolM1).toBeGreaterThan(0); // a real deal has a non-zero pool

      // Even-split deal — same inputs + 2 co-closers, NO amounts sent.
      const evenRes = await POST(postReq({
        ...(await baseDealBody(primary.id, 'co-party split even — vitest')),
        additionalClosers: [{ userId: co1.id }, { userId: co2.id }],
        coPartySplit: 'even',
      }));
      expect(evenRes.status).toBe(201);
      const even = await evenRes.json(); ids.push(even.id);
      const evenRow = await prisma.project.findUniqueOrThrow({ where: { id: even.id } });
      const coRows = await prisma.projectCloser.findMany({ where: { projectId: even.id }, orderBy: { position: 'asc' } });

      expect(coRows).toHaveLength(2);
      // (1) non-zero — the bug being fixed. (2) equal to each other — even split.
      expect(coRows[0].m1AmountCents).toBeGreaterThan(0);
      expect(coRows[0].m1AmountCents).toBe(coRows[1].m1AmountCents);
      // (3) money conserved: primary + both co-closers === the pool, to the cent.
      expect(evenRow.m1AmountCents + coRows[0].m1AmountCents + coRows[1].m1AmountCents).toBe(poolM1);
      // primary holds the trailing-cent remainder, so it's >= each co-closer.
      expect(evenRow.m1AmountCents).toBeGreaterThanOrEqual(coRows[0].m1AmountCents);
    } finally {
      for (const id of ids) {
        await prisma.projectCloser.deleteMany({ where: { projectId: id } }).catch(() => {});
        await prisma.project.delete({ where: { id } }).catch(() => {});
      }
    }
  });

  it("still honors EXPLICIT co-party amounts (the web path is unchanged)", async () => {
    await mockUser('admin'); // admin caller — explicit amounts are trusted
    const others = await prisma.user.findMany({ where: { role: 'rep', active: true, clerkUserId: { not: null } }, take: 1 });
    const co1 = others[0];
    const ids: string[] = [];
    try {
      const res = await POST(postReq({
        ...(await baseDealBody(co1.id, 'co-party split explicit — vitest')),
        additionalClosers: [{ userId: co1.id, m1Amount: 100, m2Amount: 50, m3Amount: 0 }],
        // coPartySplit omitted → defaults to 'explicit'
      }));
      expect(res.status).toBe(201);
      const created = await res.json(); ids.push(created.id);
      const coRows = await prisma.projectCloser.findMany({ where: { projectId: created.id } });
      expect(coRows).toHaveLength(1);
      // Explicit $100 persisted verbatim (admin is trusted; not overwritten by a split).
      expect(coRows[0].m1AmountCents).toBe(10000);
      expect(coRows[0].m2AmountCents).toBe(5000);
    } finally {
      for (const id of ids) {
        await prisma.projectCloser.deleteMany({ where: { projectId: id } }).catch(() => {});
        await prisma.project.delete({ where: { id } }).catch(() => {});
      }
    }
  });
});
