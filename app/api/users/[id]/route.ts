import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/api-auth';
import { logger, errorContext } from '../../../../lib/logger';
import {
  assertNotSelf,
  assertNotLastActiveAdmin,
  assertNoRelations,
  countUserRelations,
} from '../../../../lib/user-guardrails';

/**
 * GET /api/users/[id] — Single user (admin only). Includes PII (email,
 * phone), permission flags, and a `relationCount` so the UI knows whether
 * the Delete-permanently button should be enabled.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { total: relationCount, breakdown: relationBreakdown } = await countUserRelations(id);

  // Best-effort lookup for a pending Clerk invitation. Used by the UI to
  // decide whether the action footer shows "Send invite" vs "Resend invite".
  let pendingInvitation: { id: string; createdAt: number } | null = null;
  if (!user.clerkUserId) {
    try {
      const client = await clerkClient();
      const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
      const items = Array.isArray(list) ? list : list?.data ?? [];
      const inv = items.find((i) => i.emailAddress.toLowerCase() === user.email.toLowerCase());
      if (inv) pendingInvitation = { id: inv.id, createdAt: inv.createdAt };
    } catch {
      // Clerk lookup failure is non-fatal — just leave pendingInvitation null.
    }
  }

  return NextResponse.json({
    ...user,
    hasClerkAccount: !!user.clerkUserId,
    relationCount,
    relationBreakdown,
    pendingInvitation,
  });
}

/**
 * PATCH /api/users/[id] — Update user fields. Admin only.
 *
 * Accepts:
 *   - Contact info: firstName, lastName, email, phone
 *   - active: true | false (deactivation / reactivation, with full Clerk
 *     lifecycle handling — locks/unlocks Clerk user, revokes pending invite)
 *   - Permission flags: canRequestBlitz, canCreateBlitz, canExport,
 *     canCreateDeals, canAccessBlitz, repType
 *
 * Guardrails on `active: false`: cannot deactivate self, cannot deactivate
 * the last active admin.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data: Record<string, unknown> = {};

  // Contact info
  if (typeof body.firstName === 'string') data.firstName = body.firstName.trim();
  if (typeof body.lastName === 'string') data.lastName = body.lastName.trim();
  if (typeof body.email === 'string') data.email = body.email.trim().toLowerCase();
  if (typeof body.phone === 'string') data.phone = body.phone.trim();
  if (body.repType !== undefined) data.repType = body.repType;

  // Permission flags (existing behavior)
  if (body.canRequestBlitz !== undefined) data.canRequestBlitz = body.canRequestBlitz;
  if (body.canCreateBlitz !== undefined) data.canCreateBlitz = body.canCreateBlitz;
  if (body.canExport !== undefined) data.canExport = body.canExport;
  if (body.canCreateDeals !== undefined) data.canCreateDeals = body.canCreateDeals;
  if (body.canAccessBlitz !== undefined) data.canAccessBlitz = body.canAccessBlitz;

  // Active flag — handles the deactivation / reactivation workflow with
  // full Clerk lifecycle ops. Done after guardrails so we don't touch
  // Clerk if the rules reject the operation.
  const activeChanged = typeof body.active === 'boolean' && body.active !== existing.active;
  if (activeChanged) {
    if (body.active === false) {
      // Deactivation — guardrails first
      try { await assertNotSelf(viewer.id, id); } catch (r) { return r as NextResponse; }
      try { await assertNotLastActiveAdmin(id); } catch (r) { return r as NextResponse; }

      // Lock Clerk user (reversible — unlock on reactivate)
      if (existing.clerkUserId) {
        try {
          const client = await clerkClient();
          await client.users.lockUser(existing.clerkUserId);
        } catch (err) {
          logger.error('clerk_lock_user_failed', { userId: id, op: 'deactivate', ...errorContext(err) });
          // Non-fatal — proceed with DB update so the user is still marked
          // inactive in our system. Worst case the admin can manually lock
          // them in the Clerk dashboard.
        }
      }

      // Revoke any pending invitation so the email slot is freed
      try {
        const client = await clerkClient();
        const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
        const items = Array.isArray(list) ? list : list?.data ?? [];
        const pending = items.filter((i) => i.emailAddress.toLowerCase() === existing.email.toLowerCase());
        for (const inv of pending) {
          await client.invitations.revokeInvitation(inv.id).catch(() => {});
        }
      } catch (err) {
        logger.error('clerk_revoke_invitations_failed', { userId: id, op: 'deactivate', ...errorContext(err) });
      }
    } else {
      // Reactivation — unlock Clerk user
      if (existing.clerkUserId) {
        try {
          const client = await clerkClient();
          await client.users.unlockUser(existing.clerkUserId);
        } catch (err) {
          logger.error('clerk_unlock_user_failed', { userId: id, op: 'reactivate', ...errorContext(err) });
        }
      }
    }
    data.active = body.active;
  }

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({
    ...user,
    hasClerkAccount: !!user.clerkUserId,
  });
}

/**
 * DELETE /api/users/[id] — Hard delete. Admin only. Gated by guardrails:
 *   - Cannot delete self
 *   - Cannot delete the last active admin
 *   - Cannot delete a user with any FK relations (returns 409 with breakdown)
 *
 * For deactivation (the common case), use PATCH with `{active: false}`
 * instead. Hard delete is for cleaning up typos and brand-new accounts
 * that have no history.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireAdmin(); } catch (r) { return r as NextResponse; }
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try { await assertNotSelf(viewer.id, id); } catch (r) { return r as NextResponse; }
  try { await assertNotLastActiveAdmin(id); } catch (r) { return r as NextResponse; }
  try { await assertNoRelations(id); } catch (r) { return r as NextResponse; }

  // Clerk-side cleanup — best effort. We continue even on failure since
  // the DB row is the source of truth and an orphaned Clerk user/invite
  // is recoverable from the Clerk dashboard.
  if (user.clerkUserId) {
    try {
      const client = await clerkClient();
      await client.users.deleteUser(user.clerkUserId);
    } catch (err) {
      logger.error('clerk_delete_user_failed', { userId: id, op: 'hard_delete', ...errorContext(err) });
    }
  }
  try {
    const client = await clerkClient();
    const list = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
    const items = Array.isArray(list) ? list : list?.data ?? [];
    const pending = items.filter((i) => i.emailAddress.toLowerCase() === user.email.toLowerCase());
    for (const inv of pending) {
      await client.invitations.revokeInvitation(inv.id).catch(() => {});
    }
  } catch (err) {
    logger.error('clerk_revoke_invitations_failed', { userId: id, op: 'hard_delete', ...errorContext(err) });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
