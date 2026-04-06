import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { requireAdmin } from '../../../../lib/api-auth';

/**
 * GET /api/users/invitations — List all pending Clerk invitations.
 * Admin only.
 */
export async function GET() {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }

  try {
    const client = await clerkClient();
    // Clerk paginates; request a reasonable default page size.
    const list = await client.invitations.getInvitationList({
      status: 'pending',
      limit: 100,
    });
    // `list.data` in v7; fall back to `list` if SDK surface changes.
    const invitations = (Array.isArray(list) ? list : list?.data ?? []).map((inv) => ({
      id: inv.id,
      emailAddress: inv.emailAddress,
      status: inv.status,
      createdAt: inv.createdAt,
      publicMetadata: inv.publicMetadata ?? null,
    }));
    return NextResponse.json({ invitations });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list invitations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
