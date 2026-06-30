// POST /api/devices — the native app registers its iOS APNs token. Stored as an
// 'apns' PushSubscription (provider + nativeToken) so the existing notification
// fan-out + dead-token GC handle it. Upsert by a namespaced endpoint is idempotent.

import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/db';
import { POST } from '../../app/api/devices/route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'x' }),
  currentUser: vi.fn().mockResolvedValue({ id: 'x', emailAddresses: [{ emailAddress: 'x@example.com' }] }),
  clerkClient: vi.fn().mockResolvedValue({}),
}));

async function mockUser() {
  const u = await prisma.user.findFirstOrThrow({ where: { active: true, clerkUserId: { not: null } } });
  const { auth, currentUser } = await import('@clerk/nextjs/server');
  vi.mocked(auth).mockResolvedValue({ userId: u.clerkUserId ?? 'x' } as never);
  vi.mocked(currentUser).mockResolvedValue({ id: u.clerkUserId ?? 'x', emailAddresses: [{ emailAddress: u.email }] } as never);
  return u;
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/devices', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/devices', () => {
  it('stores an iOS APNs token as an apns PushSubscription (idempotent upsert)', async () => {
    const user = await mockUser();
    const token = `vitest-apns-${user.id.slice(0, 6)}-token`;
    const endpoint = `apns:${token}`;
    try {
      const res = await POST(postReq({ token, platform: 'ios' }));
      expect(res.status).toBe(200);
      const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
      expect(sub).not.toBeNull();
      expect(sub!.provider).toBe('apns');
      expect(sub!.nativeToken).toBe(token);
      expect(sub!.userId).toBe(user.id);

      // Re-registering the same token is a no-op upsert (no duplicate row).
      const res2 = await POST(postReq({ token, platform: 'ios' }));
      expect(res2.status).toBe(200);
      const count = await prisma.pushSubscription.count({ where: { endpoint } });
      expect(count).toBe(1);
    } finally {
      await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    }
  });

  it('rejects a missing token (zod 400)', async () => {
    await mockUser();
    const res = await POST(postReq({ platform: 'ios' }));
    expect(res.status).toBe(400);
  });
});
