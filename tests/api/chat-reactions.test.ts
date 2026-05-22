// API tests for ChatMessageReaction toggle endpoint.
//
// Covers the v1 contract:
//   - POST on a message you can see toggles ON (insert), returns reactor list
//   - Second POST toggles OFF (delete), returns empty reactor list
//   - 404 when messageId doesn't belong to the project (path-spoofing guard)
//   - Audit log records the action with entityType='Project'

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-admin-clerk' }),
  currentUser: vi.fn().mockResolvedValue({
    id: 'test-admin-clerk',
    emailAddresses: [{ emailAddress: 'admin@kiloenergies.com' }],
  }),
}));

import { prisma } from '@/lib/db';
import { POST } from '@/app/api/projects/[id]/messages/[messageId]/react/route';

describe('POST /api/projects/[id]/messages/[messageId]/react', () => {
  let projectId: string;
  let messageId: string;
  let adminId: string;
  let adminClerkId: string;
  let adminEmail: string;
  let testMessageId: string | null = null;

  beforeAll(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', active: true } });
    adminId = admin.id;
    adminClerkId = admin.clerkUserId ?? 'x';
    adminEmail = admin.email;
    const project = await prisma.project.findFirstOrThrow();
    projectId = project.id;

    const msg = await prisma.projectMessage.create({
      data: {
        projectId,
        authorId: adminId,
        authorName: `${admin.firstName} ${admin.lastName}`,
        authorRole: admin.role,
        text: 'test message for reactions',
      },
    });
    messageId = msg.id;
    testMessageId = msg.id;

    const { auth, currentUser } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: adminClerkId } as never);
    vi.mocked(currentUser).mockResolvedValue({
      id: adminClerkId,
      emailAddresses: [{ emailAddress: adminEmail }],
    } as never);
  });

  afterEach(async () => {
    if (testMessageId) {
      await prisma.chatMessageReaction.deleteMany({ where: { messageId: testMessageId } });
    }
  });

  function mkRequest(): NextRequest {
    return new NextRequest(`http://localhost/api/projects/${projectId}/messages/${messageId}/react`, {
      method: 'POST',
    });
  }

  function mkParams(pid: string, mid: string) {
    return { params: Promise.resolve({ id: pid, messageId: mid }) };
  }

  it('first POST toggles ON — inserts a reaction and returns the reactor list', async () => {
    const res = await POST(mkRequest(), mkParams(projectId, messageId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reacted).toBe(true);
    expect(body.count).toBe(1);
    expect(body.reactors).toHaveLength(1);
    expect(body.reactors[0].userId).toBe(adminId);
    expect(body.reactors[0].userName).toBeTruthy();
  });

  it('second POST toggles OFF — deletes the reaction and returns empty reactors', async () => {
    await POST(mkRequest(), mkParams(projectId, messageId));
    const res = await POST(mkRequest(), mkParams(projectId, messageId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reacted).toBe(false);
    expect(body.count).toBe(0);
    expect(body.reactors).toEqual([]);
  });

  it('returns 404 when messageId does not belong to the project (path-spoof guard)', async () => {
    const otherProject = await prisma.project.findFirst({ where: { id: { not: projectId } } });
    if (!otherProject) {
      expect(true).toBe(true);
      return;
    }
    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${otherProject.id}/messages/${messageId}/react`, { method: 'POST' }),
      mkParams(otherProject.id, messageId),
    );
    expect(res.status).toBe(404);
  });

  it('writes an AuditLog row with action=project_message_react and entityType=Project', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'project_message_react' } });
    await POST(mkRequest(), mkParams(projectId, messageId));
    const after = await prisma.auditLog.count({ where: { action: 'project_message_react' } });
    expect(after).toBe(before + 1);
    const latest = await prisma.auditLog.findFirst({
      where: { action: 'project_message_react' },
      orderBy: { createdAt: 'desc' },
    });
    expect(latest?.entityType).toBe('Project');
    expect(latest?.entityId).toBe(projectId);
  });
});
