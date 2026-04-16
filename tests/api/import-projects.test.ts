// Synthetic Glide-import rehearsal. Proves the /api/import/projects
// dry-run path still accepts Glide-shape payloads and correctly
// resolves FK lookups (closerEmail → User.id, installerName → Installer.id,
// etc.) after the cents migration. Runs against the seeded dev DB.
//
// We deliberately stay in dry-run mode (`commit: false`) — this test
// verifies shape and resolution, not mutation. A separate manual run
// with `commit: true` against a scratch Turso branch is the true staging
// rehearsal; that gate is unblocked by Josh supplying a sample Glide
// export.

import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../../lib/db';
import { POST } from '../../app/api/import/projects/route';
import { NextRequest } from 'next/server';

// Mock Clerk so the admin guard passes.
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'admin@kiloenergies.com' }],
  }),
}));

describe('POST /api/import/projects — Glide import dry-run', () => {
  it('validates a well-formed Glide-shape payload and reports wouldCreate', async () => {
    // Pick a real admin (the /api/import requires admin) so requireAdmin resolves.
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: 'admin', active: true },
    });
    const closer = await prisma.user.findFirstOrThrow({
      where: { role: 'rep', active: true },
    });
    const installer = await prisma.installer.findFirstOrThrow({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
    const financer = await prisma.financer.findFirstOrThrow({
      where: { active: true, NOT: { name: 'Cash' } },
      orderBy: { name: 'asc' },
    });

    // Swap the Clerk mock to this admin.
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: admin.clerkUserId ?? 'x' } as never);
    vi.mocked(currentUser).mockResolvedValue({
      id: admin.clerkUserId ?? 'x',
      emailAddresses: [{ emailAddress: admin.email }],
    } as never);

    const body = {
      commit: false,
      projects: [
        {
          customerName: 'Glide Rehearsal Smith',
          closerEmail: closer.email,
          setterEmail: null,
          subDealerEmail: null,
          installerName: installer.name,
          financerName: financer.name,
          soldDate: '2026-04-01',
          productType: 'Loan',
          kWSize: 8.4,
          netPPW: 3.55,
          phase: 'Installed',
          m1Amount: 1890.01,
          m2Amount: 1890.02,
          m3Amount: 472.51,
          setterM2Amount: 0,
          setterM3Amount: null,
          m1Paid: true,
          m2Paid: true,
          m3Paid: false,
          notes: 'Glide import rehearsal',
          flagged: false,
          leadSource: 'door_knock',
        },
        {
          // Bad row — unknown installer. Tests resolver error path.
          customerName: 'Glide Rehearsal Unknown',
          closerEmail: closer.email,
          installerName: 'NotARealInstaller',
          financerName: financer.name,
          soldDate: '2026-04-01',
          productType: 'Loan',
          kWSize: 5,
          netPPW: 3.5,
          phase: 'New',
        },
      ],
    };

    const req = new NextRequest('http://localhost/api/import/projects', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();

    expect(payload.dryRun).toBe(true);
    expect(payload.total).toBe(2);
    expect(payload.wouldCreate.length).toBe(1);
    expect(payload.wouldCreate[0].row.customerName).toBe('Glide Rehearsal Smith');
    expect(payload.wouldError.length).toBe(1);
    expect(payload.wouldError[0].errors[0]).toMatch(/installerName.*not found/);
  });
});
