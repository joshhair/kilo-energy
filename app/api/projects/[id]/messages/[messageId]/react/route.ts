/**
 * POST /api/projects/[id]/messages/[messageId]/react
 *
 * Toggle a per-user reaction on a chatter message. v1 hard-codes
 * reactionType='like' (👍). The schema is type-extensible so future
 * emoji types can ship without a migration — the route just clamps
 * to 'like' for now.
 *
 * Behavior:
 *   - If the (messageId, userId, 'like') row exists → DELETE it
 *   - Otherwise → INSERT it
 *   - Returns the new reactor list so the UI can update without a refetch
 *
 * Auth: signed-in internal user + project-access gate. The same
 * requireProjectAccess() that already protects message read / write /
 * delete — vendor PMs and reps scoped to other installers cannot react
 * on messages they can't see.
 *
 * Notify: NONE. Reactions are silent acknowledgements; firing per-tap
 * notifications would generate digest spam. The author sees the reaction
 * count next time they open the thread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';
import { requireInternalUser, requireProjectAccess } from '../../../../../../../lib/api-auth';
import { logChange } from '../../../../../../../lib/audit';
import { enforceRateLimit } from '../../../../../../../lib/rate-limit';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }
  const { id, messageId } = await params;
  try { await requireProjectAccess(user, id); } catch (r) { return r as NextResponse; }

  // Mirror the messages-route rate limit (chatter has a 120/min cap; the
  // react endpoint should match so a UI that double-taps doesn't get
  // throttled differently from the message it's reacting to).
  const limited = await enforceRateLimit(`POST /api/projects/messages/react:${user.id}`, 120, 60_000);
  if (limited) return limited;

  // Confirm the message exists AND belongs to this project (defense
  // against passing a messageId from another project). Cheap PK lookup.
  const message = await prisma.projectMessage.findUnique({
    where: { id: messageId },
    select: { id: true, projectId: true },
  });
  if (!message || message.projectId !== id) {
    return NextResponse.json({ error: 'Message not found on this project' }, { status: 404 });
  }

  const reactionType = 'like';
  const existing = await prisma.chatMessageReaction.findUnique({
    where: { messageId_userId_reactionType: { messageId, userId: user.id, reactionType } },
    select: { id: true },
  });

  let reacted: boolean;
  if (existing) {
    await prisma.chatMessageReaction.delete({ where: { id: existing.id } });
    reacted = false;
  } else {
    await prisma.chatMessageReaction.create({
      data: { messageId, userId: user.id, reactionType },
    });
    reacted = true;
  }

  // Look up every reactor on this message so the UI can render the
  // count + names without a separate roundtrip. Names come from the
  // User table — single query, indexed by primary key.
  const allReactions = await prisma.chatMessageReaction.findMany({
    where: { messageId, reactionType },
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const userIds = allReactions.map((r) => r.userId);
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const reactors = allReactions.map((r) => ({
    userId: r.userId,
    userName: nameById.get(r.userId) ?? 'Unknown',
  }));

  // Audit. Anchor under 'Project' (not a new entityType) — reactions
  // don't warrant their own union entry; the detail JSON carries the
  // forensic signal (which user reacted to which message).
  await logChange({
    actor: { id: user.id, email: user.email },
    action: 'project_message_react',
    entityType: 'Project',
    entityId: id,
    detail: { messageId, reactionType, reacted },
  });

  return NextResponse.json({
    reacted,
    count: reactors.length,
    reactors,
  });
}
