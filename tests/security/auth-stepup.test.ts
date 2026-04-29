/**
 * Tests for lib/auth-stepup.ts — sensitive-op step-up authentication.
 *
 * STRIDE category: T (Tampering) — limits the blast radius of a stolen
 * session cookie by requiring fresh re-authentication for sensitive ops.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Clerk + db before importing the SUT — module-level mocks must
// be set up first so that the SUT picks them up at import time.
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
}));
vi.mock('../../lib/db', () => ({
  prisma: { user: { findFirst: vi.fn() } },
}));

import { requireFreshAdmin } from '../../lib/auth-stepup';
import { auth, currentUser } from '@clerk/nextjs/server';
import { prisma } from '../../lib/db';

const NOW_UNIX = Math.floor(Date.now() / 1000);

const mockAdminUser = {
  id: 'user_admin_test',
  firstName: 'Test',
  lastName: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  active: true,
  repType: 'both',
  clerkUserId: 'clerk_123',
  scopedInstallerId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a logged-in admin with a valid Clerk session.
  (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'clerk_123',
    sessionClaims: { auth_time: NOW_UNIX - 60 }, // 60 seconds ago = fresh
  });
  (currentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    emailAddresses: [{ emailAddress: 'admin@example.com' }],
  });
  (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdminUser);
});

describe('requireFreshAdmin', () => {
  it('returns user + freshness metadata when session is within maxAge', async () => {
    const result = await requireFreshAdmin(600);
    expect(result.user.id).toBe('user_admin_test');
    expect(result.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(result.ageSeconds).toBeLessThanOrEqual(600);
  });

  it('rejects with step_up_required when session is older than maxAge', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'clerk_123',
      sessionClaims: { auth_time: NOW_UNIX - 1200 }, // 20 minutes ago
    });

    await expect(requireFreshAdmin(600)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects with step_up_required when auth_time claim is missing', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'clerk_123',
      sessionClaims: {}, // no auth_time
    });

    await expect(requireFreshAdmin(600)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('respects custom maxAge — strict 60s threshold', async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'clerk_123',
      sessionClaims: { auth_time: NOW_UNIX - 90 }, // 90s old
    });

    await expect(requireFreshAdmin(60)).rejects.toMatchObject({ status: 401 });
    // But 120s threshold accepts the same session.
    const ok = await requireFreshAdmin(120);
    expect(ok.user.id).toBe('user_admin_test');
  });
});
