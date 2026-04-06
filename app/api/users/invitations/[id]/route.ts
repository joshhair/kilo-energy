import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/api-auth';

/**
 * DELETE /api/users/invitations/[id] — Revoke a pending Clerk invitation
 * and delete the associated internal user record (if any).
 * Admin only.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  try {
    const client = await clerkClient();

    // Grab the invitation first so we can match its publicMetadata.internalUserId
    // back to our DB row before revoking.
    const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
    const invitations = Array.isArray(list) ? list : list?.data ?? [];
    const invitation = invitations.find((i) => i.id === id);
    const internalUserId = invitation?.publicMetadata?.internalUserId as string | undefined;

    // Revoke the invitation in Clerk
    await client.invitations.revokeInvitation(id);

    // Remove the orphan internal user row so emails are free to re-use
    if (internalUserId) {
      await prisma.user.delete({ where: { id: internalUserId } }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke invitation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
