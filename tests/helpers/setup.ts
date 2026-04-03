/**
 * Test setup helpers.
 *
 * For API integration tests, we mock Clerk auth and use the real Prisma + SQLite DB.
 * Tests that need the DB should use the seeded dev.db (run `npx prisma db seed` first).
 */
import { vi } from 'vitest';

/**
 * Mock Clerk auth module so API routes don't require real authentication.
 * Call this in a beforeAll() or at the top of an API test file.
 */
export function mockClerkAuth(opts?: { userId?: string; email?: string; role?: string }) {
  const userId = opts?.userId ?? 'test-clerk-user-id';
  const email = opts?.email ?? 'josh@kiloenergies.com';

  vi.mock('@clerk/nextjs/server', () => ({
    auth: vi.fn().mockResolvedValue({ userId }),
    currentUser: vi.fn().mockResolvedValue({
      id: userId,
      emailAddresses: [{ emailAddress: email }],
    }),
  }));
}

/**
 * Build a minimal NextRequest-like object for route handler testing.
 */
export function buildRequest(body?: Record<string, unknown>, method = 'POST') {
  return {
    method,
    json: async () => body ?? {},
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'http://localhost:3000/api/test',
  } as unknown as Request;
}
